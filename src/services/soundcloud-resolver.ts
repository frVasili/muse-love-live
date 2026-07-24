import type {QueuedPlaylist, SongMetadata} from './player.js';
import {MediaSource} from './media-source.js';
import {selectPlaylistItems} from '../utils/playlist-selection.js';
import {getMediaMetadata, YtDlpMetadataOptions} from '../utils/yt-dlp.js';

type JsonRecord = Record<string, unknown>;

export type SoundCloudResolverDependencies = {
  getMetadata: (url: string, options?: YtDlpMetadataOptions) => Promise<unknown>;
  random: () => number;
};

type ParsedSoundCloudMetadata = {
  isPlaylist: boolean;
  playlistTitle: string;
  playlistUrl: string;
  songs: SongMetadata[];
};

const defaultDependencies: SoundCloudResolverDependencies = {
  getMetadata: getMediaMetadata,
  random: Math.random,
};

const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null;

const firstNonEmpty = (...values: unknown[]): string | undefined => values
  .find((value): value is string => typeof value === 'string' && value.trim() !== '')
  ?.trim();

export const isSoundCloudUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && (url.hostname === 'soundcloud.com' || url.hostname.endsWith('.soundcloud.com'));
  } catch {
    return false;
  }
};

const firstSoundCloudUrl = (...values: unknown[]): string | undefined => values
  .filter((value): value is string => typeof value === 'string')
  .find(isSoundCloudUrl);

const toSongMetadata = (value: unknown, fallbackUrl?: string, playlist: QueuedPlaylist | null = null): SongMetadata | null => {
  if (!isRecord(value)) {
    return null;
  }

  const title = firstNonEmpty(value.track, value.title);
  const artist = firstNonEmpty(value.artist, value.uploader, value.creator, value.channel) ?? 'SoundCloud';
  const webpageUrl = firstSoundCloudUrl(value.webpage_url, value.original_url, value.url, fallbackUrl);
  const {duration} = value;

  if (!title || !webpageUrl || typeof duration !== 'number' || duration <= 0) {
    return null;
  }

  return {
    title,
    artist,
    url: webpageUrl,
    length: duration,
    offset: 0,
    playlist,
    isLive: value.is_live === true || value.live_status === 'is_live',
    thumbnailUrl: firstNonEmpty(value.thumbnail) ?? null,
    source: MediaSource.SoundCloud,
  };
};

export const parseSoundCloudMetadata = (value: unknown, requestedUrl: string): ParsedSoundCloudMetadata => {
  if (!isRecord(value)) {
    return {
      isPlaylist: false,
      playlistTitle: '',
      playlistUrl: requestedUrl,
      songs: [],
    };
  }

  const playlistUrl = firstSoundCloudUrl(value.webpage_url, value.original_url, requestedUrl) ?? requestedUrl;
  if (Array.isArray(value.entries)) {
    const playlistTitle = firstNonEmpty(value.title) ?? 'SoundCloud playlist';
    const playlist = {title: playlistTitle, source: playlistUrl};

    return {
      isPlaylist: true,
      playlistTitle,
      playlistUrl,
      songs: value.entries.flatMap(entry => {
        const song = toSongMetadata(entry, undefined, playlist);
        return song ? [song] : [];
      }),
    };
  }

  const song = toSongMetadata(value, requestedUrl);
  return {
    isPlaylist: false,
    playlistTitle: '',
    playlistUrl,
    songs: song ? [song] : [],
  };
};

export default class SoundCloudResolver {
  private readonly dependencies: SoundCloudResolverDependencies;

  constructor(dependencies: Partial<SoundCloudResolverDependencies> = {}) {
    this.dependencies = {...defaultDependencies, ...dependencies};
  }

  async resolve(url: string, playlistLimit = Number.POSITIVE_INFINITY, shufflePlaylist = false): Promise<SongMetadata[]> {
    if (!isSoundCloudUrl(url)) {
      throw new Error('SoundCloud resolver received an unsupported URL.');
    }

    const metadataOptions = !shufflePlaylist && Number.isFinite(playlistLimit)
      ? {playlistEnd: playlistLimit}
      : {};
    const metadata = await this.dependencies.getMetadata(url, metadataOptions);
    const parsed = parseSoundCloudMetadata(metadata, url);

    if (parsed.songs.length === 0) {
      throw new Error('SoundCloud returned no playable public tracks.');
    }

    return parsed.isPlaylist
      ? selectPlaylistItems(parsed.songs, playlistLimit, shufflePlaylist, this.dependencies.random)
      : parsed.songs;
  }
}
