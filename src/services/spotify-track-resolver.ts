import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import type {QueuedPlaylist, SongMetadata, SpotifyOrigin} from './player.js';
import type {SpotifyTrack} from './spotify-api.js';
import YoutubeAPI, {SongSelectionCandidate} from './youtube-api.js';
import {classifySpotifyCandidates} from '../utils/spotify-track-resolution.js';

export type SpotifyTrackResolution = {
  status: 'high-confidence' | 'uncertain' | 'not-found';
  candidates: SongSelectionCandidate[];
  songs: SongMetadata[];
};

const isYouTubeQuotaError = (error: unknown): boolean => error instanceof Error
  && /(?:\b429\b|quota|rateLimitExceeded)/i.test(error.message);

@injectable()
export default class SpotifyTrackResolver {
  constructor(
    @inject(TYPES.Services.YoutubeAPI) private readonly youtubeAPI: YoutubeAPI,
  ) {}

  async resolve(track: SpotifyTrack, shouldSplitChapters: boolean, playlist?: QueuedPlaylist): Promise<SpotifyTrackResolution> {
    let candidates = await this.youtubeAPI.searchSpotifyTrackCandidates({
      name: track.name,
      artist: track.artist,
      durationMs: track.durationMs,
      shouldSplitChapters,
    });
    let decision = classifySpotifyCandidates(candidates);

    if (decision.status === 'high-confidence' && decision.selectedCandidate) {
      return {
        status: 'high-confidence',
        candidates,
        songs: this.attachSpotifyOrigin(track, decision.selectedCandidate.songs, 'high-confidence', playlist),
      };
    }

    if (decision.status !== 'high-confidence') {
      let fallbackCandidates: SongSelectionCandidate[];

      try {
        fallbackCandidates = await this.youtubeAPI.searchSpotifyTrackFallbackCandidates({
          name: track.name,
          artist: track.artist,
          durationMs: track.durationMs,
          shouldSplitChapters,
          limit: 3,
        });
      } catch (error: unknown) {
        // The primary search completed but found nothing safe. If the daily
        // quota blocks the optional Topic fallback, skip this one track rather
        // than aborting every otherwise-resolved song in the playlist.
        if (isYouTubeQuotaError(error)) {
          return {
            status: decision.status,
            candidates,
            songs: [],
          };
        }

        throw error;
      }

      const candidatesById = new Map(candidates.map(candidate => [candidate.videoId, candidate]));

      for (const candidate of fallbackCandidates) {
        candidatesById.set(candidate.videoId, candidate);
      }

      candidates = [...candidatesById.values()].sort((a, b) => b.score - a.score);
      decision = classifySpotifyCandidates(candidates);

      if (decision.status === 'high-confidence' && decision.selectedCandidate) {
        return {
          status: 'high-confidence',
          candidates,
          songs: this.attachSpotifyOrigin(track, decision.selectedCandidate.songs, 'high-confidence', playlist),
        };
      }
    }

    return {
      status: decision.status,
      candidates,
      songs: [],
    };
  }

  attachSpotifyOrigin(track: SpotifyTrack, songs: SongMetadata[], matchSource: SpotifyOrigin['matchSource'], playlist?: QueuedPlaylist): SongMetadata[] {
    return songs.map(song => ({
      ...song,
      ...(playlist ? {playlist} : {}),
      spotifyOrigin: {
        spotifyTrackId: track.id,
        spotifyUrl: track.url,
        spotifyName: track.name,
        spotifyArtist: track.artist,
        ...(track.durationMs === undefined ? {} : {spotifyDurationMs: track.durationMs}),
        matchSource,
      },
    }));
  }
}
