import {strict as assert} from 'node:assert';
import SpotifyQueueResolver from '../src/services/spotify-queue-resolver.js';
import type {MediaSource, SongMetadata} from '../src/services/player.js';
import type {SpotifyTrack} from '../src/services/spotify-api.js';
import type SpotifyTrackResolver from '../src/services/spotify-track-resolver.js';
import type {SongSelectionCandidate} from '../src/services/youtube-api.js';
import type GetSongs from '../src/services/get-songs.js';

const spotifyTrack: SpotifyTrack = {
  id: 'spotify-track-1',
  url: 'https://open.spotify.com/track/spotify-track-1',
  name: 'Snow halation',
  artist: 'μ\'s',
  durationMs: 254_000,
};

const song: SongMetadata = {
  source: 0 as MediaSource,
  title: 'Snow halation',
  artist: 'μ\'s - Topic',
  length: 254,
  offset: 0,
  url: 'youtube-video-1',
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
};

const candidate: SongSelectionCandidate = {
  videoId: 'youtube-video-1',
  title: 'Snow halation',
  artist: 'μ\'s - Topic',
  length: 254,
  thumbnailUrl: null,
  isLive: false,
  score: 100,
  songs: [song],
  titleMatch: true,
  exactTitleMatch: true,
  artistMatch: true,
  durationDeltaSeconds: 0,
};

const getSongs = {
  async getSpotifyTracks() {
    return [[spotifyTrack], {title: 'Love Live', source: 'playlist-1'}];
  },
} as unknown as GetSongs;

const spotifyTrackResolver = {
  async resolve() {
    return {
      status: 'uncertain',
      candidates: [candidate],
      songs: [],
    };
  },
  attachSpotifyOrigin(track: SpotifyTrack, songs: SongMetadata[]) {
    return songs.map(song => ({
      ...song,
      spotifyOrigin: {
        spotifyTrackId: track.id,
        spotifyUrl: track.url,
        spotifyName: track.name,
        spotifyArtist: track.artist,
        spotifyDurationMs: track.durationMs,
        matchSource: 'timeout-top' as const,
      },
    }));
  },
} as unknown as SpotifyTrackResolver;

const resolver = new SpotifyQueueResolver(getSongs, spotifyTrackResolver);
const resolution = await resolver.resolveQuery('https://open.spotify.com/playlist/test', 50, false);

assert.equal(resolution.trackResolutions.length, 1);
assert.equal(resolution.trackResolutions[0].matchSource, 'timeout-top');
assert.equal(resolution.trackResolutions[0].selectedCandidate?.videoId, candidate.videoId);
assert.equal(resolution.songs[0].url, song.url);
assert.equal(resolution.songs[0].spotifyOrigin?.spotifyTrackId, spotifyTrack.id);
assert.equal(resolution.uncertainSpotifyTracks[0].id, spotifyTrack.id);
