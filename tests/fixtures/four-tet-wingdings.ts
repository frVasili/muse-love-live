import type {SpotifyTrack} from '../../src/services/spotify-api.js';
import type {YtDlpPlaylistEntry} from '../../src/utils/yt-dlp.js';

export const glyphArtist = '⣎⡇ꉺლ༽இ•̛)ྀ◞ ༎ຶ ༽ৣৢ؞ৢ؞ؖ ꉺლ';

export const glyphTracks: SpotifyTrack[] = [
  {
    id: '4IoKhypOMtLZd0qsejlB1C',
    url: 'https://open.spotify.com/track/4IoKhypOMtLZd0qsejlB1C',
    name: ')✧⃛*',
    artist: glyphArtist,
    durationMs: 139_842,
    artistId: '1TIbqr0x8HoKzKBNtNN8wf',
    albumId: '2sH6A5CeThHXMZ8ZX6iROz',
    albumName: ')✧⃛*',
    discNumber: 1,
    trackNumber: 1,
  },
  {
    id: '5S0yiOErSgkU4yRsz6amKN',
    url: 'https://open.spotify.com/track/5S0yiOErSgkU4yRsz6amKN',
    name: 'ƪ. ◖ƪ❍⊁◞.|◗щ (*ㅇ△₊⁎❝᷀ົཽ*ೃ:(꒡͡ ❝᷀ົཽ ꉺ¨.·*:･✧⃛(ཽ๑',
    artist: glyphArtist,
    durationMs: 190_344,
    artistId: '1TIbqr0x8HoKzKBNtNN8wf',
    albumId: '2sH6A5CeThHXMZ8ZX6iROz',
    albumName: ')✧⃛*',
    discNumber: 1,
    trackNumber: 2,
  },
  {
    id: '05mO22Uzz4AcVTFTrZRxQd',
    url: 'https://open.spotify.com/track/05mO22Uzz4AcVTFTrZRxQd',
    name: '✧₊⁎❝᷀ົཽ*ೃƪ❍⊁ƪ❍⊁༽ৣৢ؞ৢ؞ؖ ཥ',
    artist: glyphArtist,
    durationMs: 156_631,
    artistId: '1TIbqr0x8HoKzKBNtNN8wf',
    albumId: '2sH6A5CeThHXMZ8ZX6iROz',
    albumName: ')✧⃛*',
    discNumber: 1,
    trackNumber: 3,
  },
  {
    id: '5rlDQncF1ud0XjYVCS9vjj',
    url: 'https://open.spotify.com/track/5rlDQncF1ud0XjYVCS9vjj',
    name: '̟̞̝̜̙̘̗̖҉̵̴̨̧̢̡̼̻̺̹̳̲̱̰̯̮̭̬̫̪̩̦̥̤̣̠҈͈͇͉͍͎͓͔͕͖͙͚͜͢͢͢͢͢͢͢͢͢͢͢͢͢͢ͅ ఠీੂ೧ູ࿃ूੂ✧ළʅ͡͡͡͡͡͡͡͡͡͡͡(ƪ❍⊁◞..◟⊀ ̟̞̝̜̙̘̗̖҉̵̴̨̧̢̡̼̻̺̹̳̲̱̰̯̮̭̬̫̪̩̦̥̤̣̠҈͈͇͉͍͎͓͔͕͖͙͚͜͢͢͢͢͢͢͢͢͢͢͢͢͢͢ͅ',
    artist: glyphArtist,
    durationMs: 337_500,
    artistId: '1TIbqr0x8HoKzKBNtNN8wf',
    albumId: '7tZo2dx2IQc8FSKuGYhfJQ',
    albumName: 'ooo ̟̞̝̜̙̘̗̖҉̵̴̨̧̢̡̼̻̺̹̳̲̱̰̯̮̭̬̫̪̩̦̥̤̣̠҈͈͇͉͍͎͓͔͕͖͙͚͜͢͢͢͢͢͢͢͢͢͢͢͢͢͢ͅ oʅ͡͡͡͡͡͡͡͡͡͡͡( ؞ৢ؞ؙؖ⁽⁾˜ัิีึื์๎้็๋๊⦁0 ̟̞̝̜̙̘̗̖҉̵̴̨̧̢̡̼̻̺̹̳̲̱̰̯̮̭̬̫̪̩̦̥̤̣̠҈͈͇͉͍͎͓͔͕͖͙͚͜͢͢͢͢͢͢͢͢͢͢͢͢͢͢ͅ ఠీੂ೧ູ࿃ूੂ',
    discNumber: 1,
    trackNumber: 1,
  },
];

export const releaseFor = (track: SpotifyTrack, bandcampAlbumUrl?: string) => ({
  'artist-credit': [{name: glyphArtist}],
  media: [{
    position: 1,
    tracks: [{
      position: track.trackNumber,
      title: track.name,
      length: track.durationMs,
      'artist-credit': [{name: glyphArtist}],
    }],
  }],
  relations: bandcampAlbumUrl ? [{url: {resource: bandcampAlbumUrl}}] : [],
});

export const bandcampEntryFor = (track: SpotifyTrack, url: string): YtDlpPlaylistEntry => ({
  title: track.name,
  durationSeconds: (track.durationMs ?? 0) / 1000,
  webpageUrl: url,
  uploader: glyphArtist,
  playlistIndex: track.trackNumber ?? 1,
});
