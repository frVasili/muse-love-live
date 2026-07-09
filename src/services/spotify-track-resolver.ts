import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import type {QueuedPlaylist, SongMetadata, SpotifyOrigin} from './player.js';
import SpotifyTrackMappingStore from './spotify-track-mapping-store.js';
import type {SpotifyTrack} from './spotify-api.js';
import YoutubeAPI, {SongSelectionCandidate} from './youtube-api.js';
import {classifySpotifyCandidates} from '../utils/spotify-track-resolution.js';

export type SpotifyTrackResolution = {
  status: 'saved' | 'high-confidence' | 'uncertain' | 'not-found';
  candidates: SongSelectionCandidate[];
  songs: SongMetadata[];
};

@injectable()
export default class SpotifyTrackResolver {
  constructor(
    @inject(TYPES.Services.YoutubeAPI) private readonly youtubeAPI: YoutubeAPI,
    @inject(TYPES.Services.SpotifyTrackMappingStore) private readonly mappingStore: SpotifyTrackMappingStore,
  ) {}

  async resolve(track: SpotifyTrack, shouldSplitChapters: boolean, playlist?: QueuedPlaylist): Promise<SpotifyTrackResolution> {
    const mapping = await this.mappingStore.find(track.id);

    if (mapping) {
      try {
        const songs = await this.youtubeAPI.getVideo(mapping.youtubeVideoId, shouldSplitChapters);
        return {
          status: 'saved',
          candidates: [],
          songs: this.attachSpotifyOrigin(track, songs, 'saved', playlist),
        };
      } catch {
        // Fall back to live search when a saved mapping goes stale.
      }
    }

    const candidates = await this.youtubeAPI.searchSpotifyTrackCandidates({
      name: track.name,
      artist: track.artist,
      durationMs: track.durationMs,
      shouldSplitChapters,
    });
    const decision = classifySpotifyCandidates(candidates);

    if (decision.status === 'high-confidence' && decision.selectedCandidate) {
      return {
        status: 'high-confidence',
        candidates,
        songs: this.attachSpotifyOrigin(track, decision.selectedCandidate.songs, 'high-confidence', playlist),
      };
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

  async saveConfirmedMapping(track: SpotifyTrack, candidate: SongSelectionCandidate, confirmedByUserId: string): Promise<void> {
    await this.mappingStore.upsert(track, candidate, confirmedByUserId);
  }
}
