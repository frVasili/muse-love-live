import {inject, injectable, optional} from 'inversify';
import {TYPES} from '../types.js';
import type {MediaSource, QueuedPlaylist, SongMetadata, SpotifyOrigin} from './player.js';
import type {SpotifyTrack} from './spotify-api.js';
import YoutubeAPI, {SongSelectionCandidate} from './youtube-api.js';
import {classifySpotifyCandidates} from '../utils/spotify-track-resolution.js';
import OfficialBandcampResolver from './official-bandcamp-resolver.js';

export type SpotifyMatchProvider = 'youtube' | 'bandcamp';

export type SpotifyResolvedMatch = {
  provider: SpotifyMatchProvider;
  url: string;
  title: string;
  artist: string;
  length: number;
  thumbnailUrl: string | null;
  isLive: boolean;
  score: number;
  durationDeltaSeconds?: number;
  confidenceEvidence: string[];
  songs: SongMetadata[];
  youtubeCandidate?: SongSelectionCandidate;
};

export type SpotifyTrackResolution = {
  status: 'high-confidence' | 'uncertain' | 'not-found';
  candidates: SongSelectionCandidate[];
  songs: SongMetadata[];
  selectedMatch?: SpotifyResolvedMatch;
};

@injectable()
export default class SpotifyTrackResolver {
  constructor(
    @inject(TYPES.Services.YoutubeAPI) private readonly youtubeAPI: YoutubeAPI,
    @inject(TYPES.Services.OfficialBandcampResolver) @optional() private readonly officialBandcampResolver?: OfficialBandcampResolver,
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
      const selectedMatch = this.toYouTubeMatch(decision.selectedCandidate);
      return {
        status: 'high-confidence',
        candidates,
        selectedMatch,
        songs: this.attachSpotifyOrigin(track, selectedMatch.songs, 'high-confidence', {provider: selectedMatch.provider, playlist}),
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
      } catch {
        // The primary search completed but found nothing safe. If the daily
        // quota blocks the optional Topic fallback, skip this one track rather
        // than aborting every otherwise-resolved song in the playlist.
        fallbackCandidates = [];
      }

      const candidatesById = new Map(candidates.map(candidate => [candidate.videoId, candidate]));

      for (const candidate of fallbackCandidates) {
        candidatesById.set(candidate.videoId, candidate);
      }

      candidates = [...candidatesById.values()].sort((a, b) => b.score - a.score);
      decision = classifySpotifyCandidates(candidates);

      if (decision.status === 'high-confidence' && decision.selectedCandidate) {
        const selectedMatch = this.toYouTubeMatch(decision.selectedCandidate);
        return {
          status: 'high-confidence',
          candidates,
          selectedMatch,
          songs: this.attachSpotifyOrigin(track, selectedMatch.songs, 'high-confidence', {provider: selectedMatch.provider, playlist}),
        };
      }
    }

    const bandcampMatch = await this.officialBandcampResolver?.resolve(track);
    if (bandcampMatch) {
      const songs: SongMetadata[] = [{
        source: 2 as MediaSource,
        title: bandcampMatch.title,
        artist: bandcampMatch.artist,
        length: bandcampMatch.length,
        offset: 0,
        url: bandcampMatch.url,
        playlist: null,
        isLive: false,
        thumbnailUrl: bandcampMatch.thumbnailUrl,
      }];
      const selectedMatch: SpotifyResolvedMatch = {
        ...bandcampMatch,
        isLive: false,
        score: 1_000,
        songs,
      };

      return {
        status: 'high-confidence',
        candidates,
        selectedMatch,
        songs: this.attachSpotifyOrigin(track, songs, 'high-confidence', {provider: selectedMatch.provider, playlist}),
      };
    }

    return {
      status: decision.status,
      candidates,
      songs: [],
    };
  }

  attachSpotifyOrigin(track: SpotifyTrack, songs: SongMetadata[], matchSource: SpotifyOrigin['matchSource'], options: {provider: SpotifyMatchProvider; playlist?: QueuedPlaylist}): SongMetadata[] {
    return songs.map(song => ({
      ...song,
      ...(options.playlist ? {playlist: options.playlist} : {}),
      spotifyOrigin: {
        spotifyTrackId: track.id,
        spotifyUrl: track.url,
        spotifyName: track.name,
        spotifyArtist: track.artist,
        ...(track.durationMs === undefined ? {} : {spotifyDurationMs: track.durationMs}),
        provider: options.provider,
        matchSource,
      },
    }));
  }

  private toYouTubeMatch(candidate: SongSelectionCandidate): SpotifyResolvedMatch {
    return {
      provider: 'youtube',
      url: `https://www.youtube.com/watch?v=${candidate.videoId}`,
      title: candidate.title,
      artist: candidate.artist,
      length: candidate.length,
      thumbnailUrl: candidate.thumbnailUrl,
      isLive: candidate.isLive,
      score: candidate.score,
      ...(candidate.durationDeltaSeconds === undefined ? {} : {durationDeltaSeconds: candidate.durationDeltaSeconds}),
      confidenceEvidence: [candidate.spotifySource ?? 'youtube-source', 'spotify-title-duration-match'],
      songs: candidate.songs,
      youtubeCandidate: candidate,
    };
  }
}
