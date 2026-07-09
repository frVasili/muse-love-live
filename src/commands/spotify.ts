import {SlashCommandBuilder} from '@discordjs/builders';
import {ChatInputCommandInteraction} from 'discord.js';
import {injectable} from 'inversify';
import Command from './index.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('spotify')
    .setDescription('spotify mapping tools are temporarily disabled');

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply('spotify mapping is temporarily disabled while we fix matching');
  }
}
