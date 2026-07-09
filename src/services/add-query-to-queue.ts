import {ChatInputCommandInteraction, GuildMember} from 'discord.js';
import {inject, injectable} from 'inversify';
import shuffle from 'array-shuffle';
import {SponsorBlock} from 'sponsorblock-api';
import {TYPES} from '../types.js';
import GetSongs from '../services/get-songs.js';
import {MediaSource, SongMetadata, STATUS} from './player.js';
import PlayerManager from '../managers/player.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import {getMemberVoiceChannel, getMostPopularVoiceChannel} from '../utils/channels.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import Config from './config.js';
import KeyValueCacheProvider from './key-value-cache.js';
import {ONE_HOUR_IN_SECONDS, TWENTY_SECONDS_IN_SECONDS} from '../utils/constants.js';
import ButtonChoicePrompt, {ButtonPromptConfig} from './button-choice-prompt.js';
import SpotifyTrackResolver from './spotify-track-resolver.js';
import type {SongSelectionCandidate} from './youtube-api.js';
import type {SpotifyTrack} from './spotify-api.js';
import {prettyTime} from '../utils/time.js';

type QueueResolution = {
  extraMsg: string;
  songs: SongMetadata[];
};

@injectable()
export default class AddQueryToQueue {
  private readonly sponsorBlock?: SponsorBlock;
  private sponsorBlockDisabledUntil?: Date;
  private readonly sponsorBlockTimeoutDelay;
  private readonly cache: KeyValueCacheProvider;

  constructor(@inject(TYPES.Services.GetSongs) private readonly getSongs: GetSongs,
    @inject(TYPES.Managers.Player) private readonly playerManager: PlayerManager,
    @inject(TYPES.Config) private readonly config: Config,
    @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider,
    @inject(TYPES.Services.ButtonChoicePrompt) private readonly buttonChoicePrompt: ButtonChoicePrompt,
    @inject(TYPES.Services.SpotifyTrackResolver) private readonly spotifyTrackResolver: SpotifyTrackResolver) {
    this.sponsorBlockTimeoutDelay = config.SPONSORBLOCK_TIMEOUT;
    this.sponsorBlock = config.ENABLE_SPONSORBLOCK
      ? new SponsorBlock('muse-sb-integration') // UserID matters only for submissions
      : undefined;
    this.cache = cache;
  }

  public async addToQueue({
    query,
    addToFrontOfQueue,
    shuffleAdditions,
    shouldSplitChapters,
    skipCurrentTrack,
    interaction,
  }: {
    query: string;
    addToFrontOfQueue: boolean;
    shuffleAdditions: boolean;
    shouldSplitChapters: boolean;
    skipCurrentTrack: boolean;
    interaction: ChatInputCommandInteraction;
  }): Promise<void> {
    const guildId = interaction.guild!.id;
    const player = this.playerManager.get(guildId);
    const wasPlayingSong = player.getCurrent() !== null;

    const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);

    const settings = await getGuildSettings(guildId);

    const {playlistLimit, queueAddResponseEphemeral} = settings;

    await interaction.deferReply({ephemeral: queueAddResponseEphemeral});

    let {songs: newSongs, extraMsg} = await this.resolveSongs({
      interaction,
      playlistLimit,
      query,
      replyEphemeral: queueAddResponseEphemeral,
      shouldSplitChapters,
    });

    if (newSongs.length === 0) {
      if (extraMsg !== '') {
        await interaction.editReply({
          content: extraMsg,
          components: [],
        });
        return;
      }

      throw new Error('no songs found');
    }

    if (shuffleAdditions) {
      newSongs = shuffle(newSongs);
    }

    if (this.config.ENABLE_SPONSORBLOCK) {
      newSongs = await Promise.all(newSongs.map(this.skipNonMusicSegments.bind(this)));
    }

    newSongs.forEach(song => {
      player.add({
        ...song,
        addedInChannelId: interaction.channel!.id,
        requestedBy: interaction.member!.user.id,
      }, {immediate: addToFrontOfQueue ?? false});
    });

    const firstSong = newSongs[0];

    let statusMsg = '';

    if (player.voiceConnection === null) {
      await player.connect(targetVoiceChannel);

      await player.play();

      if (wasPlayingSong) {
        statusMsg = 'resuming playback';
      }

      await interaction.editReply({
        embeds: [buildPlayingMessageEmbed(player)],
      });
    } else if (player.status === STATUS.IDLE) {
      await player.play();
    }

    if (skipCurrentTrack) {
      try {
        await player.forward(1);
      } catch (_: unknown) {
        throw new Error('no song to skip to');
      }
    }

    if (statusMsg !== '') {
      if (extraMsg === '') {
        extraMsg = statusMsg;
      } else {
        extraMsg = `${statusMsg}, ${extraMsg}`;
      }
    }

    if (extraMsg !== '') {
      extraMsg = ` (${extraMsg})`;
    }

    if (newSongs.length === 1) {
      await interaction.editReply({
        content: `u betcha, **${firstSong.title}** added to the${addToFrontOfQueue ? ' front of the' : ''} queue${skipCurrentTrack ? ' and current track skipped' : ''}${extraMsg}`,
        embeds: [],
        components: [],
      });
    } else {
      await interaction.editReply({
        content: `u betcha, **${firstSong.title}** and ${newSongs.length - 1} other songs were added to the queue${skipCurrentTrack ? ' and current track skipped' : ''}${extraMsg}`,
        embeds: [],
        components: [],
      });
    }
  }

  private async resolveSongs({
    interaction,
    playlistLimit,
    query,
    replyEphemeral,
    shouldSplitChapters,
  }: {
    interaction: ChatInputCommandInteraction;
    playlistLimit: number;
    query: string;
    replyEphemeral: boolean;
    shouldSplitChapters: boolean;
  }): Promise<QueueResolution> {
    if (!this.getSongs.isUrl(query)) {
      return this.resolveSearchQuery(interaction, query, shouldSplitChapters);
    }

    if (this.getSongs.isSpotifyQuery(query)) {
      return this.resolveSpotifyQuery(interaction, query, playlistLimit, shouldSplitChapters, replyEphemeral);
    }

    return {
      songs: await this.getSongs.getDirectUrlSongs(query, shouldSplitChapters),
      extraMsg: '',
    };
  }

  private async resolveSearchQuery(interaction: ChatInputCommandInteraction, query: string, shouldSplitChapters: boolean): Promise<QueueResolution> {
    const candidates = await this.getSongs.getSearchCandidates(query, shouldSplitChapters, 5);

    if (candidates.length === 0) {
      throw new Error('that doesn\'t exist');
    }

    const promptConfig: ButtonPromptConfig = {
      prefix: 'play-confirm',
      requesterId: interaction.user.id,
      buttonLabels: candidates.map((_, index) => String(index + 1)),
      timeoutSeconds: TWENTY_SECONDS_IN_SECONDS,
      includeCancel: true,
      fallbackIndex: 0,
    };
    const {requestId, components} = await this.buttonChoicePrompt.createPrompt(promptConfig);

    await interaction.editReply({
      content: this.buildSearchPrompt(query, candidates),
      components: this.buttonChoicePrompt.toMessageComponents(components),
    });

    const selection = await this.buttonChoicePrompt.waitForChoice(requestId);
    await interaction.editReply({
      content: selection.cancelled ? 'cancelled that search' : this.buildSearchResolutionText(query, candidates, selection.selectedIndex ?? 0, selection.timedOut),
      components: this.buttonChoicePrompt.toMessageComponents(this.buttonChoicePrompt.buildComponents(promptConfig, requestId, true)),
    });

    if (selection.cancelled) {
      return {
        songs: [],
        extraMsg: 'search cancelled',
      };
    }

    return {
      songs: candidates[selection.selectedIndex ?? 0].songs,
      extraMsg: selection.timedOut ? 'selected result #1 after timeout' : '',
    };
  }

  private async resolveSpotifyQuery(interaction: ChatInputCommandInteraction, query: string, playlistLimit: number, shouldSplitChapters: boolean, replyEphemeral: boolean): Promise<QueueResolution> {
    const [tracks, playlist] = await this.getSongs.getSpotifyTracks(query, playlistLimit);
    const resolutions = await Promise.all(tracks.map(async track => this.spotifyTrackResolver.resolve(track, shouldSplitChapters, playlist)));

    const songsByTrack: SongMetadata[][] = tracks.map(() => []);
    const songsNotFound: string[] = [];
    const uncertainTracks: Array<{candidateSet: SongSelectionCandidate[]; index: number; track: SpotifyTrack}> = [];
    let autoMatchedCount = 0;
    let confirmedCount = 0;
    let timedOutCount = 0;

    for (const [index, resolution] of resolutions.entries()) {
      if (resolution.status === 'saved' || resolution.status === 'high-confidence') {
        songsByTrack[index] = resolution.songs;
        autoMatchedCount++;
        continue;
      }

      if (resolution.status === 'uncertain' && resolution.candidates.length > 0) {
        uncertainTracks.push({
          candidateSet: resolution.candidates.slice(0, 5),
          index,
          track: tracks[index],
        });
        continue;
      }

      songsNotFound.push(this.formatSpotifyTrack(tracks[index]));
    }

    if (uncertainTracks.length > 0) {
      await interaction.editReply(`**${uncertainTracks.length.toString()}** song${uncertainTracks.length === 1 ? '' : 's'} have uncertain results, please confirm them one by one. If you do nothing for ${TWENTY_SECONDS_IN_SECONDS.toString()} seconds, I'll use result #1.`);
    }

    // These prompts must run in sequence so the requester only sees one unresolved Spotify choice at a time.
    for (const {candidateSet, index, track} of uncertainTracks) {
      const promptConfig: ButtonPromptConfig = {
        prefix: 'play-confirm',
        requesterId: interaction.user.id,
        buttonLabels: candidateSet.map((_, candidateIndex) => String(candidateIndex + 1)),
        timeoutSeconds: TWENTY_SECONDS_IN_SECONDS,
        includeCancel: true,
        fallbackIndex: 0,
      };
      // eslint-disable-next-line no-await-in-loop
      const {requestId, components} = await this.buttonChoicePrompt.createPrompt(promptConfig);
      // eslint-disable-next-line no-await-in-loop
      const promptMessage = await interaction.followUp({
        content: this.buildSpotifyPrompt(track, candidateSet),
        components: this.buttonChoicePrompt.toMessageComponents(components),
        ephemeral: replyEphemeral,
      });
      // eslint-disable-next-line no-await-in-loop
      const selection = await this.buttonChoicePrompt.waitForChoice(requestId);
      const disabledComponents = this.buttonChoicePrompt.buildComponents(promptConfig, requestId, true);

      if (selection.cancelled) {
        songsNotFound.push(this.formatSpotifyTrack(track));
        // eslint-disable-next-line no-await-in-loop
        await promptMessage.edit({
          content: `skipped **${this.formatSpotifyTrack(track)}**`,
          components: this.buttonChoicePrompt.toMessageComponents(disabledComponents),
        });
        continue;
      }

      const selectedCandidate = candidateSet[selection.selectedIndex ?? 0];
      songsByTrack[index] = this.spotifyTrackResolver.attachSpotifyOrigin(
        track,
        selectedCandidate.songs,
        selection.timedOut ? 'timeout-top' : 'confirmed',
        playlist,
      );

      if (selection.timedOut) {
        timedOutCount++;
      } else {
        confirmedCount++;
        // eslint-disable-next-line no-await-in-loop
        await this.spotifyTrackResolver.saveConfirmedMapping(track, selectedCandidate, interaction.user.id);
      }

      // eslint-disable-next-line no-await-in-loop
      await promptMessage.edit({
        content: `selected **${selectedCandidate.title}** for **${this.formatSpotifyTrack(track)}**${selection.timedOut ? ' after timeout' : ''}`,
        components: this.buttonChoicePrompt.toMessageComponents(disabledComponents),
      });
    }

    const songs = songsByTrack.flat();

    return {
      songs,
      extraMsg: this.buildSpotifySummary({autoMatchedCount, confirmedCount, timedOutCount, songsNotFound}),
    };
  }

  private buildSearchPrompt(query: string, candidates: SongSelectionCandidate[]): string {
    const lines = candidates.map((candidate, index) => `\`${index + 1}.\` **${candidate.title}** - ${candidate.artist} \`[${candidate.isLive ? 'live' : prettyTime(candidate.length)}]\``);
    return `choose a result for **${query}**:\n${lines.join('\n')}\n\nif you don't pick one within ${TWENTY_SECONDS_IN_SECONDS.toString()} seconds, i'll play **#1**.`;
  }

  private buildSearchResolutionText(query: string, candidates: SongSelectionCandidate[], selectedIndex: number, timedOut: boolean): string {
    const selectedCandidate = candidates[selectedIndex];
    return `picked **${selectedCandidate.title}** for **${query}**${timedOut ? ' after timing out to result #1' : ''}`;
  }

  private buildSpotifyPrompt(track: SpotifyTrack, candidates: SongSelectionCandidate[]): string {
    const lines = candidates.map((candidate, index) => `\`${index + 1}.\` **${candidate.title}** - ${candidate.artist} \`[${candidate.isLive ? 'live' : prettyTime(candidate.length)}]\``);
    return `please confirm **${this.formatSpotifyTrack(track)}**:\n${lines.join('\n')}\n\nif you don't pick one within ${TWENTY_SECONDS_IN_SECONDS.toString()} seconds, i'll use **#1**.`;
  }

  private buildSpotifySummary({
    autoMatchedCount,
    confirmedCount,
    timedOutCount,
    songsNotFound,
  }: {
    autoMatchedCount: number;
    confirmedCount: number;
    timedOutCount: number;
    songsNotFound: string[];
  }): string {
    const parts: string[] = [];

    if (autoMatchedCount > 0) {
      parts.push(`${autoMatchedCount.toString()} matched automatically`);
    }

    if (confirmedCount > 0) {
      parts.push(`${confirmedCount.toString()} manually confirmed`);
    }

    if (timedOutCount > 0) {
      parts.push(`${timedOutCount.toString()} used result #1 after timeout`);
    }

    if (songsNotFound.length === 1) {
      parts.push(`1 song was not found: ${songsNotFound[0]}`);
    } else if (songsNotFound.length > 1) {
      parts.push(`${songsNotFound.length.toString()} songs were not found: ${this.formatSongList(songsNotFound)}`);
    }

    return parts.join(', ');
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

  private async skipNonMusicSegments(song: SongMetadata) {
    if (!this.sponsorBlock
          || (this.sponsorBlockDisabledUntil && new Date() < this.sponsorBlockDisabledUntil)
          || song.source !== MediaSource.Youtube
          || !song.url) {
      return song;
    }

    try {
      const segments = await this.cache.wrap(
        async () => this.sponsorBlock?.getSegments(song.url, ['music_offtopic']),
        {
          key: song.url, // Value is too short for hashing
          expiresIn: ONE_HOUR_IN_SECONDS,
        },
      ) ?? [];
      const skipSegments = segments
        .sort((a, b) => a.startTime - b.startTime)
        .reduce((acc: Array<{startTime: number; endTime: number}>, {startTime, endTime}) => {
          const previousSegment = acc[acc.length - 1];
          if (previousSegment && previousSegment.endTime > startTime) {
            acc[acc.length - 1].endTime = endTime;
          } else {
            acc.push({startTime, endTime});
          }

          return acc;
        }, []);

      const intro = skipSegments[0];
      const outro = skipSegments.at(-1);
      if (outro && outro?.endTime >= song.length - 2) {
        song.length -= outro.endTime - outro.startTime;
      }

      if (intro?.startTime <= 2) {
        song.offset = Math.floor(intro.endTime);
        song.length -= song.offset;
      }

      return song;
    } catch (e) {
      if (!(e instanceof Error)) {
        console.error('Unexpected event occurred while fetching skip segments : ', e);
        return song;
      }

      if (!e.message.includes('404')) {
        console.warn(`Could not fetch skip segments for "${song.url}" :`, e);
      }

      if (e.message.includes('504')) {
        this.sponsorBlockDisabledUntil = new Date(new Date().getTime() + (this.sponsorBlockTimeoutDelay * 60_000));
      }

      return song;
    }
  }
}
