import fs from 'node:fs/promises';
import path from 'node:path';
import {Except} from 'type-fest';
import {TYPES} from '../types.js';
import {DATA_DIR} from '../services/config.js';
import type SpotifyQueueResolver from '../services/spotify-queue-resolver.js';
import type {SpotifyQueuedTrackResolution} from '../services/spotify-queue-resolver.js';
import type GetSongs from '../services/get-songs.js';
import type {SongSelectionCandidate} from '../services/youtube-api.js';
import {prettyTime} from '../utils/time.js';

type OutputFormat = 'json' | 'csv' | 'both' | 'none';

type AuditOptions = {
  playlistUrl: string;
  sampleSize: number | 'all';
  seed: string;
  outputFormat: OutputFormat;
  outputDir: string;
  includeAlternates: boolean;
};

type AuditRow = {
  index: number;
  playlistIndex: number;
  spotifyName: string;
  spotifyArtist: string;
  spotifyDuration: string;
  spotifyUrl: string;
  matchSource: SpotifyQueuedTrackResolution['matchSource'];
  resolutionStatus: SpotifyQueuedTrackResolution['resolution']['status'];
  youtubeTitle: string;
  youtubeChannel: string;
  youtubeDuration: string;
  youtubeUrl: string;
  score: number | null;
  durationDeltaSeconds: number | null;
  flags: string[];
  alternates?: Array<{
    title: string;
    channel: string;
    duration: string;
    url: string;
    score: number;
    durationDeltaSeconds: number | null;
  }>;
};

const DEFAULT_SAMPLE_SIZE = 50;
const YOUTUBE_WATCH_URL = 'https://www.youtube.com/watch?v=';

const parseArgs = (argv: string[]): AuditOptions => {
  const positional: string[] = [];
  let sampleSize: number | 'all' = DEFAULT_SAMPLE_SIZE;
  let seed = 'spotify-audit';
  let outputFormat: OutputFormat = 'both';
  let outputDir = path.join(DATA_DIR, 'spotify-playlist-audits');
  let includeAlternates = true;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--all') {
      sampleSize = 'all';
      continue;
    }

    if (arg === '--sample-size') {
      const value = argv[++index];
      sampleSize = value === 'all' ? 'all' : parsePositiveInteger(value, '--sample-size');
      continue;
    }

    if (arg === '--seed') {
      seed = argv[++index] ?? '';
      continue;
    }

    if (arg === '--format') {
      outputFormat = parseOutputFormat(argv[++index]);
      continue;
    }

    if (arg === '--output-dir') {
      outputDir = argv[++index] ?? outputDir;
      continue;
    }

    if (arg === '--no-alternates') {
      includeAlternates = false;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    positional.push(arg);
  }

  const [playlistUrl] = positional;

  if (!playlistUrl) {
    printUsage();
    throw new Error('Missing Spotify playlist URL.');
  }

  return {
    playlistUrl,
    sampleSize,
    seed,
    outputFormat,
    outputDir,
    includeAlternates,
  };
};

const parsePositiveInteger = (value: string | undefined, optionName: string): number => {
  const parsed = Number.parseInt(value ?? '', 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer or "all".`);
  }

  return parsed;
};

const parseOutputFormat = (value: string | undefined): OutputFormat => {
  if (value === 'json' || value === 'csv' || value === 'both' || value === 'none') {
    return value;
  }

  throw new Error('--format must be one of json, csv, both, or none.');
};

const printUsage = () => {
  console.log(`Usage: npm run audit:spotify-playlist -- <spotify-playlist-url> [options]

Options:
  --sample-size <n|all>  Number of tracks to audit, default ${DEFAULT_SAMPLE_SIZE.toString()}
  --all                  Audit the full playlist
  --seed <value>         Seed for repeatable random sampling
  --format <json|csv|both|none>
  --output-dir <path>    Report directory, default data/spotify-playlist-audits
  --no-alternates        Omit alternate candidates from JSON output`);
};

const hashString = (value: string): number => {
  let hash = 0;

  for (const char of value) {
    hash = ((hash * 31) + char.charCodeAt(0)) % 4_294_967_296;
  }

  return hash;
};

const createRandom = (seed: string) => {
  let state = hashString(seed) || 1;

  return () => {
    state = ((state * 1_664_525) + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
};

const sampleIndexes = (total: number, sampleSize: number | 'all', seed: string): number[] => {
  if (sampleSize === 'all' || sampleSize >= total) {
    return Array.from({length: total}, (_, index) => index);
  }

  const indexes = Array.from({length: total}, (_, index) => index);
  const random = createRandom(seed);

  for (let index = indexes.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }

  return indexes.slice(0, sampleSize).sort((a, b) => a - b);
};

const candidateUrl = (candidate: SongSelectionCandidate): string => `${YOUTUBE_WATCH_URL}${candidate.videoId}`;

const buildFlags = (resolution: SpotifyQueuedTrackResolution): string[] => {
  const candidate = resolution.selectedCandidate;
  const flags: string[] = [];

  if (!candidate) {
    flags.push('not-found');
    return flags;
  }

  const text = `${candidate.title} ${candidate.artist}`.toLowerCase();

  if (/\bcover\b/.test(text)) {
    flags.push('cover');
  }

  if (/\b(remix|nightcore|sped up|slowed)\b/.test(text)) {
    flags.push('remix-or-edit');
  }

  if (/\b(lyric|lyrics|translation|translated|subbed|subtitle|subtitles|color coded)\b/.test(text) && candidate.spotifySource !== 'official-audio') {
    flags.push('lyrics-or-subs');
  }

  if (/\b(gameplay|game play|full combo|expert|master|beat saber|beatsaber|mmd|mv gameplay)\b/.test(text)) {
    flags.push('gameplay-like');
  }

  if (candidate.isLive || /\b(live at|live from|live version|live performance|live concert|final live)\b/.test(text)) {
    flags.push('live');
  }

  if (/\b(karaoke|off vocal|off-vocal|instrumental)\b/.test(text) || /カラオケ|ガイドなし/.test(text)) {
    flags.push('karaoke-or-off-vocal');
  }

  if (typeof candidate.durationDeltaSeconds === 'number' && candidate.durationDeltaSeconds > 10) {
    flags.push('duration-mismatch');
  }

  if (!candidate.exactTitleMatch) {
    flags.push('not-exact-title');
  }

  if (!candidate.artistMatch && candidate.spotifySource === 'unofficial') {
    flags.push('non-official-looking-upload');
  }

  return flags;
};

const toAuditRows = (resolutions: SpotifyQueuedTrackResolution[], indexes: number[], includeAlternates: boolean): AuditRow[] => resolutions.map((resolution, rowIndex) => {
  const candidate = resolution.selectedCandidate;
  const baseRow: AuditRow = {
    index: rowIndex + 1,
    playlistIndex: indexes[rowIndex] + 1,
    spotifyName: resolution.track.name,
    spotifyArtist: resolution.track.artist,
    spotifyDuration: formatMilliseconds(resolution.track.durationMs),
    spotifyUrl: resolution.track.url,
    matchSource: resolution.matchSource,
    resolutionStatus: resolution.resolution.status,
    youtubeTitle: candidate?.title ?? '',
    youtubeChannel: candidate?.artist ?? '',
    youtubeDuration: candidate ? prettyTime(candidate.length) : '',
    youtubeUrl: candidate ? candidateUrl(candidate) : '',
    score: candidate?.score ?? null,
    durationDeltaSeconds: candidate?.durationDeltaSeconds ?? null,
    flags: buildFlags(resolution),
  };

  if (!includeAlternates) {
    return baseRow;
  }

  return {
    ...baseRow,
    alternates: resolution.resolution.candidates.slice(1, 5).map(candidate => ({
      title: candidate.title,
      channel: candidate.artist,
      duration: prettyTime(candidate.length),
      url: candidateUrl(candidate),
      score: candidate.score,
      durationDeltaSeconds: candidate.durationDeltaSeconds ?? null,
    })),
  };
});

const formatMilliseconds = (durationMs?: number): string => durationMs === undefined ? '' : prettyTime(Math.round(durationMs / 1000));

const writeReports = async (rows: AuditRow[], options: AuditOptions) => {
  if (options.outputFormat === 'none') {
    return [];
  }

  await fs.mkdir(options.outputDir, {recursive: true});

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const basePath = path.join(options.outputDir, `spotify-playlist-audit-${stamp}`);
  const written: string[] = [];

  if (options.outputFormat === 'json' || options.outputFormat === 'both') {
    const filePath = `${basePath}.json`;
    await fs.writeFile(filePath, `${JSON.stringify(rows, null, 2)}\n`);
    written.push(filePath);
  }

  if (options.outputFormat === 'csv' || options.outputFormat === 'both') {
    const filePath = `${basePath}.csv`;
    await fs.writeFile(filePath, toCsv(rows));
    written.push(filePath);
  }

  return written;
};

const toCsv = (rows: AuditRow[]): string => {
  const columns: Array<keyof Except<AuditRow, 'alternates'>> = [
    'index',
    'playlistIndex',
    'spotifyName',
    'spotifyArtist',
    'spotifyDuration',
    'spotifyUrl',
    'matchSource',
    'resolutionStatus',
    'youtubeTitle',
    'youtubeChannel',
    'youtubeDuration',
    'youtubeUrl',
    'score',
    'durationDeltaSeconds',
    'flags',
  ];

  const header = columns.join(',');
  const lines = rows.map(row => columns.map(column => {
    const value = row[column];
    return csvCell(Array.isArray(value) ? value.join('; ') : String(value ?? ''));
  }).join(','));

  return `${header}\n${lines.join('\n')}\n`;
};

const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const printSummary = (rows: AuditRow[], reportPaths: string[]) => {
  const summary = rows.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.matchSource] = (accumulator[row.matchSource] ?? 0) + 1;
    return accumulator;
  }, {});

  console.table(rows.map(row => ({
    '#': row.index,
    playlist: row.playlistIndex,
    spotify: `${row.spotifyName} - ${row.spotifyArtist}`,
    match: row.matchSource,
    youtube: row.youtubeTitle,
    channel: row.youtubeChannel,
    delta: row.durationDeltaSeconds ?? '',
    flags: row.flags.join('; '),
    url: row.youtubeUrl,
  })));

  console.log(`Audited ${rows.length.toString()} tracks.`);
  console.log(`Match sources: ${Object.entries(summary).map(([key, value]) => `${key}: ${value.toString()}`).join(', ')}`);

  if (reportPaths.length > 0) {
    console.log(`Reports written:\n${reportPaths.join('\n')}`);
  }
};

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const {default: container} = await import('../inversify.config.js');
  const getSongs = container.get<GetSongs>(TYPES.Services.GetSongs);
  const spotifyQueueResolver = container.get<SpotifyQueueResolver>(TYPES.Services.SpotifyQueueResolver);
  const [tracks, playlist] = await getSongs.getSpotifyTracks(options.playlistUrl, Number.MAX_SAFE_INTEGER);
  const indexes = sampleIndexes(tracks.length, options.sampleSize, options.seed);
  const sampledTracks = indexes.map(index => tracks[index]);
  const sampledResolution = await spotifyQueueResolver.resolveTracks(sampledTracks, false, playlist);
  const rows = toAuditRows(sampledResolution.trackResolutions, indexes, options.includeAlternates);
  const reportPaths = await writeReports(rows, options);

  printSummary(rows, reportPaths);
  process.exit(0);
})().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
