import {QueuedPlaylist} from './player.js';

export interface SpotifyTrack {
  id: string;
  url: string;
  name: string;
  artist: string;
  durationMs?: number;
}

type SpotifyEntityType = 'album' | 'artist' | 'playlist' | 'track';

type SpotifySession = {
  accessToken: string;
  expiresAt: number;
};

type PathfinderOperation = {
  name: string;
  sha256: string;
  buildVariables: (id: string) => Record<string, unknown>;
};

type RawTrack = SpotifyTrack & {
  key: string;
};

const BOOTSTRAP_TRACK_ID = '4uLU6hMCjMI75M1A2tKUQC';
const PATHFINDER_URL = 'https://api-partner.spotify.com/pathfinder/v1/query';
const NEXT_DATA_RE = /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s;

const OPERATIONS: Record<SpotifyEntityType, PathfinderOperation> = {
  track: {
    name: 'getTrack',
    sha256: '612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294',
    buildVariables: id => ({uri: `spotify:track:${id}`}),
  },
  album: {
    name: 'getAlbum',
    sha256: 'b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10',
    buildVariables: id => ({uri: `spotify:album:${id}`, locale: '', offset: 0, limit: 50}),
  },
  artist: {
    name: 'queryArtistOverview',
    sha256: 'ae0e2958a4ab645b35ca19ac04d0495ae12d9c5d7b7286217674801a9aab281a',
    buildVariables: id => ({uri: `spotify:artist:${id}`, locale: '', includePrerelease: false}),
  },
  playlist: {
    name: 'fetchPlaylist',
    sha256: 'a65e12194ed5fc443a1cdebed5fabe33ca5b07b987185d63c72483867ad13cb4',
    buildVariables: id => ({uri: `spotify:playlist:${id}`, offset: 0, limit: 100, enableWatchFeedEntrypoint: false}),
  },
};

export default class SpotifyScraper {
  private session?: SpotifySession;

  async getAlbum(id: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    const pages = await this.getPagedEntity('album', id, 50);
    const tracks = this.limitTracks(this.extractTracks(pages), playlistLimit);
    const title = this.findEntityName(pages[0], `spotify:album:${id}`) ?? 'Spotify album';

    return [tracks, {title, source: `https://open.spotify.com/album/${id}`}];
  }

  async getPlaylist(id: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    const pages = await this.getPagedEntity('playlist', id, 100);
    const tracks = this.limitTracks(this.extractTracks(pages), playlistLimit);
    const title = this.findEntityName(pages[0], `spotify:playlist:${id}`) ?? 'Spotify playlist';

    return [tracks, {title, source: `https://open.spotify.com/playlist/${id}`}];
  }

  async getTrack(id: string): Promise<SpotifyTrack> {
    const data = await this.getEntity('track', id);
    const [track] = this.extractTracks([data]);

    if (!track) {
      throw new Error('Spotify track was not found');
    }

    return track;
  }

  async getArtist(id: string, playlistLimit: number): Promise<SpotifyTrack[]> {
    const data = await this.getEntity('artist', id);
    return this.limitTracks(this.extractTracks([data]), playlistLimit);
  }

  private async getPagedEntity(type: 'album' | 'playlist', id: string, pageSize: number): Promise<unknown[]> {
    const pages: unknown[] = [];
    const seenTrackKeys = new Set<string>();

    for (let offset = 0; offset < 10_000; offset += pageSize) {
      // eslint-disable-next-line no-await-in-loop
      const page = await this.getEntity(type, id, {offset, limit: pageSize});
      pages.push(page);

      const tracks = this.extractTracks([page]);
      const newKeys = tracks.filter(track => !seenTrackKeys.has(track.key));

      for (const track of tracks) {
        seenTrackKeys.add(track.key);
      }

      if (tracks.length < pageSize || newKeys.length === 0) {
        break;
      }
    }

    return pages;
  }

  private async getEntity(type: SpotifyEntityType, id: string, variableOverrides?: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.fetchPathfinder(type, id, variableOverrides);
    } catch {
      return this.fetchEmbedEntity(type, id);
    }
  }

  private async fetchPathfinder(type: SpotifyEntityType, id: string, variableOverrides?: Record<string, unknown>): Promise<unknown> {
    const token = await this.getAnonymousToken();
    const response = await fetch(this.buildPathfinderUrl(type, id, variableOverrides), {
      headers: {
        Authorization: `Bearer ${token}`,
        'app-platform': 'WebPlayer',
      },
    });

    if (response.status === 401) {
      this.session = undefined;
    }

    if (!response.ok) {
      throw new Error(`Spotify public lookup failed: ${response.status}`);
    }

    const body = await response.json() as {data?: unknown; errors?: unknown};

    if (body.errors || !body.data) {
      throw new Error('Spotify public lookup returned an unexpected response');
    }

    return body.data;
  }

  private async fetchEmbedEntity(type: SpotifyEntityType, id: string): Promise<unknown> {
    const response = await fetch(`https://open.spotify.com/embed/${type}/${id}`);

    if (!response.ok) {
      throw new Error(`Spotify embed lookup failed: ${response.status}`);
    }

    const nextData = this.extractNextData(await response.text());
    const entity = this.readPath(nextData, ['props', 'pageProps', 'state', 'data', 'entity']);

    if (!entity) {
      throw new Error('Spotify embed lookup returned an unexpected response');
    }

    return entity;
  }

  private async getAnonymousToken(): Promise<string> {
    const now = Date.now();

    if (this.session && now < this.session.expiresAt - 60_000) {
      return this.session.accessToken;
    }

    const response = await fetch(`https://open.spotify.com/embed/track/${BOOTSTRAP_TRACK_ID}`);

    if (!response.ok) {
      throw new Error(`Spotify token bootstrap failed: ${response.status}`);
    }

    const nextData = this.extractNextData(await response.text());
    const session = this.readPath(nextData, ['props', 'pageProps', 'state', 'settings', 'session']);

    if (!this.isRecord(session) || typeof session.accessToken !== 'string' || typeof session.accessTokenExpirationTimestampMs !== 'number') {
      throw new Error('Spotify token bootstrap returned an unexpected response');
    }

    this.session = {
      accessToken: session.accessToken,
      expiresAt: session.accessTokenExpirationTimestampMs,
    };

    return this.session.accessToken;
  }

  private buildPathfinderUrl(type: SpotifyEntityType, id: string, variableOverrides?: Record<string, unknown>): string {
    const operation = OPERATIONS[type];
    const variables = {
      ...operation.buildVariables(id),
      ...variableOverrides,
    };
    const params = new URLSearchParams({
      operationName: operation.name,
      variables: JSON.stringify(variables),
      extensions: JSON.stringify({
        persistedQuery: {
          version: 1,
          sha256Hash: operation.sha256,
        },
      }),
    });

    return `${PATHFINDER_URL}?${params.toString()}`;
  }

  private extractNextData(html: string): unknown {
    const match = NEXT_DATA_RE.exec(html);

    if (!match) {
      throw new Error('Spotify embed page did not include __NEXT_DATA__');
    }

    return JSON.parse(match[1]);
  }

  private extractTracks(values: unknown[]): RawTrack[] {
    const tracks = new Map<string, RawTrack>();

    for (const value of values) {
      this.walk(value, node => {
        const track = this.toTrack(node);

        if (track && !tracks.has(track.key)) {
          tracks.set(track.key, track);
        }
      });
    }

    return [...tracks.values()];
  }

  private toTrack(value: unknown): RawTrack | null {
    if (!this.isRecord(value) || typeof value.name !== 'string') {
      return null;
    }

    const uri = typeof value.uri === 'string' ? value.uri : undefined;
    const type = typeof value.type === 'string' ? value.type : undefined;
    const typename = typeof value.__typename === 'string' ? value.__typename : undefined;

    if (uri && !uri.startsWith('spotify:track:')) {
      return null;
    }

    if (!uri && type !== 'track' && typename !== 'Track' && typename !== 'TrackResponseWrapper') {
      return null;
    }

    const artist = this.extractArtist(value);

    if (!artist) {
      return null;
    }

    const durationMs = this.extractDurationMs(value);
    const id = uri?.split(':').at(-1);

    if (!id) {
      return null;
    }

    return {
      id,
      url: `https://open.spotify.com/track/${id}`,
      name: value.name,
      artist,
      ...(durationMs === undefined ? {} : {durationMs}),
      key: uri ?? `${value.name}:${artist}`,
    };
  }

  private extractDurationMs(value: Record<string, unknown>): number | undefined {
    for (const key of ['durationMs', 'duration_ms', 'durationMilliseconds', 'trackDuration', 'duration']) {
      const duration = value[key];

      if (typeof duration === 'number' && duration > 0) {
        return duration;
      }
    }

    const duration = this.readPath(value, ['duration', 'totalMilliseconds'])
      ?? this.readPath(value, ['trackDuration', 'totalMilliseconds']);

    if (typeof duration === 'number' && duration > 0) {
      return duration;
    }

    return undefined;
  }

  private extractArtist(value: Record<string, unknown>): string | null {
    const directArtists = this.collectNames(value.artists);

    if (directArtists.length > 0) {
      return directArtists[0];
    }

    const firstArtist = this.collectNames(value.firstArtist);

    if (firstArtist.length > 0) {
      return firstArtist[0];
    }

    return null;
  }

  private collectNames(value: unknown): string[] {
    const names: string[] = [];

    this.walk(value, node => {
      if (!this.isRecord(node)) {
        return;
      }

      if (typeof node.name === 'string') {
        names.push(node.name);
      } else if (this.isRecord(node.profile) && typeof node.profile.name === 'string') {
        names.push(node.profile.name);
      }
    });

    return [...new Set(names)];
  }

  private findEntityName(value: unknown, uri: string): string | null {
    let name: string | null = null;

    this.walk(value, node => {
      if (name || !this.isRecord(node)) {
        return;
      }

      if (node.uri === uri && typeof node.name === 'string') {
        name = node.name;
      }
    });

    return name;
  }

  private walk(value: unknown, visitor: (node: unknown) => void): void {
    visitor(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        this.walk(item, visitor);
      }

      return;
    }

    if (this.isRecord(value)) {
      for (const item of Object.values(value)) {
        this.walk(item, visitor);
      }
    }
  }

  private readPath(value: unknown, path: string[]): unknown {
    let current = value;

    for (const key of path) {
      if (!this.isRecord(current)) {
        return undefined;
      }

      current = current[key];
    }

    return current;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private limitTracks<T extends SpotifyTrack>(tracks: T[], limit: number): T[] {
    return tracks.length > limit ? tracks.slice(0, limit) : tracks;
  }
}
