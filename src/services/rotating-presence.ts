import {ActivityType, Client, PresenceStatusData} from 'discord.js';
import * as spotifyURI from 'spotify-uri';
import SpotifyScraper from './spotify-scraper.js';

const scraper = new SpotifyScraper();

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
  return input.length > max ? `${input.slice(0, max - 1)}...` : input;
}

function normalizePlaylistId(value: string): string {
  try {
    const parsed = spotifyURI.parse(value);

    if (parsed.type === 'playlist') {
      return (parsed as spotifyURI.Playlist).id;
    }
  } catch {}

  return value.trim();
}

async function fetchPlaylistTracks(playlistId: string): Promise<string[]> {
  if (!playlistId) {
    throw new Error('Missing ROTATING_SPOTIFY_PLAYLIST_ID');
  }

  const [spotifyTracks] = await scraper.getPlaylist(normalizePlaylistId(playlistId), Number.MAX_SAFE_INTEGER);
  const found = spotifyTracks.map(track => shorten(`${track.name} by ${track.artist}`));

  return shuffle([...new Set(found)]);
}

async function refreshTracksIfNeeded(playlistId: string, refreshMinutes: number): Promise<void> {
  const now = Date.now();

  if (tracks.length > 0 && now - lastRefresh < refreshMinutes * 60 * 1000) {
    return;
  }

  const nextTracks = await fetchPlaylistTracks(playlistId);

  if (nextTracks.length > 0) {
    tracks = nextTracks;
    lastRefresh = now;
    console.log(`Loaded ${tracks.length} Spotify status tracks`);
  }
}

export function startRotatingPresence(client: Client, playlistId: string): void {
  const enabled = process.env.ROTATING_STATUS_ENABLED === 'true';
  const intervalSeconds = Number(process.env.ROTATING_STATUS_INTERVAL_SECONDS ?? 90);
  const refreshMinutes = Number(process.env.ROTATING_STATUS_REFRESH_MINUTES ?? 360);

  console.log(`Rotating presence startup: enabled=${String(enabled)}, interval=${intervalSeconds}, refresh=${refreshMinutes}, playlist=${playlistId ?? ''}`);

  if (!enabled) {
    console.log('Rotating presence disabled; using normal Muse status');
    return;
  }

  let index = 0;

  const update = async (): Promise<void> => {
    try {
      await refreshTracksIfNeeded(playlistId, refreshMinutes);

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
