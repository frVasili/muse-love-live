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
      const fallbackCandidates = await this.youtubeAPI.searchSpotifyTrackFallbackCandidates({
        name: track.name,
        artist: track.artist,
        durationMs: track.durationMs,
        shouldSplitChapters,
        limit: 3,
      });

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
