import type {QueuedSong} from '../services/player.js';

export const replaceCurrentQueueEntry = (queue: QueuedSong[], queuePosition: number, song: QueuedSong): QueuedSong[] => {
  if (!queue[queuePosition]) {
    throw new Error('No song is currently playing.');
  }

  return [...queue.slice(0, queuePosition), song, ...queue.slice(queuePosition + 1)];
};

export const replaceUpcomingQueueEntry = (queue: QueuedSong[], queuePosition: number, position: number, song: QueuedSong): QueuedSong[] => {
  const absoluteIndex = queuePosition + position;

  if (position < 1 || !queue[absoluteIndex]) {
    throw new Error('Replace index is outside the range of the queue.');
  }

  return [...queue.slice(0, absoluteIndex), song, ...queue.slice(absoluteIndex + 1)];
};
