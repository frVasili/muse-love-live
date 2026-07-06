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

type TrackSearchContext = {
  name: string;
  artist: string;
  durationMs?: number;
};

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
    return this.searchBestVideo({
      queries: [query],
      shouldSplitChapters,
    });
  }

  async searchSpotifyTrack({name, artist, durationMs, shouldSplitChapters}: {
    name: string;
    artist: string;
    durationMs?: number;
    shouldSplitChapters: boolean;
  }): Promise<SongMetadata[]> {
    const normalizedName = name.trim();
    const normalizedArtist = artist.trim();

    return this.searchBestVideo({
      queries: [
        `"${normalizedName}" topic`,
        `"${normalizedName}"`,
        `${normalizedName} official audio`,
        `"${normalizedName}" "${normalizedArtist}" topic`,
        `"${normalizedName}" "${normalizedArtist}"`,
        `${normalizedName} ${normalizedArtist} official audio`,
        `${normalizedName} ${normalizedArtist}`,
        normalizedName,
      ],
      shouldSplitChapters,
      track: {name: normalizedName, artist: normalizedArtist, durationMs},
      searchLimit: 25,
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

  async getPlaylist(listId: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
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

    while (playlistVideos.length < playlist.contentDetails.itemCount) {
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
      playlistVideos.push(...items);

      // Start fetching extra details about videos
      // PlaylistItem misses some details, eg. if the video is a livestream
      videoDetailsPromises.push((async () => {
        const videoDetailItems = await this.getVideosByID(items.map(item => item.contentDetails.videoId));
        videoDetails.push(...videoDetailItems);
      })());
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

  private async searchBestVideo({queries, shouldSplitChapters, track, searchLimit = 10}: {
    queries: string[];
    shouldSplitChapters: boolean;
    track?: TrackSearchContext;
    searchLimit?: number;
  }): Promise<SongMetadata[]> {
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

    if (videos.length === 0 && (apiSearchFailed || track)) {
      videos = await this.searchScrapedVideos(queries, searchLimit);
    }

    const ranked = ids.length > 0
      ? ids
        .map(id => videos.find(video => video.id === id))
        .filter((video): video is VideoDetailsResponse => Boolean(video))
      : videos;

    ranked.sort((a, b) => this.scoreVideo(b, track) - this.scoreVideo(a, track));

    const bestVideo = ranked.at(0);

    return bestVideo
      ? this.getMetadataFromVideo({video: bestVideo, shouldSplitChapters})
      : [];
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

        seenIds.add(item.id);
        videos.push({
          id: item.id,
          contentDetails: {
            videoId: item.id,
            duration: `PT${parseTime(item.duration)}S`,
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

  private scoreVideo(video: VideoDetailsResponse, track?: TrackSearchContext): number {
    if (!track) {
      return 0;
    }

    const title = this.normalizeSearchText(video.snippet.title);
    const channel = this.normalizeSearchText(video.snippet.channelTitle);
    const name = this.normalizeSearchText(track.name);
    const artist = this.normalizeSearchText(track.artist);
    let score = 0;

    const titleMatch = title.includes(name);

    if (titleMatch) {
      score += 160;
    }

    if (channel.endsWith(' topic')) {
      score += 30;
    }

    if (channel === `${artist} topic` || channel.includes(`${artist} topic`)) {
      score += 10;
    }

    if (title.includes(artist) || channel.includes(artist)) {
      score += 5;
    }

    if (/\b(cover|karaoke|instrumental|remix|nightcore|reaction|live)\b/.test(title)) {
      score -= 60;
    }

    if (track.durationMs) {
      const expectedSeconds = Math.round(track.durationMs / 1000);
      const delta = Math.abs(toSeconds(parse(video.contentDetails.duration)) - expectedSeconds);

      if (delta <= 1) {
        score += 180;
      } else if (delta <= 2) {
        score += 140;
      } else if (delta <= 3) {
        score += 100;
      } else if (delta <= 5) {
        score += 50;
      } else {
        score -= Math.min(120, delta);
      }
    }

    if (!titleMatch) {
      score -= 250;
    }

    return score;
  }

  private normalizeSearchText(value: string): string {
    return value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
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
    const base: SongMetadata = {
      source: MediaSource.Youtube,
      title: video.snippet.title,
      artist: video.snippet.channelTitle,
      length: toSeconds(parse(video.contentDetails.duration)),
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
