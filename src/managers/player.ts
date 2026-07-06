import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import {ChannelType, Client} from 'discord.js';
import Player, {QueuedSong, SavedPlayerSession, STATUS} from '../services/player.js';
import FileCacheProvider from '../services/file-cache.js';
import {prisma} from '../utils/db.js';
import debug from '../utils/debug.js';

@injectable()
export default class {
  private readonly guildPlayers: Map<string, Player>;
  private readonly fileCache: FileCacheProvider;

  constructor(@inject(TYPES.FileCache) fileCache: FileCacheProvider) {
    this.guildPlayers = new Map();
    this.fileCache = fileCache;
  }

  get(guildId: string): Player {
    let player = this.guildPlayers.get(guildId);

    if (!player) {
      player = new Player(this.fileCache, guildId);

      this.guildPlayers.set(guildId, player);
    }

    return player;
  }

  async restoreActiveSessions(client: Client): Promise<void> {
    const sessions = await prisma.playerSession.findMany();

    await Promise.all(sessions.map(async session => {
      let queue: QueuedSong[];

      try {
        queue = JSON.parse(session.queue) as QueuedSong[];
      } catch {
        debug(`Ignoring saved player session for ${session.guildId}: queue JSON is invalid.`);
        return;
      }

      if (queue.length === 0) {
        await prisma.playerSession.deleteMany({where: {guildId: session.guildId}});
        return;
      }

      const player = this.get(session.guildId);
      const savedSession: SavedPlayerSession = {
        queue,
        queuePosition: session.queuePosition,
        positionInSeconds: session.positionInSeconds,
        loopCurrentSong: session.loopCurrentSong,
        loopCurrentQueue: session.loopCurrentQueue,
        volume: session.volume,
        status: session.status,
      };

      player.restoreSession(savedSession);

      if (session.status !== STATUS.PLAYING || !session.voiceChannelId) {
        return;
      }

      const channel = client.channels.cache.get(session.voiceChannelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        debug(`Could not restore playback for ${session.guildId}: voice channel ${session.voiceChannelId} was not found.`);
        return;
      }

      try {
        await player.connect(channel);
        await player.play();
      } catch (error: unknown) {
        debug(`Could not restore playback for ${session.guildId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  }
}
