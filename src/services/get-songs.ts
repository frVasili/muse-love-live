import {inject, injectable, optional} from 'inversify';
import * as spotifyURI from 'spotify-uri';
import {SongMetadata, QueuedPlaylist, MediaSource} from './player.js';
import {TYPES} from '../types.js';
import ffmpeg from 'fluent-ffmpeg';
import YoutubeAPI, {SongSelectionCandidate} from './youtube-api.js';
import SpotifyAPI, {SpotifyTrack} from './spotify-api.js';
import {URL} from 'node:url';

type SpotifyConversionResult = [SongMetadata[], string[], number];
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

  async getSongs(query: string, playlistLimit: number, shouldSplitChapters: boolean): Promise<[SongMetadata[], string]> {
    const newSongs: SongMetadata[] = [];
    let extraMsg = '';

    // Test if it's a complete URL
    try {
      const url = new URL(query);

      if (YOUTUBE_HOSTS.includes(url.host)) {
        // YouTube source
        if (url.searchParams.get('list')) {
          // YouTube playlist
          newSongs.push(...await this.youtubePlaylist(url.searchParams.get('list')!, shouldSplitChapters));
        } else {
          const songs = await this.youtubeVideo(url.href, shouldSplitChapters);

          if (songs) {
            newSongs.push(...songs);
          } else {
            throw new Error('that doesn\'t exist');
          }
        }
      } else if (url.protocol === 'spotify:' || url.host === 'open.spotify.com') {
        if (this.spotifyAPI === undefined) {
          throw new Error('Spotify support is unavailable!');
        }

        const [convertedSongs, songsNotFound, totalSongs] = await this.spotifySource(query, playlistLimit, shouldSplitChapters);
        const nSongsNotFound = songsNotFound.length;

        if (totalSongs > playlistLimit) {
          extraMsg = `the first ${playlistLimit} songs were added`;
        }

        if (totalSongs > playlistLimit && nSongsNotFound !== 0) {
          extraMsg += ' and ';
        }

        if (nSongsNotFound !== 0) {
          if (nSongsNotFound === 1) {
            extraMsg += `1 song was not found: ${songsNotFound[0]}`;
          } else {
            extraMsg += `${nSongsNotFound.toString()} songs were not found: ${this.formatSongList(songsNotFound)}`;
          }
        }

        newSongs.push(...convertedSongs);
      } else {
        const song = await this.httpLiveStream(query);

        if (song) {
          newSongs.push(song);
        } else {
          throw new Error('that doesn\'t exist');
        }
      }
    } catch (err: any) {
      if (err instanceof Error && err.message === 'Spotify support is unavailable!') {
        throw err;
      }

      // Not a URL, must search YouTube
      const songs = await this.youtubeVideoSearch(query, shouldSplitChapters);

      if (songs) {
        newSongs.push(...songs);
      } else {
        throw new Error('that doesn\'t exist');
      }
    }

    return [newSongs, extraMsg];
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

  async getDirectUrlSongs(query: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    const url = new URL(query);

    if (YOUTUBE_HOSTS.includes(url.host)) {
      if (url.searchParams.get('list')) {
        return this.youtubePlaylist(url.searchParams.get('list')!, shouldSplitChapters);
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

  private async youtubeVideoSearch(query: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    return this.youtubeAPI.search(query, shouldSplitChapters);
  }

  private async youtubeVideo(url: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    return this.youtubeAPI.getVideo(url, shouldSplitChapters);
  }

  private async youtubePlaylist(listId: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    return this.youtubeAPI.getPlaylist(listId, shouldSplitChapters);
  }

  private async spotifySource(url: string, playlistLimit: number, shouldSplitChapters: boolean): Promise<SpotifyConversionResult> {
    if (this.spotifyAPI === undefined) {
      return [[], [], 0];
    }

    const parsed = spotifyURI.parse(url);

    switch (parsed.type) {
      case 'album': {
        const [tracks, playlist] = await this.spotifyAPI.getAlbum(url, playlistLimit);
        return this.spotifyToYouTube(tracks, shouldSplitChapters, playlist);
      }

      case 'playlist': {
        const [tracks, playlist] = await this.spotifyAPI.getPlaylist(url, playlistLimit);
        return this.spotifyToYouTube(tracks, shouldSplitChapters, playlist);
      }

      case 'track': {
        const tracks = [await this.spotifyAPI.getTrack(url)];
        return this.spotifyToYouTube(tracks, shouldSplitChapters);
      }

      case 'artist': {
        const tracks = await this.spotifyAPI.getArtist(url, playlistLimit);
        return this.spotifyToYouTube(tracks, shouldSplitChapters);
      }

      default: {
        return [[], [], 0];
      }
    }
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

  private async spotifyToYouTube(tracks: SpotifyTrack[], shouldSplitChapters: boolean, playlist?: QueuedPlaylist | undefined): Promise<SpotifyConversionResult> {
    const promisedResults = tracks.map(async track => this.youtubeAPI.searchSpotifyTrack({
      name: track.name,
      artist: track.artist,
      durationMs: track.durationMs,
      shouldSplitChapters,
    }));
    const searchResults = await Promise.allSettled(promisedResults);

    const songsNotFound: string[] = [];

    // Count songs that couldn't be found
    const songs: SongMetadata[] = searchResults.reduce((accum: SongMetadata[], result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value.length === 0) {
          songsNotFound.push(this.formatSpotifyTrack(tracks[index]));
        }

        for (const v of result.value) {
          accum.push({
            ...v,
            ...(playlist ? {playlist} : {}),
          });
        }
      } else {
        songsNotFound.push(this.formatSpotifyTrack(tracks[index]));
      }

      return accum;
    }, []);

    return [songs, songsNotFound, tracks.length];
  }

  private formatSpotifyTrack(track: SpotifyTrack): string {
    return `${track.name} - ${track.artist}`;
  }

  private formatSongList(songs: string[]): string {
    const maxSongsToList = 8;
    const listedSongs = songs.slice(0, maxSongsToList).join(', ');
    const remainingSongs = songs.length - maxSongsToList;

    return remainingSongs > 0
      ? `${listedSongs}, and ${remainingSongs.toString()} more`
      : listedSongs;
  }
}
