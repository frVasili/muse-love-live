export const selectPlaylistItems = <T>(
  items: T[],
  limit: number,
  shouldShuffle: boolean,
  random: () => number = Math.random,
): T[] => {
  const selected = [...items];

  if (shouldShuffle) {
    for (let index = selected.length - 1; index > 0; index--) {
      const randomIndex = Math.floor(random() * (index + 1));
      [selected[index], selected[randomIndex]] = [selected[randomIndex], selected[index]];
    }
  }

  return Number.isFinite(limit) ? selected.slice(0, Math.max(0, limit)) : selected;
};
