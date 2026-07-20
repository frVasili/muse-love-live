import assert from 'node:assert/strict';
import {classifySpotifyCandidates} from '../src/utils/spotify-track-resolution.js';
import {
  buildSpotifySearchQuery,
  buildSpotifyArtistTopicSearchQuery,
  buildSpotifyTopicSearchQuery,
  getSpotifyTitleMatch,
  isSpotifyDurationCandidateAllowed,
  isSpotifyVideoCandidateAllowed,
  scoreSpotifyVideoMatch,
} from '../src/utils/spotify-video-match.js';
import type {SpotifyVideoCandidate, TrackSearchContext} from '../src/utils/spotify-video-match.js';
import type {SongSelectionCandidate} from '../src/services/youtube-api.js';

const track = (name: string, artist = '日本語アーティスト', durationMs = 240_000): TrackSearchContext => ({name, artist, durationMs});
const video = (title: string, channelTitle: string): SpotifyVideoCandidate => ({snippet: {title, channelTitle}});

const unicodeTrack = track('星のシグナル！');
const romanizedTopic = video('星のシグナル！', 'Romanized Artist - Topic');
const topicMatch = getSpotifyTitleMatch(romanizedTopic, unicodeTrack);

assert.equal(topicMatch.exactTitleMatch, true, 'matches Unicode titles after punctuation normalization');
assert.equal(topicMatch.artistMatch, false, 'does not require Japanese and romanized artist names to match');
assert.equal(topicMatch.source, 'topic', 'recognizes Topic channels independently of artist spelling');
assert.equal(isSpotifyVideoCandidateAllowed(romanizedTopic, unicodeTrack), true);
assert.equal(buildSpotifySearchQuery(unicodeTrack), '"星のシグナル！" 日本語アーティスト', 'uses one focused artist-aware query');
assert.equal(buildSpotifyTopicSearchQuery(unicodeTrack), '星のシグナル Topic', 'uses a normalized unquoted Topic fallback so YouTube can resolve romanized artists and punctuation variants');
assert.equal(buildSpotifyTopicSearchQuery(track('にこぷり▽女子道')), 'にこぷり 女子道 Topic', 'ignores decorative symbols that differ between Spotify and YouTube');
assert.equal(buildSpotifyTopicSearchQuery(track('シェキラ☆☆☆')), 'シェキラ Topic', 'does not require decorative stars to appear in YouTube search metadata');
assert.equal(buildSpotifyArtistTopicSearchQuery(track('Holiday∞Holiday', 'スリーズブーケ')), 'holiday holiday スリーズブーケ Topic', 'adds artist context for ambiguous normalized titles');
assert.equal(buildSpotifyTopicSearchQuery(track(')✧⃛*')), '', 'does not spend a fallback search on an empty normalized glyph title');
assert.equal(
  buildSpotifyArtistTopicSearchQuery(track('✧₊⁎❝᷀ົཽ*ೃƪ❍⊁ƪ❍⊁༽ৣৢ؞ৢ؞ؖ ཥ', 'glyph artist')),
  '',
  'does not search with a few meaningless letter-like glyph fragments',
);

const officialLyrics = video('Example Unit『星のシグナル！』Official Lyric Video', '(Example series)公式チャンネル');
const officialLyricsTrack = track('星のシグナル！', 'Example Unit');
const officialLyricsMatch = getSpotifyTitleMatch(officialLyrics, officialLyricsTrack);

assert.equal(officialLyricsMatch.exactTitleMatch, true);
assert.equal(officialLyricsMatch.source, 'official-audio');
assert.equal(isSpotifyVideoCandidateAllowed(officialLyrics, officialLyricsTrack), true, 'accepts official lyric audio');
assert.equal(
  getSpotifyTitleMatch(video('Music (Official Audio)', 'Example - Topic'), track('Music', 'Example')).exactTitleMatch,
  true,
  'does not strip words that are part of the Spotify title',
);

assert.equal(isSpotifyVideoCandidateAllowed(video('星のシグナル！ Lyrics', 'Fan Lyrics'), unicodeTrack), false, 'rejects unofficial lyric uploads');
assert.equal(isSpotifyVideoCandidateAllowed(video('星のシグナル！ covered by Fan', 'Fan'), unicodeTrack), false, 'rejects covers');
assert.equal(isSpotifyVideoCandidateAllowed(video('星のシグナル！ (Off Vocal)', 'Example - Topic'), unicodeTrack), false, 'rejects non-vocal versions');
assert.equal(isSpotifyVideoCandidateAllowed(video('星のシグナル！ Live at Arena', 'Official Channel'), unicodeTrack), false, 'rejects live versions even on official channels');
assert.equal(isSpotifyVideoCandidateAllowed(video('星のシグナル！ Remix', 'Example - Topic'), unicodeTrack), false, 'rejects an unexpected remix');
assert.equal(isSpotifyVideoCandidateAllowed(video('星のシグナル！ Remix', 'Example - Topic'), track('星のシグナル！ Remix')), true, 'allows a remix identified by Spotify');
assert.equal(isSpotifyVideoCandidateAllowed(video('星のシグナル！ (Character Solo Ver.)', 'Character - Topic'), unicodeTrack), false, 'rejects an unexpected solo version');
assert.equal(isSpotifyVideoCandidateAllowed(video('星のシグナル！ Character Solo Ver.', 'Character - Topic'), track('星のシグナル！ Character Solo Ver.')), true, 'allows a solo version identified by Spotify');
assert.equal(isSpotifyVideoCandidateAllowed(video('星のシグナル！ but no chorus', 'Fan Upload'), unicodeTrack), false, 'rejects deliberately altered versions');
assert.equal(isSpotifyVideoCandidateAllowed(video('星のシグナル！ Esp Rom', 'Fan Upload'), unicodeTrack), false, 'rejects unofficial translation and romanization uploads');

assert.equal(isSpotifyDurationCandidateAllowed(260, unicodeTrack), true);
assert.equal(isSpotifyDurationCandidateAllowed(261, unicodeTrack), false, 'limits candidates to twenty seconds of Spotify duration');

const unofficialMatch = getSpotifyTitleMatch(video('日本語アーティスト - 星のシグナル！', 'Fan Upload'), unicodeTrack);
assert.ok(scoreSpotifyVideoMatch(topicMatch, 2) > scoreSpotifyVideoMatch(unofficialMatch, 0), 'prefers Topic audio over a duration-perfect unofficial upload');

const candidate = (overrides: Partial<SongSelectionCandidate>): SongSelectionCandidate => ({
  videoId: 'video-id',
  title: '星のシグナル！',
  artist: 'Romanized Artist - Topic',
  length: 240,
  thumbnailUrl: null,
  isLive: false,
  score: 1000,
  songs: [],
  titleMatch: true,
  exactTitleMatch: true,
  artistMatch: false,
  spotifySource: 'topic',
  durationDeltaSeconds: 2,
  ...overrides,
});

assert.equal(classifySpotifyCandidates([candidate({})]).status, 'high-confidence', 'accepts Topic audio without an artist-name match');
assert.equal(
  classifySpotifyCandidates([candidate({exactTitleMatch: false, titleMatch: true, spotifySource: 'topic'})]).status,
  'high-confidence',
  'accepts a Topic title prefixed by a differently romanized artist name',
);
assert.equal(classifySpotifyCandidates([candidate({spotifySource: 'unofficial', artistMatch: false, durationDeltaSeconds: 8})]).status, 'uncertain', 'does not auto-accept a weakly attributed unofficial upload');

assert.equal(isSpotifyVideoCandidateAllowed(video('Example Song (ELI Mix)', 'Character - Topic'), track('Example Song')), false, 'rejects an unexpected character mix');
assert.equal(isSpotifyVideoCandidateAllowed(video('Example Song (ELI Mix)', 'Character - Topic'), track('Example Song (ELI Mix)')), true, 'allows a mix identified by Spotify');
assert.equal(isSpotifyVideoCandidateAllowed(video('\u3010\u632f\u308a\u4ed8\u3051\u52d5\u753b\u3011Example Song', 'Official Channel'), track('Example Song')), false, 'rejects official choreography videos');

assert.equal(
  classifySpotifyCandidates([candidate({spotifySource: 'unofficial', exactTitleMatch: true, artistMatch: true, durationDeltaSeconds: 1})]).status,
  'uncertain',
  'never silently promotes an unofficial upload based only on title and duration',
);
