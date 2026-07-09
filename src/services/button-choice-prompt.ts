import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import KeyValueCacheProvider from './key-value-cache.js';
import {ONE_MINUTE_IN_SECONDS} from '../utils/constants.js';
import {applyPromptChoice, finalizeTimedOutPrompt, PendingButtonPromptState} from '../utils/button-prompt-state.js';

export type ButtonPromptConfig = {
  prefix: string;
  requesterId: string;
  buttonLabels: string[];
  buttonStyles?: ButtonStyle[];
  includeCancel?: boolean;
  cancelLabel?: string;
  fallbackIndex?: number;
  timeoutSeconds?: number;
};

type PendingButtonPrompt = PendingButtonPromptState & {
  prefix: string;
};

export type ButtonPromptResult = {
  cancelled: boolean;
  selectedIndex: number | null;
  timedOut: boolean;
};

@injectable()
export default class ButtonChoicePrompt {
  constructor(@inject(TYPES.KeyValueCache) private readonly cache: KeyValueCacheProvider) {}

  async createPrompt(config: ButtonPromptConfig): Promise<{requestId: string; components: Array<ActionRowBuilder<ButtonBuilder>>}> {
    const requestId = randomUUID();
    const timeoutSeconds = config.timeoutSeconds ?? 20;
    const state: PendingButtonPrompt = {
      prefix: config.prefix,
      requesterId: config.requesterId,
      optionCount: config.buttonLabels.length,
      fallbackIndex: config.fallbackIndex ?? 0,
      expiresAt: Date.now() + (timeoutSeconds * 1000),
      status: 'pending',
    };

    await this.cache.set(this.getCacheKey(requestId), state, timeoutSeconds + ONE_MINUTE_IN_SECONDS);

    return {
      requestId,
      components: this.buildComponents(config, requestId, false),
    };
  }

  buildComponents(config: ButtonPromptConfig, requestId: string, disabled: boolean): Array<ActionRowBuilder<ButtonBuilder>> {
    const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];
    const firstRow = new ActionRowBuilder<ButtonBuilder>();

    for (const [index, label] of config.buttonLabels.entries()) {
      firstRow.addComponents(new ButtonBuilder()
        .setCustomId(`${config.prefix}:${requestId}:${index + 1}`)
        .setLabel(label)
        .setStyle(config.buttonStyles?.[index] ?? ButtonStyle.Secondary)
        .setDisabled(disabled));
    }

    rows.push(firstRow);

    if (config.includeCancel ?? true) {
      const cancelRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(new ButtonBuilder()
          .setCustomId(`${config.prefix}:${requestId}:cancel`)
          .setLabel(config.cancelLabel ?? 'Cancel')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled));
      rows.push(cancelRow);
    }

    return rows;
  }

  toMessageComponents(components: Array<ActionRowBuilder<ButtonBuilder>>): any[] {
    return components.map(component => component.toJSON());
  }

  async waitForChoice(requestId: string): Promise<ButtonPromptResult> {
    const key = this.getCacheKey(requestId);

    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const state = await this.cache.get<PendingButtonPrompt>(key);

      if (!state) {
        return {
          cancelled: false,
          selectedIndex: 0,
          timedOut: true,
        };
      }

      if (state.status === 'selected') {
        return {
          cancelled: false,
          selectedIndex: state.selectedIndex ?? state.fallbackIndex,
          timedOut: state.timedOut ?? false,
        };
      }

      if (state.status === 'cancelled') {
        return {
          cancelled: true,
          selectedIndex: null,
          timedOut: false,
        };
      }

      const timedOutState = finalizeTimedOutPrompt(state);
      if (timedOutState) {
        // eslint-disable-next-line no-await-in-loop
        await this.cache.set<PendingButtonPrompt>(key, timedOutState, ONE_MINUTE_IN_SECONDS);

        return {
          cancelled: false,
          selectedIndex: timedOutState.selectedIndex ?? timedOutState.fallbackIndex,
          timedOut: true,
        };
      }

      // eslint-disable-next-line no-await-in-loop
      await sleep(500);
    }
  }

  async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const [, requestId, choice] = interaction.customId.split(':');

    if (!requestId || !choice) {
      await interaction.reply({content: 'that prompt is malformed', ephemeral: true});
      return;
    }

    const key = this.getCacheKey(requestId);
    const state = await this.cache.get<PendingButtonPrompt>(key);

    if (!state || state.status !== 'pending' || Date.now() >= state.expiresAt) {
      await interaction.reply({content: 'that prompt already expired', ephemeral: true});
      return;
    }

    if (interaction.user.id !== state.requesterId) {
      await interaction.reply({content: 'that prompt is only for the person who started it', ephemeral: true});
      return;
    }

    const {error, nextState} = applyPromptChoice(state, interaction.user.id, choice);
    if (error) {
      await interaction.reply({content: error, ephemeral: true});
      return;
    }

    await this.cache.set<PendingButtonPrompt>(key, nextState, ONE_MINUTE_IN_SECONDS);
    await interaction.deferUpdate();
  }

  private getCacheKey(requestId: string): string {
    return `button-prompt:${requestId}`;
  }
}
