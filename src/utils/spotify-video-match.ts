export interface SpotifyVideoCandidate {
  snippet: {
    title: string;
    channelTitle: string;
  };
}

export type TrackSearchContext = {
  name: string;
  artist: string;
  durationMs?: number;
};

const UNOFFICIAL_REJECT_SIGNALS = /\b(cover|karaoke|instrumental|remix|nightcore|reaction|clip|clips|short|shorts|comparison|compared|vs|lyric|lyrics|translation|translated|subbed|subtitle|subtitles|mirror|mirrored|mmd|beatsaber|beat saber|amv|mad|piano|orchestra)\b/;
const UNOFFICIAL_REUPLOAD_PHRASES = /\b(color coded|sped up|slowed down|slowed reverb|one hour|1 hour|extended loop)\b/;
const UNOFFICIAL_PENALTY_SIGNALS = /\b(cover|karaoke|instrumental|remix|nightcore|reaction|live|mirror|mirrored)\b/;
const LIVE_UPLOAD_REJECT_SIGNALS = /\b(live at|live from|live version|live performance|live concert|final live|unit live|live action|live day)\b/;
const UNOFFICIAL_NON_ASCII_SIGNALS = /\u5207\u308a\u629c\u304d|\u6b4c\u3063\u3066\u307f\u305f|\u8e0a\u3063\u3066\u307f\u305f|\u5f3e\u3044\u3066\u307f\u305f|\u6bd4\u3079\u3066\u307f\u305f|\u6bd4\u8f03|\u3069\u3063\u3061\u304c\u597d\u304d|\u30ab\u30e9\u30aa\u30b1|\u30ac\u30a4\u30c9\u306a\u3057|\u6b4c\u8a5e|\u8010\u4e45|\u30aa\u30eb\u30b4\u30fc\u30eb|\u30d4\u30a2\u30ce|\u30e9\u30a4\u30d6\u6620\u50cf|\u6f14\u594f\u3057\u3066\u307f\u305f/;
const NON_AUDIO_VERSION_SIGNALS = /\b(off vocal|off-vocal|tv size|tv-size|game size|game-size|full combo)\b/;
const OFFICIAL_TITLE_TEXT = /\b(official|audio|video|music|mv|lyric|lyrics|visualizer|topic|provided to youtube by)\b/g;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSearchText = (value: string): string => value
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const removeOfficialTitleText = (value: string): string => value
  .replace(OFFICIAL_TITLE_TEXT, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const removeArtistFromTitle = (title: string, artist: string): string => {
  if (!artist) {
    return title;
  }

  return title
    .replace(new RegExp(`^${escapeRegExp(artist)}\\s+`, 'u'), '')
    .replace(new RegExp(`\\s+${escapeRegExp(artist)}$`, 'u'), '')
    .trim();
};

export const hasNonSongSignals = (title: string, channel: string): boolean => {
  const text = `${title} ${channel}`;

  return UNOFFICIAL_REJECT_SIGNALS.test(text)
    || UNOFFICIAL_REUPLOAD_PHRASES.test(text)
    || LIVE_UPLOAD_REJECT_SIGNALS.test(text)
    || NON_AUDIO_VERSION_SIGNALS.test(text)
    || UNOFFICIAL_NON_ASCII_SIGNALS.test(text);
};

export const hasSpotifyVideoPenaltySignals = (title: string): boolean => UNOFFICIAL_PENALTY_SIGNALS.test(title);

export const isSpotifyDurationCandidateAllowed = (candidateSeconds: number, track: TrackSearchContext): boolean => {
  if (!track.durationMs) {
    return true;
  }

  const expectedSeconds = Math.round(track.durationMs / 1000);

  return Math.abs(candidateSeconds - expectedSeconds) <= 45;
};

export const getSpotifyTitleMatch = (video: SpotifyVideoCandidate, track: TrackSearchContext): {
  title: string;
  channel: string;
  name: string;
  artist: string;
  titleMatch: boolean;
  exactTitleMatch: boolean;
} => {
  const title = normalizeSearchText(video.snippet.title);
  const channel = normalizeSearchText(video.snippet.channelTitle);
  const name = normalizeSearchText(track.name);
  const artist = normalizeSearchText(track.artist);
  const titleWithoutOfficialText = removeOfficialTitleText(title);
  const titleWithoutArtist = removeArtistFromTitle(titleWithoutOfficialText, artist);

  const titleMatch = title === name
    || titleWithoutOfficialText === name
    || titleWithoutArtist === name;

  return {
    title,
    channel,
    name,
    artist,
    titleMatch,
    exactTitleMatch: titleMatch,
  };
};

export const isSpotifyVideoCandidateAllowed = (video: SpotifyVideoCandidate, track: TrackSearchContext): boolean => {
  const {title, channel, titleMatch} = getSpotifyTitleMatch(video, track);

  if (!titleMatch) {
    return false;
  }

  return !hasNonSongSignals(title, channel);
};
