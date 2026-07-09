export type PendingButtonPromptState = {
  requesterId: string;
  optionCount: number;
  fallbackIndex: number;
  expiresAt: number;
  status: 'pending' | 'selected' | 'cancelled';
  selectedIndex?: number;
  timedOut?: boolean;
};

export type PendingButtonPromptResult = {
  error?: string;
  nextState: PendingButtonPromptState;
};

export const finalizeTimedOutPrompt = <T extends PendingButtonPromptState>(state: T, now = Date.now()): T | null => {
  if (state.status !== 'pending' || now < state.expiresAt) {
    return null;
  }

  const nextState: T = {
    ...state,
    status: 'selected',
    selectedIndex: state.fallbackIndex,
    timedOut: true,
  };
  return nextState;
};

export const applyPromptChoice = <T extends PendingButtonPromptState>(state: T, actingUserId: string, choice: string, now = Date.now()): {error?: string; nextState: T} => {
  if (state.status !== 'pending' || now >= state.expiresAt) {
    return {
      error: 'that prompt already expired',
      nextState: state,
    };
  }

  if (actingUserId !== state.requesterId) {
    return {
      error: 'that prompt is only for the person who started it',
      nextState: state,
    };
  }

  if (choice === 'cancel') {
    const nextState: T = {
      ...state,
      status: 'cancelled',
    };
    return {
      nextState,
    };
  }

  const selectedIndex = Number.parseInt(choice, 10) - 1;

  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= state.optionCount) {
    return {
      error: 'that button choice is invalid',
      nextState: state,
    };
  }

  const nextState: T = {
    ...state,
    status: 'selected',
    selectedIndex,
    timedOut: false,
  };
  return {
    nextState,
  };
};
