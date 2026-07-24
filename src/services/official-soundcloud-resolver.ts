import {inject, injectable, unmanaged} from 'inversify';
import got from 'got';
import {TYPES} from '../types.js';
import {THIRTY_DAYS_IN_SECONDS} from '../utils/constants.js';
import {getSpotifyTitleMatch, hasNonSongSignals} from '../utils/spotify-video-match.js';
import {getMediaMetadata, YtDlpMetadataOptions} from '../utils/yt-dlp.js';
import type KeyValueCacheProvider from './key-value-cache.js';
import {scheduleMusicBrainzRequest} from './official-bandcamp-resolver.js';
import type {SpotifyTrack} from './spotify-api.js';

const MUSICBRAINZ_BASE_URL = 'https://musicbrainz.org/ws/2/';
const MUSICBRAINZ_USER_AGENT = 'Muse/2.11.5 (https://github.com/frVasili/muse-love-live)';
const RESOLVE_TIMEOUT_MS = 12_000;
const PROFILE_TRACK_LIMIT = 250;
const MAX_METADATA_CANDIDATES = 5;
const DURATION_TOLERANCE_SECONDS = 5;

type JsonRecord = Record<string, unknown>;

type SoundCloudProfileEntry = {
  title: string;
  url: string;
};

type SoundCloudTrackMetadata = {
  title: string;
  artist: string;
  url: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
};

export type OfficialSoundCloudMatch = {
  provider: 'soundcloud';
  url: string;
  title: string;
  artist: string;
  length: number;
  thumbnailUrl: string | null;
  durationDeltaSeconds: number;
  confidenceEvidence: string[];
};

export type OfficialSoundCloudResolverDependencies = {
  requestJson: (url: string) => Promise<unknown>;
  getMetadata: (url: string, options?: YtDlpMetadataOptions) => Promise<unknown>;
};

const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null;

const firstNonEmpty = (...values: unknown[]): string | undefined => values
  .find((value): value is string => typeof value === 'string' && value.trim() !== '')
  ?.trim();

const canonicalSoundCloudUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || (url.hostname !== 'soundcloud.com' && !url.hostname.endsWith('.soundcloud.com'))) {
      return null;
    }

    url.hostname = 'soundcloud.com';
    url.hash = '';
    url.search = '';
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length === 0) {
      return null;
    }

    url.pathname = `/${pathParts.join('/')}`;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const isSoundCloudTrackUrl = (value: string): boolean => {
  const canonicalUrl = canonicalSoundCloudUrl(value);
  if (!canonicalUrl) {
    return false;
  }

  const pathParts = new URL(canonicalUrl).pathname.split('/').filter(Boolean);
  return pathParts.length === 2 && pathParts[1] !== 'sets';
};

const relatedArtistIds = (value: unknown): string[] => {
  if (!isRecord(value) || !Array.isArray(value.relations)) {
    return [];
  }

  return [...new Set(value.relations.flatMap(relation => {
    if (!isRecord(relation) || !isRecord(relation.artist) || typeof relation.artist.id !== 'string') {
      return [];
    }

    return [relation.artist.id];
  }))];
};

const officialSoundCloudProfileUrls = (value: unknown): string[] => {
  if (!isRecord(value) || !Array.isArray(value.relations)) {
    return [];
  }

  return [...new Set(value.relations.flatMap(relation => {
    if (!isRecord(relation)
      || relation.type !== 'soundcloud'
      || !isRecord(relation.url)
      || typeof relation.url.resource !== 'string') {
      return [];
    }

    const canonicalUrl = canonicalSoundCloudUrl(relation.url.resource);
    if (!canonicalUrl || new URL(canonicalUrl).pathname.split('/').filter(Boolean).length !== 1) {
      return [];
    }

    return [canonicalUrl];
  }))];
};

export const parseSoundCloudProfileEntries = (value: unknown): SoundCloudProfileEntry[] => {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    return [];
  }

  const entries = new Map<string, SoundCloudProfileEntry>();
  for (const entry of value.entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const title = firstNonEmpty(entry.track, entry.title);
    const url = firstNonEmpty(entry.webpage_url, entry.original_url, entry.url);
    const canonicalUrl = url ? canonicalSoundCloudUrl(url) : null;

    if (title && canonicalUrl && isSoundCloudTrackUrl(canonicalUrl)) {
      entries.set(canonicalUrl, {title, url: canonicalUrl});
    }
  }

  return [...entries.values()];
};

export const parseSoundCloudTrackMetadata = (value: unknown): SoundCloudTrackMetadata | null => {
  if (!isRecord(value)) {
    return null;
  }

  const title = firstNonEmpty(value.track, value.title);
  const artist = firstNonEmpty(value.artist, value.uploader, value.creator, value.channel);
  const url = firstNonEmpty(value.webpage_url, value.original_url, value.url);
  const canonicalUrl = url ? canonicalSoundCloudUrl(url) : null;

  if (!title || !artist || !canonicalUrl || !isSoundCloudTrackUrl(canonicalUrl)
    || typeof value.duration !== 'number' || value.duration <= 0) {
    return null;
  }

  return {
    title,
    artist,
    url: canonicalUrl,
    durationSeconds: value.duration,
    thumbnailUrl: firstNonEmpty(value.thumbnail) ?? null,
  };
};

export const isExactSoundCloudTrackMatch = (candidate: SoundCloudTrackMetadata, track: SpotifyTrack): boolean => {
  if (!track.durationMs) {
    return false;
  }

  const match = getSpotifyTitleMatch({
    snippet: {
      title: candidate.title,
      channelTitle: candidate.artist,
    },
  }, track);

  return match.exactTitleMatch
    && match.artistMatch
    && !hasNonSongSignals(match.title, match.channel, track.name)
    && Math.abs(candidate.durationSeconds - (track.durationMs / 1000)) <= DURATION_TOLERANCE_SECONDS;
};

const defaultDependencies: OfficialSoundCloudResolverDependencies = {
  requestJson: async url => scheduleMusicBrainzRequest(async () => got(url, {
    headers: {
      accept: 'application/json',
      'user-agent': MUSICBRAINZ_USER_AGENT,
    },
    retry: {limit: 0},
    timeout: {request: 4_000},
  }).json<unknown>()),
  getMetadata: getMediaMetadata,
};

const getStatusCode = (error: unknown): number | undefined => {
  if (!isRecord(error) || !isRecord(error.response) || typeof error.response.statusCode !== 'number') {
    return undefined;
  }

  return error.response.statusCode;
};

@injectable()
export default class OfficialSoundCloudResolver {
  private readonly dependencies: OfficialSoundCloudResolverDependencies;
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    @inject(TYPES.KeyValueCache) private readonly cache: KeyValueCacheProvider,
    @unmanaged() dependencies: Partial<OfficialSoundCloudResolverDependencies> = {},
  ) {
    this.dependencies = {...defaultDependencies, ...dependencies};
  }

  async resolve(track: SpotifyTrack): Promise<OfficialSoundCloudMatch | null> {
    if (!track.artistId || !track.durationMs) {
      return null;
    }

    try {
      return await this.withTimeout(this.cachedPositive(
        `spotify-soundcloud-track-v1:${track.id}`,
        async () => this.resolveInternal(track),
      ));
    } catch {
      return null;
    }
  }

  private async resolveInternal(track: SpotifyTrack): Promise<OfficialSoundCloudMatch | null> {
    const {artistId, durationMs} = track;
    if (!artistId || !durationMs) {
      return null;
    }

    const artist = await this.getMusicBrainzArtistForSpotifyUrl(`https://open.spotify.com/artist/${artistId}`);
    const [profileUrl, ...extraProfileUrls] = officialSoundCloudProfileUrls(artist);
    if (!profileUrl || extraProfileUrls.length > 0) {
      return null;
    }

    const profileEntries = await this.cachedPositive(
      `soundcloud-profile-v1:${profileUrl}`,
      async () => {
        const metadata = await this.dependencies.getMetadata(profileUrl, {
          flatPlaylist: true,
          ignoreErrors: true,
          playlistEnd: PROFILE_TRACK_LIMIT,
          timeout: RESOLVE_TIMEOUT_MS,
        });
        const entries = parseSoundCloudProfileEntries(metadata);
        return entries.length > 0 ? entries : null;
      },
    );
    if (!profileEntries) {
      return null;
    }

    const titleCandidates = profileEntries.filter(entry => {
      const match = getSpotifyTitleMatch({
        snippet: {
          title: entry.title,
          channelTitle: track.artist,
        },
      }, track);
      return match.exactTitleMatch && !hasNonSongSignals(match.title, match.channel, track.name);
    });
    if (titleCandidates.length > MAX_METADATA_CANDIDATES) {
      return null;
    }

    const inspected = await Promise.all(titleCandidates.map(async entry => {
      try {
        const metadata = await this.dependencies.getMetadata(entry.url, {timeout: RESOLVE_TIMEOUT_MS});
        return parseSoundCloudTrackMetadata(metadata);
      } catch {
        return null;
      }
    }));
    const matches = inspected.filter((candidate): candidate is SoundCloudTrackMetadata => (
      candidate !== null && isExactSoundCloudTrackMatch(candidate, track)
    ));

    if (matches.length !== 1) {
      return null;
    }

    const [match] = matches;
    return {
      provider: 'soundcloud',
      url: match.url,
      title: match.title,
      artist: match.artist,
      length: Math.round(match.durationSeconds),
      thumbnailUrl: match.thumbnailUrl,
      durationDeltaSeconds: Math.abs(match.durationSeconds - (durationMs / 1000)),
      confidenceEvidence: [
        'musicbrainz-spotify-artist',
        'musicbrainz-artist-soundcloud-relation',
        'official-profile-track-membership',
        'exact-title-artist-duration',
      ],
    };
  }

  private async getMusicBrainzArtistForSpotifyUrl(spotifyUrl: string): Promise<unknown | null> {
    const lookupUrl = new URL('url', MUSICBRAINZ_BASE_URL);
    lookupUrl.search = new URLSearchParams({
      resource: spotifyUrl,
      inc: 'artist-rels',
      fmt: 'json',
    }).toString();
    const lookup = await this.fetchMusicBrainzJson(lookupUrl.toString());
    const [artistId, ...extraIds] = relatedArtistIds(lookup);

    if (!artistId || extraIds.length > 0) {
      return null;
    }

    const artistUrl = new URL(`artist/${artistId}`, MUSICBRAINZ_BASE_URL);
    artistUrl.search = new URLSearchParams({
      inc: 'url-rels',
      fmt: 'json',
    }).toString();
    return this.fetchMusicBrainzJson(artistUrl.toString());
  }

  private async fetchMusicBrainzJson(url: string): Promise<unknown | null> {
    return this.cachedPositive(`musicbrainz-v1:${url}`, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // eslint-disable-next-line no-await-in-loop
          return await this.dependencies.requestJson(url);
        } catch (error: unknown) {
          if (getStatusCode(error) !== 503 || attempt === 1) {
            if (getStatusCode(error) === 404) {
              return null;
            }

            throw error;
          }
        }
      }

      return null;
    });
  }

  private async cachedPositive<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
    const cached = await this.cache.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const existing = this.inFlight.get(key) as Promise<T | null> | undefined;
    if (existing) {
      return existing;
    }

    const pending = load()
      .then(async result => {
        if (result !== null) {
          await this.cache.set(key, result, THIRTY_DAYS_IN_SECONDS);
        }

        return result;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Official SoundCloud fallback timed out.'));
      }, RESOLVE_TIMEOUT_MS);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
