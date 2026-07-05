import {URL} from 'url';
import {inject, injectable, optional} from 'inversify';
import * as spotifyURI from 'spotify-uri';
import Spotify from 'spotify-web-api-node';
import {TYPES} from '../types.js';
import ThirdParty from './third-party.js';
import shuffle from 'array-shuffle';
import {QueuedPlaylist} from './player.js';
import SpotifyScraper, {SpotifyTrack} from './spotify-scraper.js';

export {SpotifyTrack};

type SpotifyPlaylistItem = SpotifyApi.PlaylistTrackObject & {
  item?: SpotifyApi.TrackObjectFull | SpotifyApi.EpisodeObjectFull | null;
};

@injectable()
export default class {
  private readonly spotify?: Spotify;
  private readonly scraper = new SpotifyScraper();

  constructor(@inject(TYPES.ThirdParty) @optional() thirdParty?: ThirdParty) {
    this.spotify = thirdParty?.spotify;
  }

  async getAlbum(url: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    const uri = spotifyURI.parse(url) as spotifyURI.Album;

    try {
      return await this.scraper.getAlbum(uri.id, playlistLimit);
    } catch (error) {
      const spotify = this.spotify;

      if (!spotify) {
        throw error;
      }

      const [{body: album}, {body: {items}}] = await Promise.all([spotify.getAlbum(uri.id), spotify.getAlbumTracks(uri.id, {limit: 50})]);
      const tracks = this.limitTracks(items, playlistLimit).map(this.toSpotifyTrack);
      const playlist = {title: album.name, source: album.href};

      return [tracks, playlist];
    }
  }

  async getPlaylist(url: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    const uri = spotifyURI.parse(url) as spotifyURI.Playlist;

    try {
      return await this.scraper.getPlaylist(uri.id, playlistLimit);
    } catch (error) {
      const spotify = this.spotify;

      if (!spotify) {
        throw error;
      }

      let [{body: playlistResponse}, {body: tracksResponse}] = await Promise.all([spotify.getPlaylist(uri.id), spotify.getPlaylistTracks(uri.id, {limit: 50})]);
      const items = tracksResponse.items
        .map(playlistItem => this.getTrackFromPlaylistItem(playlistItem as SpotifyPlaylistItem))
        .filter((track): track is SpotifyApi.TrackObjectFull => track !== null);
      const playlist = {title: playlistResponse.name, source: playlistResponse.href};

      while (tracksResponse.next) {
        // eslint-disable-next-line no-await-in-loop
        ({body: tracksResponse} = await spotify.getPlaylistTracks(uri.id, {
          limit: parseInt(new URL(tracksResponse.next).searchParams.get('limit') ?? '50', 10),
          offset: parseInt(new URL(tracksResponse.next).searchParams.get('offset') ?? '0', 10),
        }));

        items.push(...tracksResponse.items
          .map(playlistItem => this.getTrackFromPlaylistItem(playlistItem as SpotifyPlaylistItem))
          .filter((track): track is SpotifyApi.TrackObjectFull => track !== null));
      }

      const tracks = this.limitTracks(items, playlistLimit).map(this.toSpotifyTrack);

      return [tracks, playlist];
    }
  }

  async getTrack(url: string): Promise<SpotifyTrack> {
    const uri = spotifyURI.parse(url) as spotifyURI.Track;

    try {
      return await this.scraper.getTrack(uri.id);
    } catch (error) {
      const spotify = this.spotify;

      if (!spotify) {
        throw error;
      }

      const {body} = await spotify.getTrack(uri.id);

      return this.toSpotifyTrack(body);
    }
  }

  async getArtist(url: string, playlistLimit: number): Promise<SpotifyTrack[]> {
    const uri = spotifyURI.parse(url) as spotifyURI.Artist;

    try {
      return await this.scraper.getArtist(uri.id, playlistLimit);
    } catch (error) {
      const spotify = this.spotify;

      if (!spotify) {
        throw error;
      }

      const {body} = await spotify.getArtistTopTracks(uri.id, 'US');

      return this.limitTracks(body.tracks, playlistLimit).map(this.toSpotifyTrack);
    }
  }

  private getTrackFromPlaylistItem(playlistItem: SpotifyPlaylistItem): SpotifyApi.TrackObjectFull | null {
    const item = playlistItem.track ?? playlistItem.item;

    if (!item || item.type !== 'track') {
      return null;
    }

    return item;
  }

  private toSpotifyTrack(track: SpotifyApi.TrackObjectSimplified): SpotifyTrack {
    return {
      name: track.name,
      artist: track.artists[0].name,
    };
  }

  private limitTracks(tracks: SpotifyApi.TrackObjectSimplified[], limit: number) {
    return tracks.length > limit ? shuffle(tracks).slice(0, limit) : tracks;
  }
}
