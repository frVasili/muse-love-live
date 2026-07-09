import {SlashCommandBuilder} from '@discordjs/builders';
import {ChatInputCommandInteraction} from 'discord.js';
import getYouTubeID from 'get-youtube-id';
import {inject, injectable} from 'inversify';
import Command from './index.js';
import {TYPES} from '../types.js';
import SpotifyAPI from '../services/spotify-api.js';
import YoutubeAPI from '../services/youtube-api.js';
import SpotifyTrackResolver from '../services/spotify-track-resolver.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('spotify')
    .setDescription('manage spotify to youtube mappings')
    .addSubcommand(subcommand => subcommand
      .setName('map')
      .setDescription('manually map a spotify track to a youtube video')
      .addStringOption(option => option
        .setName('spotify')
        .setDescription('spotify track url')
        .setRequired(true))
      .addStringOption(option => option
        .setName('youtube')
        .setDescription('youtube video url')
        .setRequired(true)));

  constructor(
    @inject(TYPES.Services.SpotifyAPI) private readonly spotifyAPI: SpotifyAPI,
    @inject(TYPES.Services.YoutubeAPI) private readonly youtubeAPI: YoutubeAPI,
    @inject(TYPES.Services.SpotifyTrackResolver) private readonly spotifyTrackResolver: SpotifyTrackResolver,
  ) {}

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    switch (interaction.options.getSubcommand()) {
      case 'map':
        await this.mapTrack(interaction);
        return;
      default:
        throw new Error('unknown subcommand');
    }
  }

  private async mapTrack(interaction: ChatInputCommandInteraction): Promise<void> {
    const spotifyUrl = interaction.options.getString('spotify', true).trim();
    const youtubeUrl = interaction.options.getString('youtube', true).trim();
    const track = await this.spotifyAPI.getTrack(spotifyUrl);
    const youtubeVideoId = youtubeUrl.length === 11 ? youtubeUrl : getYouTubeID(youtubeUrl);

    if (!youtubeVideoId) {
      throw new Error('that youtube video could not be found');
    }

    const [song] = await this.youtubeAPI.getVideo(youtubeVideoId, false);

    if (!song) {
      throw new Error('that youtube video could not be found');
    }

    await this.spotifyTrackResolver.saveConfirmedMapping(track, {
      videoId: youtubeVideoId,
      title: song.title,
      artist: song.artist,
      length: song.length,
      thumbnailUrl: song.thumbnailUrl,
      isLive: song.isLive,
      score: 0,
      songs: [song],
      titleMatch: false,
      exactTitleMatch: false,
    }, interaction.user.id);

    await interaction.reply(`linked **${track.name}** to **${song.title}**`);
  }
}
