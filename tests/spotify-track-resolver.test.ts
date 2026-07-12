import assert from 'node:assert/strict';
import type YoutubeAPI from '../src/services/youtube-api.js';
import type {SongSelectionCandidate} from '../src/services/youtube-api.js';
import type {SpotifyTrack} from '../src/services/spotify-api.js';
import type {MediaSource} from '../src/services/player.js';

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
