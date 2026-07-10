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

const isStrongUnofficialMatch = (candidate: SongSelectionCandidate): boolean => candidate.exactTitleMatch
  && candidate.artistMatch
  && hasDurationWithin(candidate, 5);

const isDurationFingerprintMatch = (candidate: SongSelectionCandidate): boolean => candidate.exactTitleMatch
  && hasDurationWithin(candidate, 2);

const hasStrongRunnerUpLead = (candidate: SongSelectionCandidate, runnerUp?: SongSelectionCandidate): boolean => runnerUp !== undefined
  && candidate.exactTitleMatch
  && hasDurationWithin(candidate, 10)
  && candidate.score - runnerUp.score >= 160;

export const classifySpotifyCandidates = (candidates: SongSelectionCandidate[]): SpotifyCandidateDecision => {
  if (candidates.length === 0) {
    return {
      status: 'not-found',
      candidates,
    };
  }

  const [topCandidate, runnerUp] = candidates;

  if (isPreferredSourceMatch(topCandidate)
    || isStrongUnofficialMatch(topCandidate)
    || isDurationFingerprintMatch(topCandidate)
    || hasStrongRunnerUpLead(topCandidate, runnerUp)) {
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
