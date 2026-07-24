import assert from 'node:assert/strict';
import {MediaSource} from '../src/services/media-source.js';
import type {YtDlpMetadataOptions} from '../src/utils/yt-dlp.js';

const {
  default: SoundCloudResolver,
  isSoundCloudUrl,
  parseSoundCloudMetadata,
} = await import('../src/services/soundcloud-resolver.js');

const trackUrl = 'https://soundcloud.com/example-artist/example-track';
const singleMetadata = {
  title: 'Example Track',
  uploader: 'Example Artist',
  duration: 181.25,
  webpage_url: trackUrl,
  url: 'https://cf-media.sndcdn.com/temporary-signed-audio',
  thumbnail: 'https://i1.sndcdn.com/artworks-example-large.jpg',
};

assert.equal(isSoundCloudUrl(trackUrl), true);
assert.equal(isSoundCloudUrl('https://on.soundcloud.com/abc123'), true);
assert.equal(isSoundCloudUrl('https://soundcloud.example.com/not-soundcloud'), false);

const parsedSingle = parseSoundCloudMetadata(singleMetadata, trackUrl);
assert.equal(parsedSingle.isPlaylist, false);
assert.deepEqual(parsedSingle.songs, [{
  title: 'Example Track',
  artist: 'Example Artist',
  url: trackUrl,
  length: 181.25,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: 'https://i1.sndcdn.com/artworks-example-large.jpg',
  source: MediaSource.SoundCloud,
}]);

let singleOptions: YtDlpMetadataOptions | undefined;
const singleResolver = new SoundCloudResolver({
  getMetadata: async (_url, options) => {
    singleOptions = options;
    return singleMetadata;
  },
});
const [singleSong] = await singleResolver.resolve(trackUrl, 100, false);
assert.equal(singleSong.url, trackUrl, 'queues the stable SoundCloud page instead of the temporary CDN URL');
assert.deepEqual(singleOptions, {playlistEnd: 100});

const playlistUrl = 'https://soundcloud.com/example-artist/sets/example-set';
const playlistEntries = Array.from({length: 101}, (_, index) => {
  const trackNumber = index + 1;
  return {
    title: `Track ${trackNumber.toString()}`,
    uploader: 'Example Artist',
    duration: 120 + trackNumber,
    webpage_url: `https://soundcloud.com/example-artist/track-${trackNumber.toString()}`,
  };
});
const playlistMetadata = {
  _type: 'playlist',
  title: 'Example Set',
  webpage_url: playlistUrl,
  entries: playlistEntries,
};

let orderedOptions: YtDlpMetadataOptions | undefined;
const orderedResolver = new SoundCloudResolver({
  getMetadata: async (_url, options) => {
    orderedOptions = options;
    return playlistMetadata;
  },
});
const orderedSongs = await orderedResolver.resolve(playlistUrl, 100, false);
assert.equal(orderedSongs.length, 100);
assert.equal(orderedSongs[0].title, 'Track 1');
assert.equal(orderedSongs[99].title, 'Track 100');
assert.deepEqual(orderedOptions, {playlistEnd: 100}, 'limits ordered metadata extraction');
assert.deepEqual(orderedSongs[0].playlist, {title: 'Example Set', source: playlistUrl});

let shuffledOptions: YtDlpMetadataOptions | undefined;
const shuffledResolver = new SoundCloudResolver({
  getMetadata: async (_url, options) => {
    shuffledOptions = options;
    return playlistMetadata;
  },
  random: () => 0,
});
const shuffledSongs = await shuffledResolver.resolve(playlistUrl, 100, true);
assert.equal(shuffledSongs.length, 100);
assert.ok(shuffledSongs.some(song => song.title === 'Track 101'), 'shuffle selects from the entire set before applying the limit');
assert.deepEqual(shuffledOptions, {}, 'does not truncate metadata before shuffling');

await assert.rejects(
  new SoundCloudResolver({getMetadata: async () => ({title: 'Private'})}).resolve(trackUrl),
  /no playable public tracks/,
);

console.log('soundcloud resolver tests passed');
