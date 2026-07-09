import type {SongSelectionCandidate} from '../services/youtube-api.js';

export type SpotifyCandidateDecisionStatus = 'high-confidence' | 'uncertain' | 'not-found';

export type SpotifyCandidateDecision = {
  status: SpotifyCandidateDecisionStatus;
  selectedCandidate?: SongSelectionCandidate;
  candidates: SongSelectionCandidate[];
};

export const classifySpotifyCandidates = (candidates: SongSelectionCandidate[]): SpotifyCandidateDecision => {
  if (candidates.length === 0) {
    return {
      status: 'not-found',
      candidates,
    };
  }

  const [topCandidate, runnerUp] = candidates;
  const {durationDeltaSeconds} = topCandidate;
  const runnerUpScoreDelta = runnerUp === undefined ? Number.POSITIVE_INFINITY : topCandidate.score - runnerUp.score;
  const isExactDurationMatch = typeof durationDeltaSeconds === 'number' && durationDeltaSeconds <= 5;
  const isStrongRunnerUpLead = topCandidate.artistMatch
    && typeof durationDeltaSeconds === 'number'
    && durationDeltaSeconds <= 10
    && runnerUpScoreDelta >= 80;

  if ((topCandidate.exactTitleMatch && isExactDurationMatch) || isStrongRunnerUpLead) {
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
