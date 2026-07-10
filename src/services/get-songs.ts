import {inject, injectable, optional} from 'inversify';
import * as spotifyURI from 'spotify-uri';
import {SongMetadata, QueuedPlaylist, MediaSource} from './player.js';
import {TYPES} from '../types.js';
import ffmpeg from 'fluent-ffmpeg';
import YoutubeAPI, {SongSelectionCandidate} from './youtube-api.js';
import SpotifyAPI, {SpotifyTrack} from './spotify-api.js';
import {URL} from 'node:url';

const YOUTUBE_HOSTS = [
  'www.youtube.com',
  'youtu.be',
  'youtube.com',
  'music.youtube.com',
  'www.music.youtube.com',
];

@injectable()
export default class GetSongs {
  private readonly youtubeAPI: YoutubeAPI;
  private readonly spotifyAPI?: SpotifyAPI;

  constructor(@inject(TYPES.Services.YoutubeAPI) youtubeAPI: YoutubeAPI, @inject(TYPES.Services.SpotifyAPI) @optional() spotifyAPI?: SpotifyAPI) {
    this.youtubeAPI = youtubeAPI;
    this.spotifyAPI = spotifyAPI;
  }

  isUrl(query: string): boolean {
    try {
      // eslint-disable-next-line no-new
      new URL(query);
      return true;
    } catch {
      return false;
    }
  }

  isSpotifyQuery(query: string): boolean {
    if (!this.isUrl(query)) {
      return false;
    }

    const url = new URL(query);
    return url.protocol === 'spotify:' || url.host === 'open.spotify.com';
  }

  isYouTubeQuery(query: string): boolean {
    if (!this.isUrl(query)) {
      return false;
    }

    const url = new URL(query);
    return YOUTUBE_HOSTS.includes(url.host);
  }

  async getSearchCandidates(query: string, shouldSplitChapters: boolean, limit = 5): Promise<SongSelectionCandidate[]> {
    return this.youtubeAPI.searchCandidates(query, shouldSplitChapters, limit);
  }

  async getDirectUrlSongs(query: string, shouldSplitChapters: boolean, playlistLimit?: number): Promise<SongMetadata[]> {
    const url = new URL(query);

    if (YOUTUBE_HOSTS.includes(url.host)) {
      if (url.searchParams.get('list')) {
        return this.youtubePlaylist(url.searchParams.get('list')!, shouldSplitChapters, playlistLimit);
      }

      return this.youtubeVideo(url.href, shouldSplitChapters);
    }

    const song = await this.httpLiveStream(query);
    return [song];
  }

  async getSpotifyTracks(query: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist | undefined]> {
    if (this.spotifyAPI === undefined) {
      throw new Error('Spotify support is unavailable!');
    }

    const parsed = spotifyURI.parse(query);

    switch (parsed.type) {
      case 'album': {
        return this.spotifyAPI.getAlbum(query, playlistLimit);
      }

      case 'playlist': {
        return this.spotifyAPI.getPlaylist(query, playlistLimit);
      }

      case 'track': {
        return [[await this.spotifyAPI.getTrack(query)], undefined];
      }

      case 'artist': {
        return [await this.spotifyAPI.getArtist(query, playlistLimit), undefined];
      }

      default: {
        return [[], undefined];
      }
    }
  }

  private async youtubeVideo(url: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    return this.youtubeAPI.getVideo(url, shouldSplitChapters);
  }

  private async youtubePlaylist(listId: string, shouldSplitChapters: boolean, playlistLimit?: number): Promise<SongMetadata[]> {
    return this.youtubeAPI.getPlaylist(listId, shouldSplitChapters, playlistLimit);
  }

  private async httpLiveStream(url: string): Promise<SongMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg(url).ffprobe((err, _) => {
        if (err) {
          reject();
        }

        resolve({
          url,
          source: MediaSource.HLS,
          isLive: true,
          title: url,
          artist: url,
          length: 0,
          offset: 0,
          playlist: null,
          thumbnailUrl: null,
        });
      });
    });
  }
}
