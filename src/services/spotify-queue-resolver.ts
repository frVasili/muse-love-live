import pLimit from 'p-limit';
import type {QueuedPlaylist, SongMetadata, SpotifyOrigin} from './player.js';
import type GetSongs from './get-songs.js';
import type {SpotifyTrack} from './spotify-api.js';
import type SpotifyTrackResolver from './spotify-track-resolver.js';
import type {SpotifyTrackResolution} from './spotify-track-resolver.js';
import type {SongSelectionCandidate} from './youtube-api.js';

const SPOTIFY_TRACK_RESOLVE_CONCURRENCY = 4;

export type SpotifyQueuedTrackResolution = {
  track: SpotifyTrack;
  resolution: SpotifyTrackResolution;
  selectedSongs: SongMetadata[];
  selectedCandidate?: SongSelectionCandidate;
  matchSource: SpotifyOrigin['matchSource'] | 'not-found';
};

export type SpotifyQueueResolution = {
  tracks: SpotifyTrack[];
  playlist?: QueuedPlaylist;
  trackResolutions: SpotifyQueuedTrackResolution[];
  songsByTrack: SongMetadata[][];
  songs: SongMetadata[];
  songsNotFound: SpotifyTrack[];
  uncertainSpotifyTracks: SpotifyTrack[];
  autoMatchedCount: number;
};

export default class SpotifyQueueResolver {
  constructor(
    private readonly getSongs: GetSongs,
    private readonly spotifyTrackResolver: SpotifyTrackResolver,
  ) {}

  public async resolveQuery(query: string, playlistLimit: number, shouldSplitChapters: boolean): Promise<SpotifyQueueResolution> {
    const [tracks, playlist] = await this.getSongs.getSpotifyTracks(query, playlistLimit);
    return this.resolveTracks(tracks, shouldSplitChapters, playlist);
  }

  public async resolveTracks(tracks: SpotifyTrack[], shouldSplitChapters: boolean, playlist?: QueuedPlaylist): Promise<SpotifyQueueResolution> {
    const limit = pLimit(SPOTIFY_TRACK_RESOLVE_CONCURRENCY);
    const resolutions = await Promise.all(tracks.map(async track => limit(
      async () => this.spotifyTrackResolver.resolve(track, shouldSplitChapters, playlist),
    )));

    const songsByTrack: SongMetadata[][] = tracks.map(() => []);
    const songsNotFound: SpotifyTrack[] = [];
    const uncertainSpotifyTracks: SpotifyTrack[] = [];
    const trackResolutions: SpotifyQueuedTrackResolution[] = [];
    let autoMatchedCount = 0;

    for (const [index, resolution] of resolutions.entries()) {
      const track = tracks[index];
      const queuedResolution = this.toQueuedResolution(track, resolution, playlist);

      songsByTrack[index] = queuedResolution.selectedSongs;
      trackResolutions.push(queuedResolution);

      if (queuedResolution.matchSource === 'high-confidence' || queuedResolution.matchSource === 'saved') {
        autoMatchedCount++;
        continue;
      }

      if (queuedResolution.matchSource === 'timeout-top') {
        uncertainSpotifyTracks.push(track);
        continue;
      }

      songsNotFound.push(track);
    }

    return {
      tracks,
      ...(playlist ? {playlist} : {}),
      trackResolutions,
      songsByTrack,
      songs: songsByTrack.flat(),
      songsNotFound,
      uncertainSpotifyTracks,
      autoMatchedCount,
    };
  }

  private toQueuedResolution(track: SpotifyTrack, resolution: SpotifyTrackResolution, playlist?: QueuedPlaylist): SpotifyQueuedTrackResolution {
    if (resolution.status === 'saved' || resolution.status === 'high-confidence') {
      return {
        track,
        resolution,
        selectedSongs: resolution.songs,
        selectedCandidate: resolution.candidates[0],
        matchSource: resolution.status,
      };
    }

    if (resolution.status === 'uncertain' && resolution.candidates.length > 0) {
      const topCandidate = resolution.candidates[0];

      return {
        track,
        resolution,
        selectedSongs: this.spotifyTrackResolver.attachSpotifyOrigin(
          track,
          topCandidate.songs,
          'timeout-top',
          playlist,
        ),
        selectedCandidate: topCandidate,
        matchSource: 'timeout-top',
      };
    }

    return {
      track,
      resolution,
      selectedSongs: [],
      matchSource: 'not-found',
    };
  }
}
