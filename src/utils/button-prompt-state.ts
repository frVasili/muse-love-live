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

export const finalizeTimedOutPrompt = (state: PendingButtonPromptState, now = Date.now()): PendingButtonPromptState | null => {
  if (state.status !== 'pending' || now < state.expiresAt) {
    return null;
  }

  return {
    ...state,
    status: 'selected',
    selectedIndex: state.fallbackIndex,
    timedOut: true,
  };
};

export const applyPromptChoice = (state: PendingButtonPromptState, actingUserId: string, choice: string, now = Date.now()): PendingButtonPromptResult => {
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
    return {
      nextState: {
        ...state,
        status: 'cancelled',
      },
    };
  }

  const selectedIndex = Number.parseInt(choice, 10) - 1;

  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= state.optionCount) {
    return {
      error: 'that button choice is invalid',
      nextState: state,
    };
  }

  return {
    nextState: {
      ...state,
      status: 'selected',
      selectedIndex,
      timedOut: false,
    },
  };
};
