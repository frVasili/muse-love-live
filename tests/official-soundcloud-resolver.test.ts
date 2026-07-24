import assert from 'node:assert/strict';
import OfficialSoundCloudResolver, {
  isExactSoundCloudTrackMatch,
  parseSoundCloudProfileEntries,
  parseSoundCloudTrackMetadata,
} from '../src/services/official-soundcloud-resolver.js';
import type KeyValueCacheProvider from '../src/services/key-value-cache.js';
import type {SpotifyTrack} from '../src/services/spotify-api.js';

class FakeCache {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

const track: SpotifyTrack = {
  id: 'spotify-track',
  url: 'https://open.spotify.com/track/spotify-track',
  name: 'Nebula',
  artist: 'Seyah',
  artistId: 'spotify-artist',
  durationMs: 425_365,
};

const profileUrl = 'https://soundcloud.com/seyah-music';
const trackUrl = 'https://soundcloud.com/themangoalley/a322-seyah-nebula';
const profileMetadata = {
  entries: [
    {title: 'SEYAH Nebula', url: trackUrl},
    {title: 'An unrelated repost', url: 'https://soundcloud.com/another-user/unrelated'},
    {title: 'A playlist', url: 'https://soundcloud.com/seyah-music/sets/a-playlist'},
  ],
};
const trackMetadata = {
  title: 'SEYAH Nebula',
  artist: 'Seyah',
  uploader: 'Mango Alley',
  duration: 425.412,
  webpage_url: trackUrl,
  thumbnail: 'https://i1.sndcdn.com/artworks-nebula.jpg',
};

assert.deepEqual(parseSoundCloudProfileEntries(profileMetadata), [
  {title: 'SEYAH Nebula', url: trackUrl},
  {title: 'An unrelated repost', url: 'https://soundcloud.com/another-user/unrelated'},
], 'keeps canonical track URLs but excludes SoundCloud sets');
assert.deepEqual(parseSoundCloudTrackMetadata(trackMetadata), {
  title: 'SEYAH Nebula',
  artist: 'Seyah',
  url: trackUrl,
  durationSeconds: 425.412,
  thumbnailUrl: 'https://i1.sndcdn.com/artworks-nebula.jpg',
});
assert.equal(isExactSoundCloudTrackMatch(parseSoundCloudTrackMetadata(trackMetadata)!, track), true);
assert.equal(isExactSoundCloudTrackMatch({
  ...parseSoundCloudTrackMetadata(trackMetadata)!,
  durationSeconds: 450,
}, track), false, 'rejects a duration mismatch');
assert.equal(isExactSoundCloudTrackMatch({
  ...parseSoundCloudTrackMetadata(trackMetadata)!,
  title: 'Seyah Nebula Remix',
}, track), false, 'rejects an unexpected remix');
assert.equal(isExactSoundCloudTrackMatch({
  ...parseSoundCloudTrackMetadata(trackMetadata)!,
  title: 'Nebula',
  artist: 'Different Artist',
}, track), false, 'requires artist identity in the title or track metadata');

const makeRequestJson = (soundCloudRelations = [{type: 'soundcloud', url: {resource: profileUrl}}]) => async (url: string): Promise<unknown> => {
  if (url.includes('/url?')) {
    return {relations: [{artist: {id: 'musicbrainz-artist'}}]};
  }

  if (url.includes('/artist/musicbrainz-artist')) {
    return {relations: soundCloudRelations};
  }

  throw new Error(`Unexpected URL: ${url}`);
};

let profileCalls = 0;
let trackCalls = 0;
const resolver = new OfficialSoundCloudResolver(new FakeCache() as unknown as KeyValueCacheProvider, {
  requestJson: makeRequestJson(),
  getMetadata: async url => {
    if (url === profileUrl) {
      profileCalls++;
      return profileMetadata;
    }

    if (url === trackUrl) {
      trackCalls++;
      return trackMetadata;
    }

    throw new Error(`Unexpected metadata URL: ${url}`);
  },
});

const [firstMatch, secondMatch] = await Promise.all([resolver.resolve(track), resolver.resolve(track)]);
assert.equal(firstMatch?.provider, 'soundcloud');
assert.equal(firstMatch?.url, trackUrl);
assert.equal(firstMatch?.artist, 'Seyah');
assert.ok(firstMatch?.confidenceEvidence.includes('official-profile-track-membership'));
assert.deepEqual(secondMatch, firstMatch, 'coalesces concurrent resolution for the same Spotify track');
assert.equal(profileCalls, 1);
assert.equal(trackCalls, 1);

const missingFromProfileResolver = new OfficialSoundCloudResolver(new FakeCache() as unknown as KeyValueCacheProvider, {
  requestJson: makeRequestJson(),
  getMetadata: async url => url === profileUrl
    ? {entries: [{title: 'Different Song', url: 'https://soundcloud.com/seyah-music/different-song'}]}
    : trackMetadata,
});
assert.equal(await missingFromProfileResolver.resolve({...track, id: 'not-in-profile'}), null, 'does not trust a matching track outside the official profile feed');

const wrongDurationResolver = new OfficialSoundCloudResolver(new FakeCache() as unknown as KeyValueCacheProvider, {
  requestJson: makeRequestJson(),
  getMetadata: async url => url === profileUrl ? profileMetadata : {...trackMetadata, duration: 450},
});
assert.equal(await wrongDurationResolver.resolve({...track, id: 'wrong-duration'}), null);

const ambiguousResolver = new OfficialSoundCloudResolver(new FakeCache() as unknown as KeyValueCacheProvider, {
  requestJson: makeRequestJson(),
  getMetadata: async url => {
    if (url === profileUrl) {
      return {entries: [
        {title: 'SEYAH Nebula', url: trackUrl},
        {title: 'Nebula', url: 'https://soundcloud.com/seyah-music/nebula'},
      ]};
    }

    return {...trackMetadata, webpage_url: url};
  },
});
assert.equal(await ambiguousResolver.resolve({...track, id: 'ambiguous'}), null, 'rejects multiple equally valid official-profile tracks');

let excessiveCandidateInspections = 0;
const excessiveCandidatesResolver = new OfficialSoundCloudResolver(new FakeCache() as unknown as KeyValueCacheProvider, {
  requestJson: makeRequestJson(),
  getMetadata: async url => {
    if (url === profileUrl) {
      return {entries: Array.from({length: 6}, (_value, index) => ({
        title: 'SEYAH Nebula',
        url: `https://soundcloud.com/seyah-music/nebula-${index}`,
      }))};
    }

    excessiveCandidateInspections++;
    return {...trackMetadata, webpage_url: url};
  },
});
assert.equal(await excessiveCandidatesResolver.resolve({...track, id: 'excessive-candidates'}), null, 'rejects an excessive ambiguous candidate set');
assert.equal(excessiveCandidateInspections, 0, 'does not partially inspect an excessive candidate set');

const multipleProfilesResolver = new OfficialSoundCloudResolver(new FakeCache() as unknown as KeyValueCacheProvider, {
  requestJson: makeRequestJson([
    {type: 'soundcloud', url: {resource: profileUrl}},
    {type: 'soundcloud', url: {resource: 'https://soundcloud.com/seyah-secondary'}},
  ]),
  getMetadata: async () => profileMetadata,
});
assert.equal(await multipleProfilesResolver.resolve({...track, id: 'multiple-profiles'}), null, 'requires one unambiguous official SoundCloud profile');

const genericStreamingRelationResolver = new OfficialSoundCloudResolver(new FakeCache() as unknown as KeyValueCacheProvider, {
  requestJson: makeRequestJson([{type: 'free streaming', url: {resource: profileUrl}}]),
  getMetadata: async () => profileMetadata,
});
assert.equal(await genericStreamingRelationResolver.resolve({...track, id: 'wrong-relation-type'}), null, 'requires MusicBrainz relation type soundcloud');
