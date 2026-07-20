import assert from 'node:assert/strict';
import SpotifyQueueResolver from '../src/services/spotify-queue-resolver.js';
import type {SpotifyTrack} from '../src/services/spotify-api.js';
import type SpotifyTrackResolver from '../src/services/spotify-track-resolver.js';
import type {SongSelectionCandidate} from '../src/services/youtube-api.js';
import type GetSongs from '../src/services/get-songs.js';

const spotifyTrack: SpotifyTrack = {
  id: 'spotify-track-1',
  url: 'https://open.spotify.com/track/spotify-track-1',
  name: 'Example Song',
  artist: '日本語アーティスト',
  durationMs: 254_000,
};

const candidate: SongSelectionCandidate = {
  videoId: 'youtube-video-1',
  title: 'Example Song',
  artist: 'Romanized Artist - Topic',
  length: 254,
  thumbnailUrl: null,
  isLive: false,
  score: 100,
  songs: [],
  titleMatch: true,
  exactTitleMatch: true,
  artistMatch: false,
  spotifySource: 'unofficial',
  durationDeltaSeconds: 8,
};

const getSongs = {
  async getSpotifyTracks() {
    return [[spotifyTrack], {title: 'Example Playlist', source: 'playlist-1'}];
  },
} as unknown as GetSongs;

const spotifyTrackResolver = {
  async resolve() {
    return {status: 'uncertain', candidates: [candidate], songs: []};
  },
} as unknown as SpotifyTrackResolver;

const resolver = new SpotifyQueueResolver(getSongs, spotifyTrackResolver);
const resolution = await resolver.resolveQuery('https://open.spotify.com/playlist/test', 50, false);

assert.equal(resolution.trackResolutions.length, 1);
assert.equal(resolution.trackResolutions[0].matchSource, 'not-found');
assert.equal(resolution.trackResolutions[0].selectedCandidate?.videoId, candidate.videoId, 'keeps the rejected candidate available for audits');
assert.equal(resolution.songs.length, 0, 'uncertain matches are not silently queued');
assert.equal(resolution.songsNotFound[0].id, spotifyTrack.id);
assert.equal(resolution.autoMatchedCount, 0);

const bandcampSong = {
  source: 2,
  title: spotifyTrack.name,
  artist: spotifyTrack.artist,
  length: 254,
  offset: 0,
  url: 'https://artist.bandcamp.com/track/example-song',
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
};
const bandcampTrackResolver = {
  async resolve() {
    return {
      status: 'high-confidence',
      candidates: [candidate],
      songs: [bandcampSong],
      selectedMatch: {
        provider: 'bandcamp',
        url: bandcampSong.url,
        title: bandcampSong.title,
        artist: bandcampSong.artist,
        length: bandcampSong.length,
        thumbnailUrl: null,
        isLive: false,
        score: 1_000,
        songs: [bandcampSong],
        confidenceEvidence: ['official-bandcamp'],
      },
    };
  },
} as unknown as SpotifyTrackResolver;
const bandcampResolution = await new SpotifyQueueResolver(getSongs, bandcampTrackResolver)
  .resolveQuery('https://open.spotify.com/playlist/test', 50, false);
assert.equal(bandcampResolution.autoMatchedCount, 1);
assert.equal(bandcampResolution.trackResolutions[0].selectedMatch?.provider, 'bandcamp');
assert.equal(bandcampResolution.trackResolutions[0].selectedCandidate, undefined, 'does not expose a rejected YouTube candidate as the selected Bandcamp result');
assert.equal(bandcampResolution.songsNotFound.length, 0);
