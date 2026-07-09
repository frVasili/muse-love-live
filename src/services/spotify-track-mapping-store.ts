import {injectable} from 'inversify';
import type {SpotifyTrack} from './spotify-api.js';
import type {SongSelectionCandidate} from './youtube-api.js';
import {prisma} from '../utils/db.js';

@injectable()
export default class SpotifyTrackMappingStore {
  async find(spotifyTrackId: string) {
    return prisma.spotifyTrackMapping.findUnique({
      where: {
        spotifyTrackId,
      },
    });
  }

  async upsert(track: SpotifyTrack, candidate: SongSelectionCandidate, confirmedByUserId: string) {
    const youtubeUrl = `https://www.youtube.com/watch?v=${candidate.videoId}`;

    return prisma.spotifyTrackMapping.upsert({
      where: {
        spotifyTrackId: track.id,
      },
      create: {
        spotifyTrackId: track.id,
        spotifyUrl: track.url,
        spotifyName: track.name,
        spotifyArtist: track.artist,
        spotifyDurationMs: track.durationMs,
        youtubeVideoId: candidate.videoId,
        youtubeUrl,
        youtubeTitle: candidate.title,
        confirmedByUserId,
      },
      update: {
        spotifyUrl: track.url,
        spotifyName: track.name,
        spotifyArtist: track.artist,
        spotifyDurationMs: track.durationMs,
        youtubeVideoId: candidate.videoId,
        youtubeUrl,
        youtubeTitle: candidate.title,
        confirmedByUserId,
      },
    });
  }
}
