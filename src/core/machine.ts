import type { AuthOutcome, GuardEvent, GuardState } from './types.js';

export interface TransitionPolicy {
  lockOnBackground: boolean;
  maxFailedAttempts: number;
  cooldownMinutes: number;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled guard state: ${JSON.stringify(value)}`);
}

export function transition(
  state: GuardState,
  event: GuardEvent,
  policy: TransitionPolicy,
  now: number,
): GuardState {
  if (event.type === 'RESET') {
    if (state.status === 'unlocked' && state.failedAttempts === 0) {
      return state;
    }
    return { status: 'unlocked', failedAttempts: 0 };
  }

  switch (state.status) {
    case 'unlocked':
      switch (event.type) {
        case 'IDLE_TIMEOUT':
          return { status: 'locked', reason: 'idle', failedAttempts: state.failedAttempts };
        case 'APP_BACKGROUNDED':
          return policy.lockOnBackground
            ? { status: 'locked', reason: 'background', failedAttempts: state.failedAttempts }
            : state;
        default:
          return state;
      }

    case 'locked':
      switch (event.type) {
        case 'BEGIN_AUTH':
          return { status: 'authenticating', failedAttempts: state.failedAttempts };
        default:
          return state;
      }

    case 'authenticating':
      switch (event.type) {
        case 'AUTH_RESULT':
          return applyAuthResult(state, event.outcome, policy, now);
        default:
          return state;
      }

    case 'cooldown':
      switch (event.type) {
        case 'COOLDOWN_EXPIRED':
          return { status: 'locked', reason: 'cooldown-expired', failedAttempts: 0 };
        default:
          return state;
      }

    default:
      return assertNever(state);
  }
}

function applyAuthResult(
  state: Extract<GuardState, { status: 'authenticating' }>,
  outcome: AuthOutcome,
  policy: TransitionPolicy,
  now: number,
): GuardState {
  if (outcome === 'success') {
    return { status: 'unlocked', failedAttempts: 0 };
  }

  if (outcome === 'cancelled') {
    return { status: 'locked', reason: 'retry', failedAttempts: state.failedAttempts };
  }

  const failedAttempts = state.failedAttempts + 1;
  if (failedAttempts >= policy.maxFailedAttempts) {
    return {
      status: 'cooldown',
      failedAttempts,
      cooldownUntil: now + policy.cooldownMinutes * 60_000,
    };
  }
  return { status: 'locked', reason: 'retry', failedAttempts };
}
