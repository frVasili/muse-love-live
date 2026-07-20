import assert from 'node:assert/strict';
import type YoutubeAPI from '../src/services/youtube-api.js';
import type {SongSelectionCandidate} from '../src/services/youtube-api.js';
import type {SpotifyTrack} from '../src/services/spotify-api.js';
import type {MediaSource} from '../src/services/player.js';
import type OfficialBandcampResolver from '../src/services/official-bandcamp-resolver.js';

process.env.DISCORD_TOKEN = 'test-token';
process.env.YOUTUBE_API_KEY = 'test-key';
const {default: SpotifyTrackResolver} = await import('../src/services/spotify-track-resolver.js');

const track: SpotifyTrack = {
  id: 'spotify-track',
  url: 'https://open.spotify.com/track/spotify-track',
  name: 'Example Song',
  artist: '日本語アーティスト',
  durationMs: 240_000,
};

const candidate = (overrides: Partial<SongSelectionCandidate>): SongSelectionCandidate => ({
  videoId: 'video-id',
  title: 'Example Song',
  artist: 'Romanized Artist - Topic',
  length: 240,
  thumbnailUrl: null,
  isLive: false,
  score: 1000,
  songs: [{
    source: 0 as MediaSource,
    title: 'Example Song',
    artist: 'Romanized Artist - Topic',
    length: 240,
    offset: 0,
    url: 'video-id',
    playlist: null,
    isLive: false,
    thumbnailUrl: null,
  }],
  titleMatch: true,
  exactTitleMatch: true,
  artistMatch: false,
  spotifySource: 'topic',
  durationDeltaSeconds: 1,
  ...overrides,
});

let primaryCalls = 0;
let fallbackCalls = 0;
const primaryMatch = candidate({});
const primaryApi = {
  async searchSpotifyTrackCandidates() {
    primaryCalls++;
    return [primaryMatch];
  },
  async searchSpotifyTrackFallbackCandidates() {
    fallbackCalls++;
    return [];
  },
} as unknown as YoutubeAPI;

const primaryResolution = await new SpotifyTrackResolver(primaryApi).resolve(track, false);
assert.equal(primaryResolution.status, 'high-confidence');
assert.equal(primaryCalls, 1, 'uses one primary search for a confident match');
assert.equal(fallbackCalls, 0, 'does not run a redundant fallback search');

primaryCalls = 0;
fallbackCalls = 0;
const weakCandidate = candidate({videoId: 'weak', spotifySource: 'unofficial', durationDeltaSeconds: 8, score: 400});
const fallbackMatch = candidate({videoId: 'fallback', spotifySource: 'official-audio', score: 900});
const fallbackApi = {
  async searchSpotifyTrackCandidates() {
    primaryCalls++;
    return [weakCandidate];
  },
  async searchSpotifyTrackFallbackCandidates() {
    fallbackCalls++;
    return [fallbackMatch];
  },
} as unknown as YoutubeAPI;

const fallbackResolution = await new SpotifyTrackResolver(fallbackApi).resolve(track, false);
assert.equal(fallbackResolution.status, 'high-confidence');
assert.equal(fallbackResolution.candidates[0].videoId, fallbackMatch.videoId);
assert.equal(primaryCalls, 1);
assert.equal(fallbackCalls, 1, 'runs at most one Topic fallback for an uncertain primary result');

fallbackCalls = 0;
const failedSearchApi = {
  async searchSpotifyTrackCandidates() {
    throw new Error('Response code 429 (Too Many Requests)');
  },
  async searchSpotifyTrackFallbackCandidates() {
    fallbackCalls++;
    return [];
  },
} as unknown as YoutubeAPI;

await assert.rejects(
  new SpotifyTrackResolver(failedSearchApi).resolve(track, false),
  /429/,
  'propagates YouTube API failures instead of reporting the track as missing',
);
assert.equal(fallbackCalls, 0, 'does not spend another search request after an API failure');

const quotaLimitedFallbackApi = {
  async searchSpotifyTrackCandidates() {
    return [weakCandidate];
  },
  async searchSpotifyTrackFallbackCandidates() {
    throw new Error('Response code 429 (Too Many Requests)');
  },
} as unknown as YoutubeAPI;

const quotaLimitedResolution = await new SpotifyTrackResolver(quotaLimitedFallbackApi).resolve(track, false);
assert.equal(quotaLimitedResolution.status, 'uncertain');
assert.deepEqual(quotaLimitedResolution.songs, [], 'skips only the unresolved track when its optional fallback hits quota');

let bandcampCalls = 0;
const officialBandcampResolver = {
  async resolve() {
    bandcampCalls++;
    return {
      provider: 'bandcamp' as const,
      url: 'https://artist.bandcamp.com/track/example-song',
      title: track.name,
      artist: track.artist,
      length: 240,
      thumbnailUrl: null,
      durationDeltaSeconds: 0,
      confidenceEvidence: ['musicbrainz-artist-bandcamp-relation'],
    };
  },
} as unknown as OfficialBandcampResolver;
const noSafeYouTubeApi = {
  async searchSpotifyTrackCandidates() {
    return [weakCandidate];
  },
  async searchSpotifyTrackFallbackCandidates() {
    return [];
  },
} as unknown as YoutubeAPI;
const bandcampResolution = await new SpotifyTrackResolver(noSafeYouTubeApi, officialBandcampResolver).resolve(track, false);
assert.equal(bandcampResolution.status, 'high-confidence');
assert.equal(bandcampResolution.selectedMatch?.provider, 'bandcamp');
assert.equal(bandcampResolution.songs[0].source, 2 as MediaSource);
assert.equal(bandcampResolution.songs[0].url, 'https://artist.bandcamp.com/track/example-song');
assert.equal(bandcampResolution.songs[0].spotifyOrigin?.provider, 'bandcamp');
assert.equal(bandcampCalls, 1, 'tries the official Bandcamp provider after YouTube remains uncertain');

bandcampCalls = 0;
await new SpotifyTrackResolver(primaryApi, officialBandcampResolver).resolve(track, false);
assert.equal(bandcampCalls, 0, 'never invokes Bandcamp after a high-confidence YouTube match');
