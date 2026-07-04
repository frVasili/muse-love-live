import {ActivityType, Client, PresenceStatusData} from 'discord.js';

type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type SpotifyPlaylistItem = {
  track?: {
    name?: string;
    artists?: Array<{name?: string}>;
  };
};

const enabled = process.env.ROTATING_STATUS_ENABLED === 'true';
const intervalSeconds = Number(process.env.ROTATING_STATUS_INTERVAL_SECONDS ?? 90);
const refreshMinutes = Number(process.env.ROTATING_STATUS_REFRESH_MINUTES ?? 360);
const playlistId = process.env.LOVE_LIVE_SPOTIFY_PLAYLIST_ID;
const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

let tracks: string[] = [];
let lastRefresh = 0;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function shorten(input: string, max = 120): string {
  return input.length > max ? `${input.slice(0, max - 1)}…` : input;
}

async function getSpotifyToken(): Promise<string> {
  if (!clientId || !clientSecret) {
    throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const body = await res.text();

    throw new Error(
      `Spotify playlist request failed: ${res.status}\n${body}`,
    );
  }

  const data = (await res.json()) as SpotifyTokenResponse;
  return data.access_token;
}

async function fetchPlaylistTracks(): Promise<string[]> {
  if (!playlistId) {
    throw new Error('Missing LOVE_LIVE_SPOTIFY_PLAYLIST_ID');
  }

  const token = await getSpotifyToken();
  const found: string[] = [];

  let url:
    | string
    | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?fields=next,items(track(name,artists(name)))&limit=100`;

  while (url) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  
    if (!res.ok) {
      // eslint-disable-next-line no-await-in-loop
      const body = await res.text();
  
      throw new Error(`Spotify playlist request failed: ${res.status}\n${body}`);
    }
  
    // eslint-disable-next-line no-await-in-loop
    const data = (await res.json()) as {
      next: string | null;
      items: SpotifyPlaylistItem[];
    };
  
    for (const item of data.items) {
      const name = item.track?.name;
      const artist = item.track?.artists?.map(a => a.name).filter(Boolean).join(', ');
  
      if (name) {
        found.push(shorten(artist ? `${name} — ${artist}` : name));
      }
    }
  
    url = data.next;
  }

  return shuffle([...new Set(found)]);
}

async function refreshTracksIfNeeded(): Promise<void> {
  const now = Date.now();

  if (tracks.length > 0 && now - lastRefresh < refreshMinutes * 60 * 1000) {
    return;
  }

  const nextTracks = await fetchPlaylistTracks();

  if (nextTracks.length > 0) {
    tracks = nextTracks;
    lastRefresh = now;
    console.log(`Loaded ${tracks.length} Love Live status tracks`);
  }
}

export function startRotatingPresence(client: Client): void {
  if (!enabled) {
    return;
  }

  let index = 0;

  const update = async () => {
    try {
      await refreshTracksIfNeeded();

      if (tracks.length === 0 || !client.user) {
        return;
      }

      const name = tracks[index % tracks.length];
      index += 1;

      client.user.setPresence({
        status: (process.env.BOT_STATUS ?? 'online') as PresenceStatusData,
        activities: [
          {
            name,
            type: ActivityType.Listening,
          },
        ],
      });
    } catch (error) {
      console.error('Failed to update rotating presence:', error);
    }
  };

  void update();
  setInterval(update, Math.max(intervalSeconds, 60) * 1000);
}
