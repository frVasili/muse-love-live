import type {SongSelectionCandidate} from '../services/youtube-api.js';

export type SpotifyCandidateDecisionStatus = 'high-confidence' | 'uncertain' | 'not-found';

export type SpotifyCandidateDecision = {
  status: SpotifyCandidateDecisionStatus;
  selectedCandidate?: SongSelectionCandidate;
  candidates: SongSelectionCandidate[];
};

const hasDurationWithin = (candidate: SongSelectionCandidate, seconds: number): boolean => typeof candidate.durationDeltaSeconds === 'number'
  && candidate.durationDeltaSeconds <= seconds;

const isPreferredSourceMatch = (candidate: SongSelectionCandidate): boolean => candidate.titleMatch
  && candidate.spotifySource !== undefined
  && candidate.spotifySource !== 'unofficial'
  && hasDurationWithin(candidate, 15)
  && (candidate.exactTitleMatch || candidate.spotifySource === 'topic' || candidate.artistMatch);

export const classifySpotifyCandidates = (candidates: SongSelectionCandidate[]): SpotifyCandidateDecision => {
  if (candidates.length === 0) {
    return {
      status: 'not-found',
      candidates,
    };
  }

  const [topCandidate] = candidates;

  if (isPreferredSourceMatch(topCandidate)) {
    return {
      status: 'high-confidence',
      selectedCandidate: topCandidate,
      candidates,
    };
  }

  return {
    status: 'uncertain',
    selectedCandidate: topCandidate,
    candidates,
  };
};
