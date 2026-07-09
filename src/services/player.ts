import {VoiceChannel, Snowflake} from 'discord.js';
import {Readable} from 'stream';
import {setTimeout as sleep} from 'timers/promises';
import hasha from 'hasha';
import {WriteStream} from 'fs-capacitor';
import ffmpeg from 'fluent-ffmpeg';
import shuffle from 'array-shuffle';
import {
  AudioPlayer,
  AudioPlayerState,
  AudioPlayerStatus, AudioResource,
  createAudioPlayer,
  createAudioResource, DiscordGatewayAdapterCreator,
  entersState,
  joinVoiceChannel,
  StreamType,
  VoiceConnection,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import FileCacheProvider from './file-cache.js';
import debug from '../utils/debug.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import {getYouTubeMediaSource} from '../utils/yt-dlp.js';
import {Setting} from '@prisma/client';
import {prisma} from '../utils/db.js';
import {replaceCurrentQueueEntry, replaceUpcomingQueueEntry} from '../utils/queue-replacement.js';

export enum MediaSource {
  Youtube,
  HLS,
}

export interface QueuedPlaylist {
  title: string;
  source: string;
}

export interface SpotifyOrigin {
  spotifyTrackId: string;
  spotifyUrl: string;
  spotifyName: string;
  spotifyArtist: string;
  spotifyDurationMs?: number;
  matchSource: 'saved' | 'high-confidence' | 'confirmed' | 'timeout-top';
}

export interface SongMetadata {
  title: string;
  artist: string;
  url: string; // For YT, it's the video ID (not the full URI)
  length: number;
  offset: number;
  playlist: QueuedPlaylist | null;
  isLive: boolean;
  thumbnailUrl: string | null;
  source: MediaSource;
  spotifyOrigin?: SpotifyOrigin | null;
}

export interface QueuedSong extends SongMetadata {
  addedInChannelId: Snowflake;
  requestedBy: string;
}

export interface SavedPlayerSession {
  queue: QueuedSong[];
  queuePosition: number;
  positionInSeconds: number;
  loopCurrentSong: boolean;
  loopCurrentQueue: boolean;
  volume: number | null;
  status: STATUS;
}

export enum STATUS {
  PLAYING,
  PAUSED,
  IDLE,
}

export interface PlayerEvents {
  statusChange: (oldStatus: STATUS, newStatus: STATUS) => void;
}

export const DEFAULT_VOLUME = 100;

export default class {
  public voiceConnection: VoiceConnection | null = null;
  public status = STATUS.PAUSED;
  public guildId: string;
  public loopCurrentSong = false;
  public loopCurrentQueue = false;
  private currentChannel: VoiceChannel | undefined;
  private queue: QueuedSong[] = [];
  private queuePosition = 0;
  private audioPlayer: AudioPlayer | null = null;
  private audioResource: AudioResource | null = null;
  private volume?: number;
  private defaultVolume: number = DEFAULT_VOLUME;
  private nowPlaying: QueuedSong | null = null;
  private playPositionInterval: NodeJS.Timeout | undefined;
  private lastSongURL = '';
  private positionInSeconds = 0;
  private lastPersistedPosition = 0;
  private persistSessionOperation: Promise<void> = Promise.resolve();
  private readonly fileCache: FileCacheProvider;
  private disconnectTimer: NodeJS.Timeout | null = null;
  private readonly channelToSpeakingUsers: Map<string, Set<string>> = new Map();
  private hasRegisteredVoiceActivityListener = false;

  constructor(fileCache: FileCacheProvider, guildId: string) {
    this.fileCache = fileCache;
    this.guildId = guildId;
  }

  restoreSession(session: SavedPlayerSession): void {
    this.queue = session.queue;
    this.queuePosition = Math.min(session.queuePosition, Math.max(this.queue.length - 1, 0));
    this.positionInSeconds = session.positionInSeconds;
    this.lastPersistedPosition = session.positionInSeconds;
    this.loopCurrentSong = session.loopCurrentSong;
    this.loopCurrentQueue = session.loopCurrentQueue;
    this.volume = session.volume ?? undefined;
    this.status = session.status === STATUS.PLAYING ? STATUS.PAUSED : session.status;
    this.nowPlaying = this.getCurrent();
    this.lastSongURL = this.nowPlaying?.url ?? '';
  }

  async connect(channel: VoiceChannel): Promise<void> {
    if (this.voiceConnection) {
      this.disconnect();
    }

    const settings = await getGuildSettings(this.guildId);
    const {defaultVolume = DEFAULT_VOLUME} = settings;
    this.defaultVolume = defaultVolume;

    const voiceConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      selfDeaf: false,
      adapterCreator: channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
    });

    this.voiceConnection = voiceConnection;
    this.currentChannel = channel;
    this.hasRegisteredVoiceActivityListener = false;
    this.persistSession();

    const guildSettings = await getGuildSettings(this.guildId);
    const stateTransitions = [voiceConnection.state.status];
    voiceConnection.on('stateChange', (oldState, newState) => {
      stateTransitions.push(newState.status);
      if (stateTransitions.length > 10) {
        stateTransitions.shift();
      }

      debug(`Voice connection state changed: ${oldState.status} -> ${newState.status}`);

      if (newState.status === VoiceConnectionStatus.Ready && !this.hasRegisteredVoiceActivityListener) {
        this.registerVoiceActivityListener(guildSettings);
        this.hasRegisteredVoiceActivityListener = true;
      }
    });
    voiceConnection.on(VoiceConnectionStatus.Disconnected, this.onVoiceConnectionDisconnect.bind(this));

    try {
      await this.waitForVoiceConnectionReady(voiceConnection);
    } catch {
      const {status} = voiceConnection.state;
      voiceConnection.destroy();
      this.voiceConnection = null;
      throw new Error(`Failed to connect to the voice channel (last state: ${status}, rejoin attempts: ${voiceConnection.rejoinAttempts}, recent states: ${stateTransitions.join(' -> ')}).`);
    }
  }

  disconnect(): void {
    if (this.voiceConnection) {
      if (this.status === STATUS.PLAYING) {
        this.pause();
      }

      this.loopCurrentSong = false;
      this.voiceConnection.destroy();
      this.audioPlayer?.stop(true);
      this.voiceConnection = null;
      this.audioPlayer = null;
      this.audioResource = null;
      this.currentChannel = undefined;
      this.channelToSpeakingUsers.clear();
      this.hasRegisteredVoiceActivityListener = false;
      this.persistSession();
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    this.status = STATUS.PAUSED;
    const voiceConnection = await this.ensureVoiceConnectionReady();
    const currentSong = this.getCurrent();

    if (!currentSong) {
      throw new Error('No song currently playing');
    }

    if (positionSeconds > currentSong.length) {
      throw new Error('Seek position is outside the range of the song.');
    }

    let realPositionSeconds = positionSeconds;
    let to: number | undefined;

    if (currentSong.offset !== undefined) {
      realPositionSeconds += currentSong.offset;
      to = currentSong.length + currentSong.offset;
    }

    const stream = await this.getStream(currentSong, {seek: realPositionSeconds, to});

    this.audioPlayer = createAudioPlayer({
      behaviors: {
        maxMissedFrames: 50,
      },
    });

    voiceConnection.subscribe(this.audioPlayer);
    this.playAudioPlayerResource(this.createAudioStream(stream));
    this.attachListeners();
    this.startTrackingPosition(positionSeconds);
    this.status = STATUS.PLAYING;
    this.persistSession();
  }

  async forwardSeek(positionSeconds: number): Promise<void> {
    return this.seek(this.positionInSeconds + positionSeconds);
  }

  getPosition(): number {
    return this.positionInSeconds;
  }

  async play(): Promise<void> {
    const voiceConnection = await this.ensureVoiceConnectionReady();
    const currentSong = this.getCurrent();

    if (!currentSong) {
      throw new Error('Queue empty.');
    }

    if (this.disconnectTimer) {
      clearInterval(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    if (this.status === STATUS.PAUSED && currentSong.url === this.nowPlaying?.url) {
      if (this.audioPlayer) {
        this.audioPlayer.unpause();
        this.status = STATUS.PLAYING;
        this.startTrackingPosition();
        this.persistSession();
        return;
      }

      if (!currentSong.isLive) {
        return this.seek(this.getPosition());
      }
    }

    try {
      let positionSeconds: number | undefined;
      let to: number | undefined;

      if (currentSong.offset !== undefined) {
        positionSeconds = currentSong.offset;
        to = currentSong.length + currentSong.offset;
      }

      const stream = await this.getStream(currentSong, {seek: positionSeconds, to});

      this.audioPlayer = createAudioPlayer({
        behaviors: {
          maxMissedFrames: 50,
        },
      });

      voiceConnection.subscribe(this.audioPlayer);
      this.playAudioPlayerResource(this.createAudioStream(stream));
      this.attachListeners();
      this.status = STATUS.PLAYING;
      this.nowPlaying = currentSong;

      if (currentSong.url === this.lastSongURL) {
        this.startTrackingPosition();
      } else {
        this.startTrackingPosition(0);
        this.lastSongURL = currentSong.url;
      }

      this.persistSession();
    } catch (error: unknown) {
      debug(`Failed to play ${currentSong.title}: ${error instanceof Error ? error.message : String(error)}`);

      this.removeCurrent();

      if (this.getCurrent() && this.status !== STATUS.PAUSED) {
        await this.play();
        return;
      }

      await this.finishQueue();
    }
  }

  pause(): void {
    if (this.status !== STATUS.PLAYING) {
      throw new Error('Not currently playing.');
    }

    this.status = STATUS.PAUSED;

    if (this.audioPlayer) {
      this.audioPlayer.pause();
    }

    this.stopTrackingPosition();
    this.persistSession();
  }

  async forward(skip: number): Promise<void> {
    this.manualForward(skip);

    try {
      if (this.getCurrent() && this.status !== STATUS.PAUSED) {
        await this.play();
      } else {
        await this.finishQueue();
      }
    } catch (error: unknown) {
      this.queuePosition--;
      throw error;
    }
  }

  registerVoiceActivityListener(guildSettings: Setting) {
    const {turnDownVolumeWhenPeopleSpeak, turnDownVolumeWhenPeopleSpeakTarget} = guildSettings;
    if (!turnDownVolumeWhenPeopleSpeak || !this.voiceConnection) {
      return;
    }

    this.voiceConnection.receiver.speaking.on('start', (userId: string) => {
      if (!this.currentChannel) {
        return;
      }

      const member = this.currentChannel.members.get(userId);
      const channelId = this.currentChannel?.id;

      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.add(member.id);
      }

      this.suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget);
    });

    this.voiceConnection.receiver.speaking.on('end', (userId: string) => {
      if (!this.currentChannel) {
        return;
      }

      const member = this.currentChannel.members.get(userId);
      const channelId = this.currentChannel.id;

      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.delete(member.id);
      }

      this.suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget);
    });
  }

  suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget: number): void {
    if (!this.currentChannel) {
      return;
    }

    const speakingUsers = this.channelToSpeakingUsers.get(this.currentChannel.id);

    if (speakingUsers && speakingUsers.size > 0) {
      this.setVolume(turnDownVolumeWhenPeopleSpeakTarget);
    } else {
      this.setVolume(this.defaultVolume);
    }
  }

  canGoForward(skip: number) {
    return (this.queuePosition + skip - 1) < this.queue.length;
  }

  manualForward(skip: number): void {
    if (this.canGoForward(skip)) {
      this.queuePosition += skip;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();
      this.persistSession();
    } else {
      throw new Error('No songs in queue to forward to.');
    }
  }

  canGoBack() {
    return this.queuePosition - 1 >= 0;
  }

  async back(): Promise<void> {
    if (this.canGoBack()) {
      this.queuePosition--;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();
      this.persistSession();

      if (this.status !== STATUS.PAUSED) {
        await this.play();
      }
    } else {
      throw new Error('No songs in queue to go back to.');
    }
  }

  getCurrent(): QueuedSong | null {
    if (this.queue[this.queuePosition]) {
      return this.queue[this.queuePosition];
    }

    return null;
  }

  getQueue(): QueuedSong[] {
    return this.queue.slice(this.queuePosition + 1);
  }

  add(song: QueuedSong, {immediate = false} = {}): void {
    if (song.playlist || !immediate) {
      this.queue.push(song);
    } else {
      const insertAt = this.queuePosition + 1;
      this.queue = [...this.queue.slice(0, insertAt), song, ...this.queue.slice(insertAt)];
    }

    this.persistSession();
  }

  shuffle(): void {
    const shuffledSongs = shuffle(this.queue.slice(this.queuePosition + 1));
    this.queue = [...this.queue.slice(0, this.queuePosition + 1), ...shuffledSongs];
    this.persistSession();
  }

  clear(): void {
    const newQueue = [];
    const current = this.getCurrent();

    if (current) {
      newQueue.push(current);
    }

    this.queuePosition = 0;
    this.queue = newQueue;
    this.persistSession();
  }

  removeFromQueue(index: number, amount = 1): void {
    this.queue.splice(this.queuePosition + index, amount);
    this.persistSession();
  }

  removeCurrent(): void {
    this.queue = [...this.queue.slice(0, this.queuePosition), ...this.queue.slice(this.queuePosition + 1)];
    this.persistSession();
  }

  queueSize(): number {
    return this.getQueue().length;
  }

  isQueueEmpty(): boolean {
    return this.queueSize() === 0;
  }

  stop(): void {
    this.disconnect();
    this.queuePosition = 0;
    this.queue = [];
    this.deleteSession();
  }

  move(from: number, to: number): QueuedSong {
    if (from > this.queueSize() || to > this.queueSize()) {
      throw new Error('Move index is outside the range of the queue.');
    }

    this.queue.splice(this.queuePosition + to, 0, this.queue.splice(this.queuePosition + from, 1)[0]);
    this.persistSession();
    return this.queue[this.queuePosition + to];
  }

  replaceCurrent(song: QueuedSong): void {
    if (!this.getCurrent()) {
      throw new Error('No song is currently playing.');
    }

    this.queue = replaceCurrentQueueEntry(this.queue, this.queuePosition, song);
    this.nowPlaying = song;
    this.positionInSeconds = 0;
    this.lastPersistedPosition = 0;
    this.lastSongURL = '';
    this.stopTrackingPosition();
    this.persistSession();
  }

  replaceInQueue(position: number, song: QueuedSong): QueuedSong {
    if (position < 1 || position > this.queueSize()) {
      throw new Error('Replace index is outside the range of the queue.');
    }

    this.queue = replaceUpcomingQueueEntry(this.queue, this.queuePosition, position, song);
    this.persistSession();
    return song;
  }

  setVolume(level: number): void {
    this.volume = level;
    this.setAudioPlayerVolume(level);
    this.persistSession();
  }

  getVolume(): number {
    return this.volume ?? this.defaultVolume;
  }

  setLoopCurrentSong(loop: boolean): void {
    this.loopCurrentSong = loop;
    if (loop) {
      this.loopCurrentQueue = false;
    }

    this.persistSession();
  }

  setLoopCurrentQueue(loop: boolean): void {
    this.loopCurrentQueue = loop;
    if (loop) {
      this.loopCurrentSong = false;
    }

    this.persistSession();
  }

  private persistSession(): void {
    const current = this.getCurrent();
    if (!current) {
      this.deleteSession();
      return;
    }

    const session = {
      voiceChannelId: this.voiceConnection?.joinConfig.channelId ?? null,
      textChannelId: current.addedInChannelId,
      status: this.status,
      queue: JSON.stringify(this.queue),
      queuePosition: this.queuePosition,
      positionInSeconds: this.positionInSeconds,
      loopCurrentSong: this.loopCurrentSong,
      loopCurrentQueue: this.loopCurrentQueue,
      volume: this.volume ?? null,
    };

    this.enqueueSessionWrite(async () => prisma.playerSession.upsert({
      where: {
        guildId: this.guildId,
      },
      create: {
        guildId: this.guildId,
        ...session,
      },
      update: session,
    }));
  }

  private deleteSession(): void {
    this.enqueueSessionWrite(async () => prisma.playerSession.deleteMany({
      where: {
        guildId: this.guildId,
      },
    }));
  }

  private enqueueSessionWrite(operation: () => Promise<unknown>): void {
    this.persistSessionOperation = this.persistSessionOperation
      .then(async () => {
        await operation();
      })
      .catch(error => {
        debug(`Failed to update player session for ${this.guildId}: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  private getHashForCache(url: string): string {
    return hasha(url);
  }

  private async getStream(song: QueuedSong, options: {seek?: number; to?: number} = {}): Promise<Readable> {
    if (this.status === STATUS.PLAYING) {
      this.audioPlayer?.stop();
    } else if (this.status === STATUS.PAUSED) {
      this.audioPlayer?.stop(true);
    }

    if (song.source === MediaSource.HLS) {
      return this.createReadStream({url: song.url, cacheKey: song.url});
    }

    let ffmpegInput: string | null;
    const ffmpegInputOptions: string[] = [];
    let shouldCacheVideo = false;

    ffmpegInput = await this.fileCache.getPathFor(this.getHashForCache(song.url));

    if (!ffmpegInput) {
      const mediaSource = await getYouTubeMediaSource(song.url);
      ffmpegInput = mediaSource.url;

      const MAX_CACHE_LENGTH_SECONDS = 30 * 60;
      shouldCacheVideo = !mediaSource.isLive && song.length < MAX_CACHE_LENGTH_SECONDS && !options.seek;
      debug(shouldCacheVideo ? 'Caching video' : 'Not caching video');

      ffmpegInputOptions.push(...[
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '5',
      ]);

      const headerOptions = this.buildFfmpegHeaderOptions(mediaSource.headers);
      ffmpegInputOptions.push(...headerOptions);
    }

    if (options.seek) {
      ffmpegInputOptions.push('-ss', options.seek.toString());
    }

    if (options.to) {
      ffmpegInputOptions.push('-to', options.to.toString());
    }

    return this.createReadStream({
      url: ffmpegInput,
      cacheKey: song.url,
      ffmpegInputOptions,
      cache: shouldCacheVideo,
    });
  }

  private startTrackingPosition(initalPosition?: number): void {
    if (initalPosition !== undefined) {
      this.positionInSeconds = initalPosition;
      this.lastPersistedPosition = initalPosition;
    }

    if (this.playPositionInterval) {
      clearInterval(this.playPositionInterval);
    }

    this.playPositionInterval = setInterval(() => {
      this.positionInSeconds++;
      if (this.positionInSeconds - this.lastPersistedPosition >= 15) {
        this.lastPersistedPosition = this.positionInSeconds;
        this.persistSession();
      }
    }, 1000);
  }

  private stopTrackingPosition(): void {
    if (this.playPositionInterval) {
      clearInterval(this.playPositionInterval);
    }
  }

  private attachListeners(): void {
    if (!this.voiceConnection) {
      return;
    }

    if (!this.audioPlayer) {
      return;
    }

    if (this.audioPlayer.listeners('stateChange').length === 0) {
      this.audioPlayer.on(AudioPlayerStatus.Idle, this.onAudioPlayerIdle.bind(this));
    }
  }

  private async onVoiceConnectionDisconnect(): Promise<void> {
    if (!this.voiceConnection || this.voiceConnection.state.status !== VoiceConnectionStatus.Disconnected) {
      return;
    }

    const disconnectedState = this.voiceConnection.state;

    if (disconnectedState.reason === VoiceConnectionDisconnectReason.WebSocketClose && disconnectedState.closeCode === 4014) {
      try {
        await Promise.race([
          entersState(this.voiceConnection, VoiceConnectionStatus.Connecting, 5_000),
          entersState(this.voiceConnection, VoiceConnectionStatus.Signalling, 5_000),
        ]);
        return;
      } catch {
        this.disconnect();
        return;
      }
    }

    if (this.voiceConnection.rejoinAttempts < 5) {
      await sleep((this.voiceConnection.rejoinAttempts + 1) * 5_000);

      if (this.voiceConnection && this.voiceConnection.state.status === VoiceConnectionStatus.Disconnected) {
        if (this.voiceConnection.rejoin()) {
          return;
        }
      }
    }

    this.disconnect();
  }

  private async ensureVoiceConnectionReady(): Promise<VoiceConnection> {
    if (this.voiceConnection === null) {
      throw new Error('Not connected to a voice channel.');
    }

    await this.waitForVoiceConnectionReady(this.voiceConnection);
    return this.voiceConnection;
  }

  private async waitForVoiceConnectionReady(voiceConnection: VoiceConnection): Promise<void> {
    await entersState(voiceConnection, VoiceConnectionStatus.Ready, 60_000);
  }

  private async onAudioPlayerIdle(_oldState: AudioPlayerState, newState: AudioPlayerState): Promise<void> {
    if (this.loopCurrentSong && newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      await this.seek(0);
      return;
    }

    if (this.loopCurrentQueue && newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      const currentSong = this.getCurrent();

      if (currentSong) {
        this.add(currentSong);
      } else {
        throw new Error('No song currently playing.');
      }
    }

    if (newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      if (!this.canGoForward(1)) {
        await this.finishQueue();
        return;
      }

      await this.forward(1);
      const currentSong = this.getCurrent();
      if (!currentSong) {
        return;
      }

      const settings = await getGuildSettings(this.guildId);
      const {autoAnnounceNextSong} = settings;
      if (autoAnnounceNextSong && this.currentChannel) {
        await this.currentChannel.send({
          embeds: [buildPlayingMessageEmbed(this)],
        });
      }
    }
  }

  private async finishQueue(): Promise<void> {
    this.status = STATUS.IDLE;
    this.audioPlayer?.stop(true);
    this.persistSession();

    const settings = await getGuildSettings(this.guildId);

    const {secondsToWaitAfterQueueEmpties} = settings;
    if (secondsToWaitAfterQueueEmpties !== 0) {
      this.disconnectTimer = setTimeout(() => {
        if (this.status === STATUS.IDLE) {
          this.disconnect();
        }
      }, secondsToWaitAfterQueueEmpties * 1000);
    }
  }

  private buildFfmpegHeaderOptions(headers: Record<string, string>) {
    const headerLines = Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\r\n');

    if (!headerLines) {
      return [];
    }

    return ['-headers', `${headerLines}\r\n`];
  }

  private async createReadStream(options: {url: string; cacheKey: string; ffmpegInputOptions?: string[]; cache?: boolean}): Promise<Readable> {
    return new Promise((resolve, reject) => {
      const capacitor = new WriteStream();

      if (options?.cache) {
        const cacheStream = this.fileCache.createWriteStream(this.getHashForCache(options.cacheKey));
        capacitor.createReadStream().pipe(cacheStream);
      }

      const returnedStream = capacitor.createReadStream();
      let hasReturnedStreamClosed = false;

      const stream = ffmpeg(options.url)
        .inputOptions(options?.ffmpegInputOptions ?? ['-re'])
        .noVideo()
        .audioCodec('libopus')
        .outputFormat('webm')
        .on('error', error => {
          if (!hasReturnedStreamClosed) {
            reject(error);
          }
        })
        .on('start', command => {
          debug(`Spawned ffmpeg with ${command}`);
        });

      stream.pipe(capacitor);

      returnedStream.on('close', () => {
        if (!options.cache) {
          stream.kill('SIGKILL');
        }

        hasReturnedStreamClosed = true;
      });

      resolve(returnedStream);
    });
  }

  private createAudioStream(stream: Readable) {
    return createAudioResource(stream, {
      inputType: StreamType.WebmOpus,
      inlineVolume: true,
    });
  }

  private playAudioPlayerResource(resource: AudioResource) {
    if (this.audioPlayer !== null) {
      this.audioResource = resource;
      this.setAudioPlayerVolume();
      this.audioPlayer.play(this.audioResource);
    }
  }

  private setAudioPlayerVolume(level?: number) {
    this.audioResource?.volume?.setVolume((level ?? this.getVolume()) / 100);
  }
}
