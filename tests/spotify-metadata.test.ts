import assert from 'node:assert/strict';
import SpotifyScraper from '../src/services/spotify-scraper.js';

const scraper = new SpotifyScraper() as unknown as {
  extractTracks: (values: unknown[]) => Array<Record<string, unknown>>;
};

const [track] = scraper.extractTracks([{
  __typename: 'Track',
  uri: 'spotify:track:track-id',
  name: ')✧⃛*',
  duration: {totalMilliseconds: 139_842},
  discNumber: 1,
  trackNumber: 1,
  firstArtist: {
    __typename: 'Artist',
    uri: 'spotify:artist:artist-id',
    profile: {name: 'Glyph Artist'},
  },
  albumOfTrack: {
    uri: 'spotify:album:album-id',
    name: 'Glyph Album',
  },
}]);

assert.equal(track.id, 'track-id');
assert.equal(track.artist, 'Glyph Artist');
assert.equal(track.artistId, 'artist-id');
assert.equal(track.albumId, 'album-id');
assert.equal(track.albumName, 'Glyph Album');
assert.equal(track.discNumber, 1);
assert.equal(track.trackNumber, 1);
assert.equal(track.durationMs, 139_842);

const albumScraper = new SpotifyScraper() as unknown as {
  getPagedEntity: () => Promise<unknown[]>;
  getAlbum: (id: string, playlistLimit: number) => Promise<[Array<Record<string, unknown>>, unknown]>;
};
albumScraper.getPagedEntity = async () => [{
  __typename: 'Album',
  uri: 'spotify:album:enclosing-album-id',
  name: 'Enclosing Album',
  tracks: {items: [{
    __typename: 'Track',
    uri: 'spotify:track:album-track-id',
    name: 'Album Track',
    duration: {totalMilliseconds: 180_000},
    discNumber: 1,
    trackNumber: 1,
    firstArtist: {
      __typename: 'Artist',
      uri: 'spotify:artist:artist-id',
      profile: {name: 'Album Artist'},
    },
  }]},
}];

const [[albumTrack]] = await albumScraper.getAlbum('enclosing-album-id', 50);
assert.equal(albumTrack.albumId, 'enclosing-album-id', 'inherits the enclosing album id when track nodes omit it');
assert.equal(albumTrack.albumName, 'Enclosing Album', 'inherits the enclosing album name when track nodes omit it');
