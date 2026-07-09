import {inject, injectable} from 'inversify';
import {toSeconds, parse} from 'iso8601-duration';
import got, {Got} from 'got';
import ytsr from '@distube/ytsr';
import {SongMetadata, QueuedPlaylist, MediaSource} from './player.js';
import {TYPES} from '../types.js';
import Config from './config.js';
import KeyValueCacheProvider from './key-value-cache.js';
import {ONE_HOUR_IN_SECONDS, ONE_MINUTE_IN_SECONDS} from '../utils/constants.js';
import {parseTime} from '../utils/time.js';
import getYouTubeID from 'get-youtube-id';
import {getSpotifyTitleMatch, hasNonSongSignals, hasSpotifyVideoPenaltySignals, isSpotifyDurationCandidateAllowed, isSpotifyVideoCandidateAllowed} from '../utils/spotify-video-match.js';
import type {TrackSearchContext} from '../utils/spotify-video-match.js';

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

  async searchSpotifyTrack({name, artist, durationMs, shouldSplitChapters}: {
    name: string;
    artist: string;
    durationMs?: number;
    shouldSplitChapters: boolean;
  }): Promise<SongMetadata[]> {
    const [candidate] = await this.searchSpotifyTrackCandidates({
      name,
      artist,
      durationMs,
      shouldSplitChapters,
      limit: 1,
    });

    return candidate?.songs ?? [];
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
      queries: this.getSpotifyTrackQueries(normalizedName, normalizedArtist),
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
      queries: this.getSpotifyTrackQueries(normalizedName, normalizedArtist),
      shouldSplitChapters,
      track: {name: normalizedName, artist: normalizedArtist, durationMs},
      searchLimit: 25,
      resultLimit: limit,
      spotifyCandidateMode: 'fallback',
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

  private async searchRankedCandidates({queries, shouldSplitChapters, track, searchLimit = 10, resultLimit = 5, spotifyCandidateMode = 'strict'}: {
    queries: string[];
    shouldSplitChapters: boolean;
    track?: TrackSearchContext;
    searchLimit?: number;
    resultLimit?: number;
    spotifyCandidateMode?: 'strict' | 'fallback';
  }): Promise<SongSelectionCandidate[]> {
    const seenIds = new Set<string>();
    const ids: string[] = [];
    let apiSearchFailed = false;

    for (const query of queries) {
      let searchIds: string[];

      try {
        // eslint-disable-next-line no-await-in-loop
        searchIds = await this.searchVideoIds(query, searchLimit);
      } catch (_: unknown) {
        apiSearchFailed = true;
        continue;
      }

      for (const id of searchIds) {
        if (!seenIds.has(id)) {
          seenIds.add(id);
          ids.push(id);
        }
      }
    }

    let videos: VideoDetailsResponse[] = [];

    if (ids.length > 0) {
      try {
        videos = await this.getVideosByID(ids);
      } catch (_: unknown) {
        apiSearchFailed = true;
      }
    }

    let scrapedVideos: VideoDetailsResponse[] = [];

    if (track || (videos.length === 0 && apiSearchFailed)) {
      scrapedVideos = await this.searchScrapedVideos(queries, searchLimit);
    }

    const ranked = this.mergeRankedVideos(ids, videos, scrapedVideos);

    const validRanked = ranked.filter(video => this.getVideoLengthSeconds(video) !== null);

    const candidates = track
      ? validRanked.filter(video => this.isSpotifyTrackCandidateAllowed(video, track, spotifyCandidateMode))
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
        expiresIn: ONE_HOUR_IN_SECONDS,
      },
    );

    return items
      .map(item => item.id.videoId)
      .filter(Boolean);
  }

  private async searchScrapedVideos(queries: string[], limit: number): Promise<VideoDetailsResponse[]> {
    const seenIds = new Set<string>();
    const videos: VideoDetailsResponse[] = [];

    for (const query of queries) {
      let result: Awaited<ReturnType<typeof ytsr>>;

      try {
        // eslint-disable-next-line no-await-in-loop
        result = await ytsr(query, {type: 'video', limit});
      } catch (_: unknown) {
        continue;
      }

      for (const item of result.items) {
        if (seenIds.has(item.id) || !item.duration) {
          continue;
        }

        const duration = parseTime(item.duration);

        if (!Number.isFinite(duration) || duration <= 0) {
          continue;
        }

        seenIds.add(item.id);
        videos.push({
          id: item.id,
          contentDetails: {
            videoId: item.id,
            duration: `PT${duration}S`,
          },
          snippet: {
            title: item.name,
            channelTitle: item.author?.name ?? '',
            liveBroadcastContent: item.isLive ? 'live' : 'none',
            description: '',
            thumbnails: {
              medium: {
                url: item.thumbnail,
              },
            },
          },
        });
      }
    }

    return videos;
  }

  private getSpotifyTrackQueries(name: string, artist: string): string[] {
    return Array.from(new Set([
      `"${name}" "${artist}"`,
      `${artist} ${name}`,
      `${name} ${artist}`,
      `"${name}"`,
      name,
    ]));
  }

  private mergeRankedVideos(ids: string[], apiVideos: VideoDetailsResponse[], scrapedVideos: VideoDetailsResponse[]): VideoDetailsResponse[] {
    const ranked: VideoDetailsResponse[] = [];
    const seenIds = new Set<string>();

    for (const id of ids) {
      const video = apiVideos.find(candidate => candidate.id === id);

      if (!video || seenIds.has(video.id)) {
        continue;
      }

      seenIds.add(video.id);
      ranked.push(video);
    }

    for (const video of scrapedVideos) {
      if (seenIds.has(video.id)) {
        continue;
      }

      seenIds.add(video.id);
      ranked.push(video);
    }

    if (ranked.length > 0) {
      return ranked;
    }

    return apiVideos;
  }

  private scoreVideo(video: VideoDetailsResponse, track?: TrackSearchContext): number {
    if (!track) {
      return 0;
    }

    const {title, channel, name, artist, titleMatch, exactTitleMatch, artistMatch} = getSpotifyTitleMatch(video, track);
    let score = 0;

    if (titleMatch) {
      score += 160;
    }

    if (exactTitleMatch) {
      score += 140;
    } else if (title.startsWith(name)) {
      score += 70;
    }

    if (titleMatch) {
      score += this.scoreExtraTitleText(title, name);
    }

    if (channel.endsWith(' topic')) {
      score += 30;
    }

    if (channel === `${artist} topic` || channel.includes(`${artist} topic`)) {
      score += 10;
    }

    if (artistMatch) {
      score += 90;
    }

    if (hasSpotifyVideoPenaltySignals(title)) {
      score -= 60;
    }

    if (hasNonSongSignals(title, channel)) {
      score -= 220;
    }

    if (track.durationMs) {
      const expectedSeconds = Math.round(track.durationMs / 1000);
      const videoLengthSeconds = this.getVideoLengthSeconds(video);

      if (videoLengthSeconds === null) {
        return score;
      }

      const delta = Math.abs(videoLengthSeconds - expectedSeconds);

      score += this.scoreDurationDelta(delta);
    }

    if (!titleMatch) {
      score -= 250;
    }

    return score;
  }

  private scoreDurationDelta(delta: number): number {
    if (delta <= 1) {
      return 180;
    }

    if (delta <= 2) {
      return 140;
    }

    if (delta <= 3) {
      return 100;
    }

    if (delta <= 5) {
      return 50;
    }

    if (delta <= 10) {
      return 10;
    }

    if (delta <= 20) {
      return -20;
    }

    if (delta <= 30) {
      return -80;
    }

    if (delta <= 45) {
      return -160;
    }

    return -260;
  }

  private isSpotifyDurationCandidateAllowed(video: VideoDetailsResponse, track: TrackSearchContext): boolean {
    const videoLengthSeconds = this.getVideoLengthSeconds(video);

    return videoLengthSeconds !== null && isSpotifyDurationCandidateAllowed(videoLengthSeconds, track);
  }

  private isSpotifyTrackCandidateAllowed(video: VideoDetailsResponse, track: TrackSearchContext, mode: 'strict' | 'fallback'): boolean {
    if (!this.isSpotifyDurationCandidateAllowed(video, track)) {
      return false;
    }

    if (mode === 'strict') {
      return isSpotifyVideoCandidateAllowed(video, track);
    }

    const {title, channel, name, artistMatch, titleMatch} = getSpotifyTitleMatch(video, track);

    if (hasNonSongSignals(title, channel)) {
      return false;
    }

    return artistMatch && (title.includes(name) || titleMatch);
  }

  private getDurationDeltaSeconds(video: VideoDetailsResponse, track: TrackSearchContext): number | undefined {
    if (!track.durationMs) {
      return undefined;
    }

    const expectedSeconds = Math.round(track.durationMs / 1000);
    const videoLengthSeconds = this.getVideoLengthSeconds(video);

    return videoLengthSeconds === null ? undefined : Math.abs(videoLengthSeconds - expectedSeconds);
  }

  private scoreExtraTitleText(title: string, name: string): number {
    const extraTextLength = title.replace(name, '').trim().length;

    if (extraTextLength <= 6) {
      return 0;
    }

    if (extraTextLength <= 18) {
      return -30;
    }

    if (extraTextLength <= 35) {
      return -80;
    }

    return -140;
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
    const {titleMatch = false, exactTitleMatch = false, artistMatch = false} = track
      ? getSpotifyTitleMatch(video, track)
      : {titleMatch: false, exactTitleMatch: false, artistMatch: false};

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
    const p = {
      searchParams: {
        part: 'id, snippet, contentDetails',
        id: videoIDs.join(','),
      },
    };

    const {items: videos} = await this.cache.wrap(
      async () => this.got('videos', p).json() as Promise<{items: VideoDetailsResponse[]}>,
      p,
      {
        expiresIn: ONE_HOUR_IN_SECONDS,
      },
    );
    return videos;
  }
}

