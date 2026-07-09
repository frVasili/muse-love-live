import {strict as assert} from 'node:assert';
import {applyPromptChoice, finalizeTimedOutPrompt} from '../src/utils/button-prompt-state.js';

{
  const timedOut = finalizeTimedOutPrompt({
    requesterId: 'user-1',
    optionCount: 2,
    fallbackIndex: 0,
    expiresAt: Date.now() - 1000,
    status: 'pending',
  });

  assert.equal(timedOut?.status, 'selected');
  assert.equal(timedOut?.selectedIndex, 0);
  assert.equal(timedOut?.timedOut, true);
}

{
  const {error, nextState} = applyPromptChoice({
    requesterId: 'user-1',
    optionCount: 2,
    fallbackIndex: 0,
    expiresAt: Date.now() + 1000,
    status: 'pending',
  }, 'someone-else', '2');

  assert.match(error ?? '', /only for the person/i);
  assert.equal(nextState.status, 'pending');
}

{
  const {error, nextState} = applyPromptChoice({
    requesterId: 'user-1',
    optionCount: 2,
    fallbackIndex: 0,
    expiresAt: Date.now() + 1000,
    status: 'pending',
  }, 'user-1', '2');

  assert.equal(error, undefined);
  assert.equal(nextState.status, 'selected');
  assert.equal(nextState.selectedIndex, 1);
}
