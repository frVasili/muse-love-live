import {ActivityType, Client, PresenceStatusData} from 'discord.js';

type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type SpotifyPlaylistItem = {
  item?: {
    name?: string;
    artists?: Array<{name?: string}>;
  };
  track?: {
    name?: string;
    artists?: Array<{name?: string}>;
  };
};

const enabled = process.env.ROTATING_STATUS_ENABLED === 'true';
const intervalSeconds = Number(process.env.ROTATING_STATUS_INTERVAL_SECONDS ?? 90);
const refreshMinutes = Number(process.env.ROTATING_STATUS_REFRESH_MINUTES ?? 360);
const playlistId = process.env.ROTATING_SPOTIFY_PLAYLIST_ID;
const spotifyMarket = process.env.SPOTIFY_MARKET ?? 'US';
const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

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
  const body = refreshToken
    ? new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString()
    : 'grant_type=client_credentials';

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const responseBody = await res.text();
    throw new Error(`Spotify token request failed: ${res.status}
${responseBody}`);
  }

  const data = (await res.json()) as SpotifyTokenResponse;
  return data.access_token;
}

async function fetchPlaylistTracks(): Promise<string[]> {
  if (!playlistId) {
    throw new Error('Missing ROTATING_SPOTIFY_PLAYLIST_ID');
  }

  const token = await getSpotifyToken();
  const found: string[] = [];
  let url: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/items?fields=next,items(item(name,artists(name)))&limit=50&market=${encodeURIComponent(spotifyMarket)}`;

  while (url) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      // eslint-disable-next-line no-await-in-loop
      const responseBody = await res.text();
      throw new Error(`Spotify playlist request failed: ${res.status}
${responseBody}`);
    }

    // eslint-disable-next-line no-await-in-loop
    const data = (await res.json()) as {
      next: string | null;
      items: SpotifyPlaylistItem[];
    };

    for (const playlistItem of data.items) {
      const item = playlistItem.item ?? playlistItem.track;
      const name = item?.name;
      const artist = item?.artists?.map(a => a.name).filter(Boolean).join(', ');

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
  console.log(`Rotating presence startup: enabled=${String(enabled)}, interval=${intervalSeconds}, refresh=${refreshMinutes}, playlist=${playlistId ?? ''}, market=${spotifyMarket}`);

  if (!enabled) {
    console.log('Rotating presence disabled; using normal Muse status');
    return;
  }

  let index = 0;

  const update = async (): Promise<void> => {
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

  setInterval(() => {
    void update();
  }, Math.max(intervalSeconds, 60) * 1000);
}
