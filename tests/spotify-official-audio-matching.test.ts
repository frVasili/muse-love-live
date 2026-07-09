import {strict as assert} from 'node:assert';
import {isSpotifyDurationCandidateAllowed, isSpotifyVideoCandidateAllowed} from '../src/utils/spotify-video-match.js';
import type {SpotifyVideoCandidate, TrackSearchContext} from '../src/utils/spotify-video-match.js';

const track = (name: string, artist = 'Muse', durationMs = 240_000): TrackSearchContext => ({
  name,
  artist,
  durationMs,
});

const video = (title: string, channelTitle = 'Muse - Topic'): SpotifyVideoCandidate => ({
  snippet: {
    title,
    channelTitle,
  },
});

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Supermassive Black Hole'), track('Supermassive Black Hole')),
  true,
  'allows an exact official title match',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Muse - Supermassive Black Hole (Official Audio)', 'Muse'), track('Supermassive Black Hole')),
  true,
  'allows an official artist-title upload',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Phantom Rocket Adventure - Guilty Kiss', 'Guilty Kiss - Topic'), track('Phantom Rocket Adventure', 'Guilty Kiss')),
  true,
  'allows an artist suffix from a Topic channel when the remaining title is exact',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Snow halation', 'Official Artist Channel'), track('Snow halation', 'Spotify Artist')),
  true,
  'does not require Spotify artist names to match YouTube channel names',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('#AiScReam 「愛♡スクリ～ム！」 Music Video', '(Love Live! series) Official Channel'), track('愛♡スクリ～ム！', 'AiScReam')),
  true,
  'allows official uploads where the artist tag prefixes the song title',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Love Triangle - DiverDiva', 'DiverDiva - Topic'), track('Love Triangle', 'DiverDiva')),
  true,
  'allows official uploads where the artist wraps the title',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Starlight', 'Muse - Topic'), track('Supermassive Black Hole')),
  false,
  'rejects a wrong title even from the right artist/channel',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Supermassive Black Hole', 'Different Artist Channel'), track('Supermassive Black Hole')),
  true,
  'allows exact-title uploads even when channel names do not match Spotify',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Hololive 3rd Generation - 輝夜の城で踊りたい', 'Random Channel'), track('輝夜の城で踊りたい', 'Spotify Artist')),
  false,
  'rejects long unrelated titles that only contain the Spotify title',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Starlight', 'Muse - Topic'), track('Supermassive Black Hole', 'Muse', 240_000)),
  false,
  'rejects a wrong title even when duration is perfect',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Supermassive Black Hole Cover', 'Random Channel'), track('Supermassive Black Hole')),
  false,
  'rejects unofficial cover uploads',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Supermassive Black Hole Remix', 'Random Channel'), track('Supermassive Black Hole')),
  false,
  'rejects unofficial remix uploads',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Supermassive Black Hole Reaction', 'Random Channel'), track('Supermassive Black Hole')),
  false,
  'rejects reaction uploads',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Supermassive Black Hole Lyrics', 'Random Channel'), track('Supermassive Black Hole')),
  false,
  'rejects lyric reuploads',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Snow halation Color Coded Lyrics', 'Random Channel'), track('Snow halation')),
  false,
  'rejects color-coded lyric uploads',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Supermassive Black Hole live at Wembley', 'Random Channel'), track('Supermassive Black Hole')),
  false,
  'rejects obvious live performance uploads without rejecting Love Live metadata',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Supermassive Black Hole #shorts', 'Random Channel'), track('Supermassive Black Hole')),
  false,
  'rejects shorts-style uploads',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('Cutie Panther Mirror', 'Random Channel'), track('Cutie Panther', 'BiBi')),
  false,
  'rejects mirrored uploads',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('レム (Off Vocal)', 'DOLLCHESTRA - Topic'), track('レム', 'DOLLCHESTRA')),
  false,
  'rejects off-vocal versions',
);

assert.equal(
  isSpotifyVideoCandidateAllowed(video('【ガイドなし】愛♡スクリ～ム！/AiScReam【カラオケ】', 'Random Channel'), track('愛♡スクリ～ム！', 'AiScReam')),
  false,
  'rejects Japanese karaoke uploads',
);

assert.equal(
  isSpotifyDurationCandidateAllowed(240, track('Supermassive Black Hole', 'Muse', 240_000)),
  true,
  'allows close Spotify candidate durations',
);

assert.equal(
  isSpotifyDurationCandidateAllowed(320, track('Supermassive Black Hole', 'Muse', 240_000)),
  false,
  'rejects candidates with clearly wrong durations',
);
