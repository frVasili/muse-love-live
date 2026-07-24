import assert from 'node:assert/strict';
import {ChatInputCommandInteraction} from 'discord.js';
import PlayerManager from '../src/managers/player.js';
import ReverseSeek from '../src/commands/rseek.js';

let position = 90;
let seekTarget: number | undefined;
let reply = '';

const player = {
  getCurrent: () => ({length: 300, isLive: false}),
  getPosition: () => position,
  seek: async (target: number) => {
    seekTarget = target;
    position = target;
  },
};

const playerManager = {
  get: () => player,
} as unknown as PlayerManager;

const interaction = {
  guild: {id: 'test-guild'},
  options: {getString: () => '30s'},
  deferReply: async () => undefined,
  editReply: async (message: string) => {
    reply = message;
  },
} as unknown as ChatInputCommandInteraction;

const command = new ReverseSeek(playerManager);
await command.execute(interaction);

assert.equal(seekTarget, 60, 'rseek should subtract the requested duration from the current position');
assert.match(reply, /1:00$/, 'rseek should report the new playback position');

position = 20;
seekTarget = undefined;

await assert.rejects(
  command.execute(interaction),
  /can't seek before the beginning of the song/,
);
assert.equal(seekTarget, undefined, 'rseek should not seek before the beginning of the song');

console.log('rseek tests passed');
