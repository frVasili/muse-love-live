import {inject, injectable} from 'inversify';
import {toSeconds, parse} from 'iso8601-duration';
import got, {Got} from 'got';
import {SongMetadata, QueuedPlaylist, MediaSource} from './player.js';
import {TYPES} from '../types.js';
import Config from './config.js';
import KeyValueCacheProvider from './key-value-cache.js';
import {ONE_HOUR_IN_SECONDS, ONE_MINUTE_IN_SECONDS, THIRTY_DAYS_IN_SECONDS} from '../utils/constants.js';
import {parseTime} from '../utils/time.js';
import getYouTubeID from 'get-youtube-id';
import {buildSpotifySearchQuery, buildSpotifyTopicSearchQuery, getSpotifyTitleMatch, isSpotifyDurationCandidateAllowed, isSpotifyVideoCandidateAllowed, scoreSpotifyVideoMatch} from '../utils/spotify-video-match.js';
import type {SpotifyVideoSource, TrackSearchContext} from '../utils/spotify-video-match.js';

interface VideoDetailsResponse {
  id: string;
  contentDetails: {
    videoId: string;
    duration: string;
  };
  snippet: {
    title: string;
    channelTitle: string;
    liveBroadcastContent: string;
    description: string;
    thumbnails: {
      medium: {
        url: string;
      };
    };
  };
}

interface PlaylistResponse {
  id: string;
  contentDetails: {
    itemCount: number;
  };
  snippet: {
    title: string;
  };
}

interface PlaylistItemsResponse {
  items: PlaylistItem[];
  nextPageToken?: string;
}

interface PlaylistItem {
  id: string;
  contentDetails: {
    videoId: string;
  };
}

interface SearchResponse {
  items: SearchItem[];
}

interface SearchItem {
  id: {
    videoId: string;
  };
}

export interface SongSelectionCandidate {
  videoId: string;
  title: string;
  artist: string;
  length: number;
  thumbnailUrl: string | null;
  isLive: boolean;
  score: number;
  songs: SongMetadata[];
  titleMatch: boolean;
  exactTitleMatch: boolean;
  artistMatch: boolean;
  spotifySource?: SpotifyVideoSource;
  durationDeltaSeconds?: number;
}

@injectable()
export default class {
  private readonly youtubeKey: string;
  private readonly cache: KeyValueCacheProvider;
  private readonly got: Got;

  constructor(@inject(TYPES.Config) config: Config, @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider) {
    this.youtubeKey = config.YOUTUBE_API_KEY;
    this.cache = cache;

    this.got = got.extend({
      prefixUrl: 'https://www.googleapis.com/youtube/v3/',
      searchParams: {
        key: this.youtubeKey,
        responseType: 'json',
      },
    });
  }

  async search(query: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    const [candidate] = await this.searchCandidates(query, shouldSplitChapters, 1);
    return candidate?.songs ?? [];
  }

  async searchCandidates(query: string, shouldSplitChapters: boolean, limit = 5): Promise<SongSelectionCandidate[]> {
    return this.searchRankedCandidates({
      queries: [query],
      shouldSplitChapters,
      searchLimit: Math.max(limit, 10),
      resultLimit: limit,
    });
  }

  async searchSpotifyTrackCandidates({name, artist, durationMs, shouldSplitChapters, limit = 5}: {
    name: string;
    artist: string;
    durationMs?: number;
    shouldSplitChapters: boolean;
    limit?: number;
  }): Promise<SongSelectionCandidate[]> {
    const normalizedName = name.trim();
    const normalizedArtist = artist.trim();

    return this.searchRankedCandidates({
      queries: [buildSpotifySearchQuery({name: normalizedName, artist: normalizedArtist})],
      shouldSplitChapters,
      track: {name: normalizedName, artist: normalizedArtist, durationMs},
      searchLimit: 25,
      resultLimit: limit,
    });
  }

  async searchSpotifyTrackFallbackCandidates({name, artist, durationMs, shouldSplitChapters, limit = 3}: {
    name: string;
    artist: string;
    durationMs?: number;
    shouldSplitChapters: boolean;
    limit?: number;
  }): Promise<SongSelectionCandidate[]> {
    const normalizedName = name.trim();
    const normalizedArtist = artist.trim();

    return this.searchRankedCandidates({
      queries: [buildSpotifyTopicSearchQuery({name: normalizedName})],
      shouldSplitChapters,
      track: {name: normalizedName, artist: normalizedArtist, durationMs},
      searchLimit: 25,
      resultLimit: limit,
    });
  }

  async getVideo(url: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    const videoId = url.length === 11 ? url : getYouTubeID(url);

    if (!videoId) {
      throw new Error('Video could not be found.');
    }

    const result = await this.getVideosByID([videoId]);
    const video = result.at(0);

    if (!video) {
      throw new Error('Video could not be found.');
    }

    return this.getMetadataFromVideo({video, shouldSplitChapters});
  }

  async getPlaylist(listId: string, shouldSplitChapters: boolean, playlistLimit = Number.POSITIVE_INFINITY): Promise<SongMetadata[]> {
    const playlistParams = {
      searchParams: {
        part: 'id, snippet, contentDetails',
        id: listId,
      },
    };
    const {items: playlists} = await this.cache.wrap(
      async () => this.got('playlists', playlistParams).json() as Promise<{items: PlaylistResponse[]}>,
      playlistParams,
      {
        expiresIn: ONE_MINUTE_IN_SECONDS,
      },
    );

    const playlist = playlists.at(0)!;

    if (!playlist) {
      throw new Error('Playlist could not be found.');
    }

    const playlistVideos: PlaylistItem[] = [];
    const videoDetailsPromises: Array<Promise<void>> = [];
    const videoDetails: VideoDetailsResponse[] = [];

    let nextToken: string | undefined;

    const maxPlaylistVideos = Math.min(playlist.contentDetails.itemCount, playlistLimit);

    while (playlistVideos.length < maxPlaylistVideos) {
      const playlistItemsParams = {
        searchParams: {
          part: 'id, contentDetails',
          playlistId: listId,
          maxResults: '50',
          pageToken: nextToken,
        },
      };

      // eslint-disable-next-line no-await-in-loop
      const {items, nextPageToken} = await this.cache.wrap(
        async () => this.got('playlistItems', playlistItemsParams).json() as Promise<PlaylistItemsResponse>,
        playlistItemsParams,
        {
          expiresIn: ONE_MINUTE_IN_SECONDS,
        },
      );

      nextToken = nextPageToken;
      playlistVideos.push(...items.slice(0, maxPlaylistVideos - playlistVideos.length));

      // Start fetching extra details about videos
      // PlaylistItem misses some details, eg. if the video is a livestream
      videoDetailsPromises.push((async () => {
        const videoDetailItems = await this.getVideosByID(items.map(item => item.contentDetails.videoId));
        videoDetails.push(...videoDetailItems);
      })());

      if (!nextToken) {
        break;
      }
    }

    await Promise.all(videoDetailsPromises);

    const queuedPlaylist = {title: playlist.snippet.title, source: playlist.id};

    const songsToReturn: SongMetadata[] = [];

    for (const video of playlistVideos) {
      try {
        songsToReturn.push(...this.getMetadataFromVideo({
          video: videoDetails.find((i: {id: string}) => i.id === video.contentDetails.videoId)!,
          queuedPlaylist,
          shouldSplitChapters,
        }));
      } catch (_: unknown) {
        // Private and deleted videos are sometimes in playlists, duration of these
        // is not returned and they should not be added to the queue.
      }
    }

    return songsToReturn;
  }

  private async searchRankedCandidates({queries, shouldSplitChapters, track, searchLimit = 10, resultLimit = 5}: {
    queries: string[];
    shouldSplitChapters: boolean;
    track?: TrackSearchContext;
    searchLimit?: number;
    resultLimit?: number;
  }): Promise<SongSelectionCandidate[]> {
    const seenIds = new Set<string>();
    const ids: string[] = [];
    for (const query of queries) {
      // Search failures must propagate: treating quota exhaustion or an API
      // outage as an empty result incorrectly reports valid songs as missing.
      // eslint-disable-next-line no-await-in-loop
      const searchIds = await this.searchVideoIds(query, searchLimit);

      for (const id of searchIds) {
        if (!seenIds.has(id)) {
          seenIds.add(id);
          ids.push(id);
        }
      }
    }

    if (ids.length === 0) {
      return [];
    }

    const videos = await this.getVideosByID(ids);

    const ranked = this.orderVideosBySearchRank(ids, videos);

    const validRanked = ranked.filter(video => this.getVideoLengthSeconds(video) !== null);

    const candidates = track
      ? validRanked.filter(video => this.isSpotifyTrackCandidateAllowed(video, track))
      : validRanked;

    candidates.sort((a, b) => this.scoreVideo(b, track) - this.scoreVideo(a, track));

    return candidates
      .slice(0, resultLimit)
      .map(video => this.createSongSelectionCandidate(video, shouldSplitChapters, track));
  }

  private async searchVideoIds(query: string, limit = 10): Promise<string[]> {
    const params = {
      searchParams: {
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: limit.toString(),
      },
    };

    const {items} = await this.cache.wrap(
      async () => this.got('search', params).json() as Promise<SearchResponse>,
      params,
      {
        expiresIn: THIRTY_DAYS_IN_SECONDS,
      },
    );

    return items
      .map(item => item.id.videoId)
      .filter(Boolean);
  }

  private orderVideosBySearchRank(ids: string[], videos: VideoDetailsResponse[]): VideoDetailsResponse[] {
    const rankById = new Map(ids.map((id, index) => [id, index]));
    return [...videos].sort((a, b) => (rankById.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rankById.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }

  private scoreVideo(video: VideoDetailsResponse, track?: TrackSearchContext): number {
    if (!track) {
      return 0;
    }

    return scoreSpotifyVideoMatch(
      getSpotifyTitleMatch(video, track),
      this.getDurationDeltaSeconds(video, track),
    );
  }

  private isSpotifyDurationCandidateAllowed(video: VideoDetailsResponse, track: TrackSearchContext): boolean {
    const videoLengthSeconds = this.getVideoLengthSeconds(video);

    return videoLengthSeconds !== null && isSpotifyDurationCandidateAllowed(videoLengthSeconds, track);
  }

  private isSpotifyTrackCandidateAllowed(video: VideoDetailsResponse, track: TrackSearchContext): boolean {
    return this.isSpotifyDurationCandidateAllowed(video, track) && isSpotifyVideoCandidateAllowed(video, track);
  }

  private getDurationDeltaSeconds(video: VideoDetailsResponse, track: TrackSearchContext): number | undefined {
    if (!track.durationMs) {
      return undefined;
    }

    const expectedSeconds = Math.round(track.durationMs / 1000);
    const videoLengthSeconds = this.getVideoLengthSeconds(video);

    return videoLengthSeconds === null ? undefined : Math.abs(videoLengthSeconds - expectedSeconds);
  }

  private getMetadataFromVideo({
    video,
    queuedPlaylist,
    shouldSplitChapters,
  }: {
    video: VideoDetailsResponse; // | YoutubePlaylistItem;
    queuedPlaylist?: QueuedPlaylist;
    shouldSplitChapters?: boolean;
  }): SongMetadata[] {
    const length = this.getVideoLengthSeconds(video);

    if (length === null) {
      throw new Error('Video duration is invalid.');
    }

    const base: SongMetadata = {
      source: MediaSource.Youtube,
      title: video.snippet.title,
      artist: video.snippet.channelTitle,
      length,
      offset: 0,
      url: video.id,
      playlist: queuedPlaylist ?? null,
      isLive: video.snippet.liveBroadcastContent === 'live',
      thumbnailUrl: video.snippet.thumbnails.medium.url,
    };

    if (!shouldSplitChapters) {
      return [base];
    }

    const chapters = this.parseChaptersFromDescription(video.snippet.description, base.length);

    if (!chapters) {
      return [base];
    }

    const tracks: SongMetadata[] = [];

    for (const [label, {offset, length}] of chapters) {
      tracks.push({
        ...base,
        offset,
        length,
        title: `${label} (${base.title})`,
      });
    }

    return tracks;
  }

  private parseChaptersFromDescription(description: string, videoDurationSeconds: number) {
    const map = new Map<string, {offset: number; length: number}>();
    let foundFirstTimestamp = false;

    const foundTimestamps: Array<{name: string; offset: number}> = [];
    for (const line of description.split('\n')) {
      const timestamps = Array.from(line.matchAll(/(?:\d+:)+\d+/g));
      if (timestamps?.length !== 1) {
        continue;
      }

      if (!foundFirstTimestamp) {
        if (/0{1,2}:00/.test(timestamps[0][0])) {
          foundFirstTimestamp = true;
        } else {
          continue;
        }
      }

      const timestamp = timestamps[0][0];
      const seconds = parseTime(timestamp);
      const chapterName = line.split(timestamp)[1].trim();

      foundTimestamps.push({name: chapterName, offset: seconds});
    }

    for (const [i, {name, offset}] of foundTimestamps.entries()) {
      map.set(name, {
        offset,
        length: i === foundTimestamps.length - 1
          ? videoDurationSeconds - offset
          : foundTimestamps[i + 1].offset - offset,
      });
    }

    if (!map.size) {
      return null;
    }

    return map;
  }

  private createSongSelectionCandidate(video: VideoDetailsResponse, shouldSplitChapters: boolean, track?: TrackSearchContext): SongSelectionCandidate {
    const songs = this.getMetadataFromVideo({video, shouldSplitChapters});
    const {titleMatch = false, exactTitleMatch = false, artistMatch = false, source: spotifySource} = track
      ? getSpotifyTitleMatch(video, track)
      : {titleMatch: false, exactTitleMatch: false, artistMatch: false, source: undefined};

    return {
      videoId: video.id,
      title: video.snippet.title,
      artist: video.snippet.channelTitle,
      length: this.getVideoLengthSeconds(video)!,
      thumbnailUrl: video.snippet.thumbnails.medium.url,
      isLive: video.snippet.liveBroadcastContent === 'live',
      score: this.scoreVideo(video, track),
      songs,
      titleMatch,
      exactTitleMatch,
      artistMatch,
      ...(spotifySource ? {spotifySource} : {}),
      durationDeltaSeconds: track ? this.getDurationDeltaSeconds(video, track) : undefined,
    };
  }

  private getVideoLengthSeconds(video: VideoDetailsResponse): number | null {
    try {
      const length = toSeconds(parse(video.contentDetails.duration));
      return Number.isFinite(length) && length > 0 ? length : null;
    } catch {
      return null;
    }
  }

  private async getVideosByID(videoIDs: string[]): Promise<VideoDetailsResponse[]> {
    const batches: string[][] = [];

    for (let index = 0; index < videoIDs.length; index += 50) {
      batches.push(videoIDs.slice(index, index + 50));
    }

    const results = await Promise.all(batches.map(async batch => {
      const params = {
        searchParams: {
          part: 'id, snippet, contentDetails',
          id: batch.join(','),
        },
      };

      const {items} = await this.cache.wrap(
        async () => this.got('videos', params).json() as Promise<{items: VideoDetailsResponse[]}>,
        params,
        {expiresIn: ONE_HOUR_IN_SECONDS},
      );

      return items;
    }));

    return results.flat();
  }
}

