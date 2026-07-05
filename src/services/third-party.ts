import {inject, injectable} from 'inversify';
import SpotifyWebApi from 'spotify-web-api-node';
import pRetry from 'p-retry';
import {TYPES} from '../types.js';
import Config from './config.js';
import debug from '../utils/debug.js';

@injectable()
export default class ThirdParty {
  readonly spotify: SpotifyWebApi;
  private spotifyTokenTimerId?: NodeJS.Timeout;
  private readonly config: Config;

  constructor(@inject(TYPES.Config) config: Config) {
    this.config = config;

    this.spotify = new SpotifyWebApi({
      clientId: config.SPOTIFY_CLIENT_ID,
      clientSecret: config.SPOTIFY_CLIENT_SECRET,
    });

    void this.refreshSpotifyToken();
  }

  cleanup() {
    if (this.spotifyTokenTimerId) {
      clearTimeout(this.spotifyTokenTimerId);
    }
  }

  private async refreshSpotifyToken() {
    try {
      await pRetry(async () => {
        const refreshToken = this.config.SPOTIFY_REFRESH_TOKEN.trim();

        if (refreshToken !== '') {
          this.spotify.setRefreshToken(refreshToken);

          const auth = await this.spotify.refreshAccessToken();
          this.spotify.setAccessToken(auth.body.access_token);

          debug('Spotify token refreshed using refresh token OAuth');
          this.scheduleSpotifyTokenRefresh((auth.body.expires_in / 2) * 1000);
          return;
        }

        const auth = await this.spotify.clientCredentialsGrant();
        this.spotify.setAccessToken(auth.body.access_token);

        debug('Spotify token refreshed using client credentials');
        this.scheduleSpotifyTokenRefresh((auth.body.expires_in / 2) * 1000);
      }, {retries: 5});
    } catch (error: unknown) {
      debug('Spotify token refresh failed: %O', error);
      this.scheduleSpotifyTokenRefresh(60_000);
    }
  }

  private scheduleSpotifyTokenRefresh(delay: number) {
    if (this.spotifyTokenTimerId) {
      clearTimeout(this.spotifyTokenTimerId);
    }

    this.spotifyTokenTimerId = setTimeout(() => {
      void this.refreshSpotifyToken();
    }, delay);
  }
}
