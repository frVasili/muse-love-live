import {SlashCommandBuilder} from '@discordjs/builders';
import {ButtonInteraction, ChatInputCommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import Command from './index.js';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import GetSongs from '../services/get-songs.js';
import ButtonChoicePrompt, {ButtonPromptConfig} from '../services/button-choice-prompt.js';
import type {SongSelectionCandidate} from '../services/youtube-api.js';
import {prettyTime} from '../utils/time.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import SpotifyTrackResolver from '../services/spotify-track-resolver.js';
import {MediaSource} from '../services/player.js';
import type {QueuedSong, SongMetadata} from '../services/player.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('replace')
    .setDescription('replace the current song or a queued song')
    .addStringOption(option => option
      .setName('query')
      .setDescription('youtube url or search query for the replacement')
      .setRequired(true))
    .addIntegerOption(option => option
      .setName('position')
      .setDescription('queued song position to replace; omit to replace the current song')
      .setMinValue(1)
      .setRequired(false));

  constructor(
    @inject(TYPES.Managers.Player) private readonly playerManager: PlayerManager,
    @inject(TYPES.Services.GetSongs) private readonly getSongs: GetSongs,
    @inject(TYPES.Services.ButtonChoicePrompt) private readonly buttonChoicePrompt: ButtonChoicePrompt,
    @inject(TYPES.Services.SpotifyTrackResolver) private readonly spotifyTrackResolver: SpotifyTrackResolver,
  ) {}

  public get handledButtonIdPrefixes() {
    return ['replace-confirm', 'replace-save'];
  }

  public get requiresVC() {
    return true;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const settings = await getGuildSettings(interaction.guild!.id);
    await interaction.deferReply({ephemeral: settings.queueAddResponseEphemeral});

    const query = interaction.options.getString('query', true).trim();
    const position = interaction.options.getInteger('position') ?? null;
    const player = this.playerManager.get(interaction.guild!.id);
    const oldSong = position === null
      ? player.getCurrent()
      : player.getQueue()[position - 1];

    if (!oldSong) {
      throw new Error(position === null ? 'there is no current song to replace' : 'that queue position does not exist');
    }

    const {candidate, extraMsg, songs} = await this.resolveReplacement(interaction, query);

    if (songs.length === 0 || !candidate) {
      await interaction.editReply({content: 'cancelled the replacement', components: []});
      return;
    }

    const replacementSong: QueuedSong = {
      ...songs[0],
      addedInChannelId: interaction.channel!.id,
      requestedBy: interaction.user.id,
    };

    if (position === null) {
      player.replaceCurrent(replacementSong);
      await player.play();
      await interaction.editReply({
        content: `replaced the current song with **${replacementSong.title}**${extraMsg}`,
        embeds: [buildPlayingMessageEmbed(player)],
        components: [],
      });
    } else {
      player.replaceInQueue(position, replacementSong);
      await interaction.editReply({
        content: `replaced queue position **${position.toString()}** with **${replacementSong.title}**${extraMsg}`,
        components: [],
      });
    }

    if (oldSong.spotifyOrigin && replacementSong.source === MediaSource.Youtube) {
      await this.promptToSaveSpotifyMapping(interaction, oldSong, candidate, settings.queueAddResponseEphemeral);
    }
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    await this.buttonChoicePrompt.handleButtonInteraction(interaction);
  }

  private async resolveReplacement(interaction: ChatInputCommandInteraction, query: string): Promise<{candidate: SongSelectionCandidate | null; songs: SongMetadata[]; extraMsg: string}> {
    if (this.getSongs.isUrl(query)) {
      if (this.getSongs.isSpotifyQuery(query)) {
        throw new Error('replace only supports youtube urls or search queries');
      }

      const songs = await this.getSongs.getDirectUrlSongs(query, false);
      const [song] = songs;

      if (!song) {
        throw new Error('that doesn\'t exist');
      }

      return {
        candidate: this.candidateFromSong(song),
        songs,
        extraMsg: '',
      };
    }

    const candidates = await this.getSongs.getSearchCandidates(query, false, 5);

    if (candidates.length === 0) {
      throw new Error('that doesn\'t exist');
    }

    const promptConfig: ButtonPromptConfig = {
      prefix: 'replace-confirm',
      requesterId: interaction.user.id,
      buttonLabels: candidates.map((_, index) => String(index + 1)),
      timeoutSeconds: 20,
      includeCancel: true,
      fallbackIndex: 0,
    };
    const {requestId, components} = await this.buttonChoicePrompt.createPrompt(promptConfig);

    await interaction.editReply({
      content: this.buildPrompt(query, candidates),
      components: this.buttonChoicePrompt.toMessageComponents(components),
    });

    const selection = await this.buttonChoicePrompt.waitForChoice(requestId);
    await interaction.editReply({
      content: selection.cancelled
        ? 'cancelled the replacement'
        : `picked **${candidates[selection.selectedIndex ?? 0].title}**${selection.timedOut ? ' after timing out to result #1' : ''}`,
      components: this.buttonChoicePrompt.toMessageComponents(this.buttonChoicePrompt.buildComponents(promptConfig, requestId, true)),
    });

    if (selection.cancelled) {
      return {
        candidate: null,
        songs: [],
        extraMsg: '',
      };
    }

    const candidate = candidates[selection.selectedIndex ?? 0];
    return {
      candidate,
      songs: candidate.songs,
      extraMsg: selection.timedOut ? ' (selected result #1 after timeout)' : '',
    };
  }

  private async promptToSaveSpotifyMapping(interaction: ChatInputCommandInteraction, oldSong: QueuedSong, candidate: SongSelectionCandidate, ephemeral: boolean): Promise<void> {
    const {spotifyOrigin} = oldSong;

    if (!spotifyOrigin) {
      return;
    }

    const promptConfig: ButtonPromptConfig = {
      prefix: 'replace-save',
      requesterId: interaction.user.id,
      buttonLabels: ['Save mapping', 'Skip'],
      timeoutSeconds: 20,
      includeCancel: false,
      fallbackIndex: 1,
    };
    const {requestId, components} = await this.buttonChoicePrompt.createPrompt(promptConfig);
    const promptMessage = await interaction.followUp({
      content: `would you like **${spotifyOrigin.spotifyName} - ${spotifyOrigin.spotifyArtist}** linked to **${candidate.title}** for future spotify imports?`,
      components: this.buttonChoicePrompt.toMessageComponents(components),
      ephemeral,
    });
    const selection = await this.buttonChoicePrompt.waitForChoice(requestId);
    const disabledComponents = this.buttonChoicePrompt.buildComponents(promptConfig, requestId, true);

    if ((selection.selectedIndex ?? 1) === 0 && !selection.timedOut) {
      await this.spotifyTrackResolver.saveConfirmedMapping({
        id: spotifyOrigin.spotifyTrackId,
        url: spotifyOrigin.spotifyUrl,
        name: spotifyOrigin.spotifyName,
        artist: spotifyOrigin.spotifyArtist,
        durationMs: spotifyOrigin.spotifyDurationMs,
      }, candidate, interaction.user.id);

      await promptMessage.edit({
        content: `saved the spotify mapping for **${spotifyOrigin.spotifyName} - ${spotifyOrigin.spotifyArtist}**`,
        components: this.buttonChoicePrompt.toMessageComponents(disabledComponents),
      });
      return;
    }

    await promptMessage.edit({
      content: `left the spotify mapping unchanged for **${spotifyOrigin.spotifyName} - ${spotifyOrigin.spotifyArtist}**`,
      components: this.buttonChoicePrompt.toMessageComponents(disabledComponents),
    });
  }

  private buildPrompt(query: string, candidates: SongSelectionCandidate[]): string {
    const lines = candidates.map((candidate, index) => `\`${index + 1}.\` **${candidate.title}** - ${candidate.artist} \`[${candidate.isLive ? 'live' : prettyTime(candidate.length)}]\``);
    return `choose a replacement for **${query}**:\n${lines.join('\n')}\n\nif you don't pick one within 20 seconds, i'll use **#1**.`;
  }

  private candidateFromSong(song: SongMetadata): SongSelectionCandidate {
    return {
      videoId: song.url,
      title: song.title,
      artist: song.artist,
      length: song.length,
      thumbnailUrl: song.thumbnailUrl,
      isLive: song.isLive,
      score: 0,
      songs: [song],
      titleMatch: false,
      exactTitleMatch: false,
    };
  }
}
