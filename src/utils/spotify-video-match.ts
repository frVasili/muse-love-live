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

export type SpotifyVideoSource = 'topic' | 'official-audio' | 'official-video' | 'unofficial';

export type SpotifyVideoMatch = {
  title: string;
  channel: string;
  name: string;
  artist: string;
  titleMatch: boolean;
  exactTitleMatch: boolean;
  artistMatch: boolean;
  source: SpotifyVideoSource;
};

const ALWAYS_REJECT_SIGNALS = /\b(cover|covered|karaoke|instrumental|reaction|nightcore|clip|clips|short|shorts|comparison|compared|vs|translation|translated|subbed|subtitle|subtitles|mirror|mirrored|mmd|beatsaber|beat saber|taiko|opentaiko|amv|mad|piano|orchestra|dance cover)\b/;
const ALWAYS_REJECT_PHRASES = /\b(color coded|sped up|slowed down|slowed reverb|one hour|1 hour|extended loop)\b/;
const LIVE_SIGNALS = /\b(live at|live from|live version|live performance|live concert|final live|unit live|live action|live day)\b/;
const NON_ASCII_REJECT_SIGNALS = /\u5207\u308a\u629c\u304d|\u6b4c\u3063\u3066\u307f\u305f|\u8e0a\u3063\u3066\u307f\u305f|\u5f3e\u3044\u3066\u307f\u305f|\u6bd4\u3079\u3066\u307f\u305f|\u6bd4\u8f03|\u3069\u3063\u3061\u304c\u597d\u304d|\u30ab\u30e9\u30aa\u30b1|\u30ac\u30a4\u30c9\u306a\u3057|\u8010\u4e45|\u30aa\u30eb\u30b4\u30fc\u30eb|\u30d4\u30a2\u30ce|\u30e9\u30a4\u30d6\u6620\u50cf|\u6f14\u594f\u3057\u3066\u307f\u305f|\u5275\u4f5c\u8b5c\u9762|\u592a\u9f13\u3055\u3093\u6b21\u90ce/;
const NON_ENGLISH_LYRIC_SIGNALS = /\u6b4c\u8a5e|\u00e7eviri/;
const NON_AUDIO_VERSION_SIGNALS = /\b(off vocal|off-vocal|tv size|tv-size|game size|game-size|full combo)\b/;
const UNOFFICIAL_LYRIC_SIGNALS = /\b(lyrics?|lyric video|translation|translated|subbed|subtitle|subtitles|color coded|\u00e7eviri)\b/;
const REMIX_SIGNAL = /\bremix\b/;
const LIVE_TITLE_SIGNAL = /\blive\b/;
const OFFICIAL_CHANNEL_SIGNALS = /\b(official|vevo)\b|\u516c\u5f0f/;
const OFFICIAL_AUDIO_SIGNALS = /\b(official audio|official lyric video|provided to youtube by)\b/;
const OFFICIAL_VIDEO_SIGNALS = /\b(official (music )?video|official mv|music video|mv full)\b/;
const TITLE_DECORATION_PHRASES = [
  'provided to youtube by',
  'full version',
  'full ver',
  'official',
  'visualizer',
  'lyrics',
  'lyric',
  'audio',
  'video',
  'music',
  'topic',
  'mv',
];

const normalizeSearchText = (value: string): string => value
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const hasWholePhrase = (text: string, phrase: string): boolean => phrase !== ''
  && ` ${text} `.includes(` ${phrase} `);

const removePhraseAtEdge = (text: string, phrase: string): string => {
  if (!phrase) {
    return text;
  }

  if (text.startsWith(`${phrase} `)) {
    return text.slice(phrase.length).trim();
  }

  if (text.endsWith(` ${phrase}`)) {
    return text.slice(0, -(phrase.length + 1)).trim();
  }

  return text;
};

const removeTitleDecorations = (title: string, trackName: string): string => {
  let result = ` ${title} `;

  for (const phrase of TITLE_DECORATION_PHRASES) {
    if (!hasWholePhrase(trackName, phrase)) {
      result = result.replaceAll(` ${phrase} `, ' ');
    }
  }

  return result.replace(/\s+/g, ' ').trim();
};

export const buildSpotifySearchQuery = (track: Pick<TrackSearchContext, 'name' | 'artist'>, includeArtist: boolean): string => {
  const name = track.name.replace(/"/g, '').trim();
  const artist = track.artist.replace(/"/g, '').trim();
  return includeArtist && artist ? `"${name}" ${artist}` : `"${name}"`;
};

export const getSpotifyVideoSource = (title: string, channel: string): SpotifyVideoSource => {
  if (channel.endsWith(' topic')) {
    return 'topic';
  }

  if (OFFICIAL_AUDIO_SIGNALS.test(title)) {
    return 'official-audio';
  }

  if (OFFICIAL_VIDEO_SIGNALS.test(title) || OFFICIAL_CHANNEL_SIGNALS.test(channel)) {
    return 'official-video';
  }

  return 'unofficial';
};

export const getSpotifyTitleMatch = (video: SpotifyVideoCandidate, track: TrackSearchContext): SpotifyVideoMatch => {
  const title = normalizeSearchText(video.snippet.title);
  const channel = normalizeSearchText(video.snippet.channelTitle);
  const name = normalizeSearchText(track.name);
  const artist = normalizeSearchText(track.artist);
  const undecoratedTitle = removeTitleDecorations(title, name);
  const titleWithoutArtist = removePhraseAtEdge(undecoratedTitle, artist);
  const exactTitleMatch = title === name || undecoratedTitle === name || titleWithoutArtist === name;
  const titleMatch = exactTitleMatch || hasWholePhrase(title, name);
  const artistMatch = hasWholePhrase(title, artist) || hasWholePhrase(channel, artist);

  return {
    title,
    channel,
    name,
    artist,
    titleMatch,
    exactTitleMatch,
    artistMatch,
    source: getSpotifyVideoSource(title, channel),
  };
};

export const hasNonSongSignals = (title: string, channel: string, trackName = ''): boolean => {
  const text = `${title} ${channel}`;
  const normalizedTrackName = normalizeSearchText(trackName);
  const isOfficial = OFFICIAL_CHANNEL_SIGNALS.test(channel) || OFFICIAL_AUDIO_SIGNALS.test(title) || OFFICIAL_VIDEO_SIGNALS.test(title);
  const unexpectedRemix = REMIX_SIGNAL.test(title) && !REMIX_SIGNAL.test(normalizedTrackName);
  const unexpectedLiveVersion = LIVE_TITLE_SIGNAL.test(title) && !LIVE_TITLE_SIGNAL.test(normalizedTrackName);
  const unofficialLyrics = (UNOFFICIAL_LYRIC_SIGNALS.test(title) || NON_ENGLISH_LYRIC_SIGNALS.test(title)) && !isOfficial;

  return ALWAYS_REJECT_SIGNALS.test(text)
    || ALWAYS_REJECT_PHRASES.test(text)
    || LIVE_SIGNALS.test(text)
    || NON_AUDIO_VERSION_SIGNALS.test(text)
    || NON_ASCII_REJECT_SIGNALS.test(text)
    || unexpectedRemix
    || unexpectedLiveVersion
    || unofficialLyrics;
};

export const isSpotifyDurationCandidateAllowed = (candidateSeconds: number, track: TrackSearchContext): boolean => {
  if (!track.durationMs) {
    return true;
  }

  const expectedSeconds = Math.round(track.durationMs / 1000);
  return Math.abs(candidateSeconds - expectedSeconds) <= 20;
};

export const isSpotifyVideoCandidateAllowed = (video: SpotifyVideoCandidate, track: TrackSearchContext): boolean => {
  const {title, channel, titleMatch} = getSpotifyTitleMatch(video, track);
  return titleMatch && !hasNonSongSignals(title, channel, track.name);
};

export const scoreSpotifyVideoMatch = (match: SpotifyVideoMatch, durationDeltaSeconds?: number): number => {
  let score = match.exactTitleMatch ? 400 : (match.titleMatch ? 180 : -400);

  if (match.source === 'topic') {
    score += 400;
  } else if (match.source === 'official-audio') {
    score += 260;
  } else if (match.source === 'official-video') {
    score += 100;
  }

  if (match.artistMatch) {
    score += 90;
  }

  if (durationDeltaSeconds !== undefined) {
    if (durationDeltaSeconds <= 2) {
      score += 220;
    } else if (durationDeltaSeconds <= 5) {
      score += 160;
    } else if (durationDeltaSeconds <= 10) {
      score += 80;
    } else if (durationDeltaSeconds <= 15) {
      score += 20;
    } else {
      score -= 80;
    }
  }

  return score;
};
