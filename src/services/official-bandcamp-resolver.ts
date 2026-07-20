import {inject, injectable, unmanaged} from 'inversify';
import got from 'got';
import {setTimeout as sleep} from 'node:timers/promises';
import {TYPES} from '../types.js';
import {THIRTY_DAYS_IN_SECONDS} from '../utils/constants.js';
import {getMediaPlaylistEntries, YtDlpPlaylistEntry} from '../utils/yt-dlp.js';
import type KeyValueCacheProvider from './key-value-cache.js';
import type {SpotifyTrack} from './spotify-api.js';

const MUSICBRAINZ_BASE_URL = 'https://musicbrainz.org/ws/2/';
const MUSICBRAINZ_USER_AGENT = 'Muse/2.11.5 (https://github.com/frVasili/muse-love-live)';
const RESOLVE_TIMEOUT_MS = 12_000;
const DURATION_TOLERANCE_SECONDS = 5;

let musicBrainzRequestTail: Promise<void> = Promise.resolve();
let lastMusicBrainzRequestAt = 0;

type JsonRecord = Record<string, unknown>;

type MusicBrainzTrack = {
  title: string;
  artist: string;
  durationSeconds: number;
};

export type OfficialBandcampMatch = {
  provider: 'bandcamp';
  url: string;
  title: string;
  artist: string;
  length: number;
  thumbnailUrl: string | null;
  durationDeltaSeconds: number;
  confidenceEvidence: string[];
};

export type BandcampCatalogAlbum = {
  title: string;
  url: string;
};

export type OfficialBandcampResolverDependencies = {
  requestJson: (url: string) => Promise<unknown>;
  requestText: (url: string) => Promise<string>;
  getPlaylistEntries: (url: string, timeout?: number) => Promise<YtDlpPlaylistEntry[]>;
};

const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null;

const decodeHtml = (value: string): string => value
  .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
  .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, entity => ({
    '&amp;': '&',
    '&quot;': '"',
    '&apos;': '\'',
    '&lt;': '<',
    '&gt;': '>',
    '&nbsp;': ' ',
  })[entity.toLowerCase()] ?? entity);

export const normalizeBandcampIdentity = (value: string): string => value
  .normalize('NFKC')
  .replace(/\p{Cf}/gu, '')
  .toLowerCase()
  .trim()
  .replace(/\s+/gu, ' ');

const isBandcampUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'bandcamp.com' || url.hostname.endsWith('.bandcamp.com'));
  } catch {
    return false;
  }
};

const canonicalBandcampUrl = (value: string): string | null => {
  if (!isBandcampUrl(value)) {
    return null;
  }

  const url = new URL(value);
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
};

export const parseBandcampCatalogAlbums = (html: string, baseUrl: string): BandcampCatalogAlbum[] => {
  const albums = new Map<string, BandcampCatalogAlbum>();
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(["'])([^"']*\/album\/[^"'?#]+)[^"']*\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) !== null) {
    try {
      const resolved = canonicalBandcampUrl(new URL(decodeHtml(match[2]), baseUrl).toString());
      const title = decodeHtml(match[3].replace(/<[^>]+>/g, ' ')).trim().replace(/\s+/gu, ' ');

      if (resolved && title && new URL(resolved).origin === new URL(baseUrl).origin) {
        albums.set(resolved, {title, url: resolved});
      }
    } catch {
      // Ignore malformed catalog links; an exact unambiguous match is required below.
    }
  }

  return [...albums.values()];
};

const relationResources = (value: unknown): string[] => {
  if (!isRecord(value) || !Array.isArray(value.relations)) {
    return [];
  }

  return value.relations.flatMap(relation => {
    if (!isRecord(relation) || !isRecord(relation.url) || typeof relation.url.resource !== 'string') {
      return [];
    }

    return [relation.url.resource];
  });
};

const relatedEntityIds = (value: unknown, entityKey: 'release' | 'artist'): string[] => {
  if (!isRecord(value) || !Array.isArray(value.relations)) {
    return [];
  }

  return [...new Set(value.relations.flatMap(relation => {
    if (!isRecord(relation)) {
      return [];
    }

    const entity = relation[entityKey];
    return isRecord(entity) && typeof entity.id === 'string' ? [entity.id] : [];
  }))];
};

const artistCreditName = (value: unknown): string => {
  if (!Array.isArray(value)) {
    return '';
  }

  return value.flatMap(credit => {
    if (!isRecord(credit)) {
      return [];
    }

    if (typeof credit.name === 'string') {
      return [credit.name];
    }

    return isRecord(credit.artist) && typeof credit.artist.name === 'string' ? [credit.artist.name] : [];
  }).join('');
};

export const selectMusicBrainzTrack = (release: unknown, track: SpotifyTrack): MusicBrainzTrack | null => {
  if (!isRecord(release) || !Array.isArray(release.media) || !track.discNumber || !track.trackNumber || !track.durationMs) {
    return null;
  }

  const media = release.media as unknown[];
  const medium = media.find(value => isRecord(value) && value.position === track.discNumber);
  if (!isRecord(medium) || !Array.isArray(medium.tracks)) {
    return null;
  }

  const mediumTracks = medium.tracks as unknown[];
  const candidate = mediumTracks.find(value => isRecord(value) && value.position === track.trackNumber);
  if (!isRecord(candidate) || typeof candidate.title !== 'string' || typeof candidate.length !== 'number') {
    return null;
  }

  const artist = artistCreditName(candidate['artist-credit']) || artistCreditName(release['artist-credit']);
  const durationSeconds = candidate.length / 1000;
  const durationDeltaSeconds = Math.abs(durationSeconds - (track.durationMs / 1000));

  if (normalizeBandcampIdentity(candidate.title) !== normalizeBandcampIdentity(track.name)
    || normalizeBandcampIdentity(artist) !== normalizeBandcampIdentity(track.artist)
    || durationDeltaSeconds > DURATION_TOLERANCE_SECONDS) {
    return null;
  }

  return {title: candidate.title, artist, durationSeconds};
};

export const selectBandcampTrack = (
  entries: readonly YtDlpPlaylistEntry[],
  track: SpotifyTrack,
  options: {allowTitleMismatch?: boolean} = {},
): YtDlpPlaylistEntry | null => {
  if (track.discNumber !== 1 || !track.trackNumber || !track.durationMs) {
    return null;
  }

  const {durationMs} = track;

  const matches = entries.filter(entry => entry.playlistIndex === track.trackNumber
    && (options.allowTitleMismatch || normalizeBandcampIdentity(entry.title) === normalizeBandcampIdentity(track.name))
    && typeof entry.uploader === 'string'
    && normalizeBandcampIdentity(entry.uploader) === normalizeBandcampIdentity(track.artist)
    && Math.abs(entry.durationSeconds - (durationMs / 1000)) <= DURATION_TOLERANCE_SECONDS
    && canonicalBandcampUrl(entry.webpageUrl) !== null);

  return matches.length === 1 ? matches[0] : null;
};

const defaultDependencies: OfficialBandcampResolverDependencies = {
  requestJson: async url => scheduleMusicBrainzRequest(async () => got(url, {
    headers: {
      accept: 'application/json',
      'user-agent': MUSICBRAINZ_USER_AGENT,
    },
    retry: {limit: 0},
    timeout: {request: 4_000},
  }).json<unknown>()),
  requestText: async url => got(url, {
    headers: {'user-agent': MUSICBRAINZ_USER_AGENT},
    retry: {limit: 1},
    timeout: {request: 4_000},
  }).text(),
  getPlaylistEntries: getMediaPlaylistEntries,
};

const getStatusCode = (error: unknown): number | undefined => {
  if (!isRecord(error) || !isRecord(error.response) || typeof error.response.statusCode !== 'number') {
    return undefined;
  }

  return error.response.statusCode;
};

const scheduleMusicBrainzRequest = async <T>(request: () => Promise<T>): Promise<T> => {
  const scheduled = musicBrainzRequestTail.then(async () => {
    const waitMs = Math.max(0, 1_000 - (Date.now() - lastMusicBrainzRequestAt));
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    lastMusicBrainzRequestAt = Date.now();
    return request();
  });

  musicBrainzRequestTail = scheduled.then(() => undefined, () => undefined);
  return scheduled;
};

@injectable()
export default class OfficialBandcampResolver {
  private readonly dependencies: OfficialBandcampResolverDependencies;
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    @inject(TYPES.KeyValueCache) private readonly cache: KeyValueCacheProvider,
    @unmanaged() dependencies: Partial<OfficialBandcampResolverDependencies> = {},
  ) {
    this.dependencies = {...defaultDependencies, ...dependencies};
  }

  async resolve(track: SpotifyTrack): Promise<OfficialBandcampMatch | null> {
    if (!track.artistId || !track.albumId || !track.albumName || !track.discNumber || !track.trackNumber || !track.durationMs) {
      return null;
    }

    try {
      return await this.withTimeout(this.cachedPositive(
        `spotify-bandcamp-track-v1:${track.id}`,
        async () => this.resolveInternal(track),
      ));
    } catch {
      return null;
    }
  }

  private async resolveInternal(track: SpotifyTrack): Promise<OfficialBandcampMatch | null> {
    const {albumId, albumName, artistId, durationMs} = track;
    if (!albumId || !albumName || !artistId || !durationMs) {
      return null;
    }

    const release = await this.getMusicBrainzEntityForSpotifyUrl('release', `https://open.spotify.com/album/${albumId}`);
    if (!release) {
      return null;
    }

    let albumUrl = this.getSingleBandcampAlbumUrl(release);
    const hasDirectReleaseRelation = Boolean(albumUrl);
    const confidenceEvidence = ['musicbrainz-spotify-release'];

    if (albumUrl) {
      confidenceEvidence.push('musicbrainz-release-bandcamp-relation');
    } else {
      // The catalog fallback has one less direct link, so retain exact MusicBrainz
      // track validation before following an artist homepage relationship.
      if (!selectMusicBrainzTrack(release, track)) {
        return null;
      }

      const artist = await this.getMusicBrainzEntityForSpotifyUrl('artist', `https://open.spotify.com/artist/${artistId}`);
      const artistBaseUrl = this.getSingleBandcampArtistUrl(artist);
      if (!artistBaseUrl) {
        return null;
      }

      albumUrl = await this.findAlbumInOfficialCatalog(artistBaseUrl, albumName);
      if (!albumUrl) {
        return null;
      }

      confidenceEvidence.push('musicbrainz-artist-bandcamp-relation', 'exact-official-catalog-album');
    }

    const resolvedAlbumUrl = albumUrl;
    const entries = await this.cachedPositive(
      `spotify-bandcamp-album-v1:${resolvedAlbumUrl}`,
      async () => {
        const result = await this.dependencies.getPlaylistEntries(resolvedAlbumUrl, RESOLVE_TIMEOUT_MS);
        return result.length > 0 ? result : null;
      },
    );
    const entry = entries ? selectBandcampTrack(entries, track, {allowTitleMismatch: hasDirectReleaseRelation}) : null;
    const canonicalUrl = entry ? canonicalBandcampUrl(entry.webpageUrl) : null;

    if (!entry || !canonicalUrl || new URL(canonicalUrl).origin !== new URL(resolvedAlbumUrl).origin) {
      return null;
    }

    const exactTitle = normalizeBandcampIdentity(entry.title) === normalizeBandcampIdentity(track.name);
    confidenceEvidence.push(exactTitle
      ? 'exact-position-title-artist-duration'
      : 'direct-release-position-artist-duration');

    return {
      provider: 'bandcamp',
      url: canonicalUrl,
      title: entry.title,
      artist: entry.uploader ?? track.artist,
      length: Math.round(entry.durationSeconds),
      thumbnailUrl: entry.thumbnailUrl ?? null,
      durationDeltaSeconds: Math.abs(entry.durationSeconds - (durationMs / 1000)),
      confidenceEvidence,
    };
  }

  private async getMusicBrainzEntityForSpotifyUrl(entity: 'release' | 'artist', spotifyUrl: string): Promise<unknown | null> {
    const lookupUrl = new URL('url', MUSICBRAINZ_BASE_URL);
    lookupUrl.search = new URLSearchParams({
      resource: spotifyUrl,
      inc: `${entity}-rels`,
      fmt: 'json',
    }).toString();
    const lookup = await this.fetchMusicBrainzJson(lookupUrl.toString());
    const [entityId, ...extraIds] = relatedEntityIds(lookup, entity);

    if (!entityId || extraIds.length > 0) {
      return null;
    }

    const entityUrl = new URL(`${entity}/${entityId}`, MUSICBRAINZ_BASE_URL);
    entityUrl.search = new URLSearchParams({
      inc: entity === 'release' ? 'url-rels+recordings+artist-credits' : 'url-rels',
      fmt: 'json',
    }).toString();
    return this.fetchMusicBrainzJson(entityUrl.toString());
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

  private getSingleBandcampAlbumUrl(release: unknown): string | null {
    const urls = [...new Set(relationResources(release)
      .map(canonicalBandcampUrl)
      .filter((url): url is string => url !== null)
      .filter(url => new URL(url).pathname.startsWith('/album/')))];
    return urls.length === 1 ? urls[0] : null;
  }

  private getSingleBandcampArtistUrl(artist: unknown): string | null {
    const origins = [...new Set(relationResources(artist)
      .map(canonicalBandcampUrl)
      .filter((url): url is string => Boolean(url))
      .map(url => new URL(url).origin))];
    return origins.length === 1 ? origins[0] : null;
  }

  private async findAlbumInOfficialCatalog(artistBaseUrl: string, albumName: string): Promise<string | null> {
    const cacheKey = `spotify-bandcamp-catalog-v1:${artistBaseUrl}:${normalizeBandcampIdentity(albumName)}`;
    return this.cachedPositive(cacheKey, async () => {
      const catalogUrl = new URL('/music', artistBaseUrl).toString();
      const html = await this.dependencies.requestText(catalogUrl);
      const matches = parseBandcampCatalogAlbums(html, artistBaseUrl)
        .filter(album => normalizeBandcampIdentity(album.title) === normalizeBandcampIdentity(albumName));
      return matches.length === 1 ? matches[0].url : null;
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
        reject(new Error('Official Bandcamp fallback timed out.'));
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
