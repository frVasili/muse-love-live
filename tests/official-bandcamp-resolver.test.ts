import assert from 'node:assert/strict';
import OfficialBandcampResolver, {
  normalizeBandcampIdentity,
  parseBandcampCatalogAlbums,
  selectBandcampTrack,
  selectMusicBrainzTrack,
} from '../src/services/official-bandcamp-resolver.js';
import type KeyValueCacheProvider from '../src/services/key-value-cache.js';
import {parseMediaPlaylistEntries} from '../src/utils/yt-dlp.js';
import {bandcampEntryFor, glyphArtist, glyphTracks, releaseFor} from './fixtures/four-tet-wingdings.js';

class FakeCache {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

const directTrack = glyphTracks[0];
const catalogTrack = glyphTracks[3];
const directRelease = releaseFor(directTrack, 'https://00000ooooo.bandcamp.com/album/--2');
const catalogRelease = releaseFor(catalogTrack);

assert.equal(normalizeBandcampIdentity(' A\u3000B '), 'a b');
assert.ok(selectMusicBrainzTrack(directRelease, directTrack), 'matches exact Unicode MusicBrainz track metadata');
assert.equal(selectMusicBrainzTrack(releaseFor({...directTrack, durationMs: 120_000}), directTrack), null, 'rejects a duration mismatch');
assert.equal(selectBandcampTrack([bandcampEntryFor(directTrack, 'https://00000ooooo.bandcamp.com/track/--3')], directTrack)?.webpageUrl, 'https://00000ooooo.bandcamp.com/track/--3');
assert.equal(selectBandcampTrack([bandcampEntryFor({...directTrack, name: 'wrong'}, 'https://00000ooooo.bandcamp.com/track/wrong')], directTrack), null);
assert.equal(selectBandcampTrack([{...bandcampEntryFor(directTrack, 'https://00000ooooo.bandcamp.com/track/wrong-artist'), uploader: 'Wrong Artist'}], directTrack, {allowTitleMismatch: true}), null, 'always rejects the wrong artist');
assert.equal(selectBandcampTrack([bandcampEntryFor({...directTrack, name: 'distribution-title-variant'}, 'https://00000ooooo.bandcamp.com/track/title-variant')], directTrack, {allowTitleMismatch: true})?.webpageUrl, 'https://00000ooooo.bandcamp.com/track/title-variant', 'allows a title variance only when the caller has a direct release relationship');
assert.deepEqual(parseMediaPlaylistEntries({entries: [{
  title: `${glyphArtist} - ${directTrack.name}`,
  track: directTrack.name,
  artist: glyphArtist,
  duration: 139.843,
  webpage_url: 'https://00000ooooo.bandcamp.com/track/--3',
  track_number: 1,
}]}), [{
  title: directTrack.name,
  durationSeconds: 139.843,
  webpageUrl: 'https://00000ooooo.bandcamp.com/track/--3',
  uploader: glyphArtist,
  playlistIndex: 1,
}], 'uses Bandcamp track metadata instead of the decorated full title');

const catalogHtml = `<a href="/album/ooo-o-0"><span>${catalogTrack.albumName}</span></a>`;
assert.deepEqual(parseBandcampCatalogAlbums(catalogHtml, 'https://00000ooooo.bandcamp.com'), [{
  title: catalogTrack.albumName,
  url: 'https://00000ooooo.bandcamp.com/album/ooo-o-0',
}]);

const requestCounts = new Map<string, number>();
const requestJson = async (url: string): Promise<unknown> => {
  requestCounts.set(url, (requestCounts.get(url) ?? 0) + 1);

  if (url.includes('/url?') && url.includes(encodeURIComponent(directTrack.albumId!))) {
    return {relations: [{release: {id: 'direct-release'}}]};
  }

  if (url.includes('/release/direct-release')) {
    return directRelease;
  }

  if (url.includes('/url?') && url.includes(encodeURIComponent(catalogTrack.albumId!))) {
    return {relations: [{release: {id: 'catalog-release'}}]};
  }

  if (url.includes('/release/catalog-release')) {
    return catalogRelease;
  }

  if (url.includes('/url?') && url.includes(encodeURIComponent(catalogTrack.artistId!))) {
    return {relations: [{artist: {id: 'glyph-artist'}}]};
  }

  if (url.includes('/artist/glyph-artist')) {
    return {relations: [{url: {resource: 'https://00000ooooo.bandcamp.com/'}}]};
  }

  throw new Error(`Unexpected URL: ${url}`);
};

let playlistCalls = 0;
const resolver = new OfficialBandcampResolver(new FakeCache() as unknown as KeyValueCacheProvider, {
  requestJson,
  requestText: async url => {
    assert.equal(url, 'https://00000ooooo.bandcamp.com/music');
    return catalogHtml;
  },
  getPlaylistEntries: async url => {
    playlistCalls++;
    if (url.endsWith('/album/--2')) {
      return [bandcampEntryFor(directTrack, 'https://00000ooooo.bandcamp.com/track/--3')];
    }

    return [bandcampEntryFor(catalogTrack, 'https://00000ooooo.bandcamp.com/track/--9')];
  },
});

const [firstDirect, secondDirect] = await Promise.all([resolver.resolve(directTrack), resolver.resolve(directTrack)]);
assert.equal(firstDirect?.url, 'https://00000ooooo.bandcamp.com/track/--3');
assert.deepEqual(secondDirect, firstDirect, 'coalesces concurrent resolution for the same Spotify track');
assert.equal(playlistCalls, 1, 'inspects an album once for concurrent tracks');

const catalogMatch = await resolver.resolve(catalogTrack);
assert.equal(catalogMatch?.url, 'https://00000ooooo.bandcamp.com/track/--9');
assert.equal(catalogMatch?.artist, glyphArtist);
assert.ok(catalogMatch?.confidenceEvidence.includes('musicbrainz-artist-bandcamp-relation'));

const directTitleVariant = {...directTrack, id: 'direct-title-variant', name: 'Spotify glyph variant'};
const directTitleVariantResolver = new OfficialBandcampResolver(new FakeCache() as unknown as KeyValueCacheProvider, {
  requestJson: async url => url.includes('/url?') ? {relations: [{release: {id: 'variant-release'}}]} : directRelease,
  requestText: async () => '',
  getPlaylistEntries: async () => [bandcampEntryFor(directTrack, 'https://00000ooooo.bandcamp.com/track/title-variant')],
});
const titleVariantMatch = await directTitleVariantResolver.resolve(directTitleVariant);
assert.equal(titleVariantMatch?.url, 'https://00000ooooo.bandcamp.com/track/title-variant');
assert.ok(titleVariantMatch?.confidenceEvidence.includes('direct-release-position-artist-duration'));

const missingRelationResolver = new OfficialBandcampResolver(new FakeCache() as unknown as KeyValueCacheProvider, {
  requestJson: async url => url.includes('/url?') ? {relations: [{release: {id: 'release'}}]} : releaseFor(directTrack),
  requestText: async () => '',
  getPlaylistEntries: async () => [],
});
assert.equal(await missingRelationResolver.resolve(directTrack), null, 'rejects a release with no official Bandcamp relationship');

let retryCount = 0;
const retryResolver = new OfficialBandcampResolver(new FakeCache() as unknown as KeyValueCacheProvider, {
  requestJson: async url => {
    retryCount++;
    if (retryCount === 1) {
      throw {response: {statusCode: 503}};
    }

    return url.includes('/url?') ? {relations: [{release: {id: 'retry-release'}}]} : directRelease;
  },
  requestText: async () => '',
  getPlaylistEntries: async () => [bandcampEntryFor(directTrack, 'https://00000ooooo.bandcamp.com/track/--3')],
});
assert.equal((await retryResolver.resolve(directTrack))?.provider, 'bandcamp');
assert.ok(retryCount >= 3, 'retries a MusicBrainz 503 before continuing');
