import {strict as assert} from 'node:assert';
import {classifySpotifyCandidates} from '../src/utils/spotify-track-resolution.js';
import type {SongSelectionCandidate} from '../src/services/youtube-api.js';

const candidate = (overrides: Partial<SongSelectionCandidate> = {}): SongSelectionCandidate => ({
  videoId: 'video1234567',
  title: 'Song',
  artist: 'Artist',
  length: 240,
  thumbnailUrl: null,
  isLive: false,
  score: 0,
  songs: [{
    title: 'Song',
    artist: 'Artist',
    url: 'video1234567',
    length: 240,
    offset: 0,
    playlist: null,
    isLive: false,
    thumbnailUrl: null,
    source: 0 as any,
  }],
  titleMatch: true,
  exactTitleMatch: true,
  durationDeltaSeconds: 0,
  ...overrides,
});

{
  const resolution = classifySpotifyCandidates([
    candidate({score: 300, exactTitleMatch: true, durationDeltaSeconds: 3}),
  ]);

  assert.equal(resolution.status, 'high-confidence');
  assert.equal(resolution.selectedCandidate?.videoId, 'video1234567');
}

{
  const resolution = classifySpotifyCandidates([
    candidate({videoId: 'top', score: 240, exactTitleMatch: false, durationDeltaSeconds: 9}),
    candidate({videoId: 'runner-up', score: 100, exactTitleMatch: false, durationDeltaSeconds: 8}),
  ]);

  assert.equal(resolution.status, 'high-confidence');
  assert.equal(resolution.selectedCandidate?.videoId, 'top');
}

{
  const resolution = classifySpotifyCandidates([
    candidate({videoId: 'top', score: 240, exactTitleMatch: false, durationDeltaSeconds: 12}),
    candidate({videoId: 'runner-up', score: 200, exactTitleMatch: false, durationDeltaSeconds: 10}),
  ]);

  assert.equal(resolution.status, 'uncertain');
  assert.equal(resolution.selectedCandidate?.videoId, 'top');
}

{
  const resolution = classifySpotifyCandidates([]);

  assert.equal(resolution.status, 'not-found');
}
