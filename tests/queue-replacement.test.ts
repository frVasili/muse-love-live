import {strict as assert} from 'node:assert';
import {replaceCurrentQueueEntry, replaceUpcomingQueueEntry} from '../src/utils/queue-replacement.js';

const song = (title: string, url: string) => ({
  title,
  artist: 'Artist',
  url,
  length: 240,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  source: 0 as any,
  addedInChannelId: 'channel-id',
  requestedBy: 'user-id',
});

const queue = [
  song('Current Song', 'current12345'),
  song('Queued Song 1', 'queue123451'),
  song('Queued Song 2', 'queue123452'),
];

const replacedCurrent = replaceCurrentQueueEntry(queue, 0, song('Replacement Current', 'replace99999'));
assert.equal(replacedCurrent[0].title, 'Replacement Current');
assert.equal(replacedCurrent[1].title, 'Queued Song 1');

const replacedUpcoming = replaceUpcomingQueueEntry(queue, 0, 2, song('Replacement Queue', 'replace88888'));
assert.equal(replacedUpcoming[2].title, 'Replacement Queue');

assert.throws(() => {
  replaceUpcomingQueueEntry(queue, 0, 10, song('Nope', 'missing'));
});
