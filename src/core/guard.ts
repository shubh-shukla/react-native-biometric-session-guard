import { transition, type TransitionPolicy } from './machine.js';
import type { AuthOutcome, GuardEvent, GuardState, SessionGuardPolicy } from './types.js';

export interface SessionGuard {
  getState(): GuardState;
  subscribe(listener: (state: GuardState) => void): () => void;
  recordActivity(): void;
  beginAuthentication(): void;
  recordAuthResult(outcome: AuthOutcome): void;
  notifyBackground(): void;
  reset(): void;
  destroy(): void;
}

const INITIAL_STATE: GuardState = { status: 'unlocked', failedAttempts: 0 };

export function createSessionGuard(policy: SessionGuardPolicy): SessionGuard {
  const transitionPolicy: TransitionPolicy = {
    lockOnBackground: policy.lockOnBackground,
    maxFailedAttempts: policy.maxFailedAttempts,
    cooldownMinutes: policy.cooldownMinutes,
  };

  let state: GuardState = INITIAL_STATE;
  let destroyed = false;
  const listeners = new Set<(state: GuardState) => void>();

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let cooldownTimer: ReturnType<typeof setTimeout> | undefined;

  const clearIdleTimer = (): void => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };

  const clearCooldownTimer = (): void => {
    if (cooldownTimer !== undefined) {
      clearTimeout(cooldownTimer);
      cooldownTimer = undefined;
    }
  };

  const restartIdleTimer = (): void => {
    clearIdleTimer();
    idleTimer = setTimeout(() => dispatch({ type: 'IDLE_TIMEOUT' }), policy.idleMinutes * 60_000);
  };

  const restartCooldownTimer = (cooldownUntil: number): void => {
    clearCooldownTimer();
    const remaining = Math.max(cooldownUntil - Date.now(), 0);
    cooldownTimer = setTimeout(() => dispatch({ type: 'COOLDOWN_EXPIRED' }), remaining);
  };

  const syncTimersToState = (): void => {
    if (state.status === 'unlocked') {
      restartIdleTimer();
    } else {
      clearIdleTimer();
    }

    if (state.status === 'cooldown') {
      restartCooldownTimer(state.cooldownUntil);
    } else {
      clearCooldownTimer();
    }
  };

  function dispatch(event: GuardEvent): void {
    if (destroyed) {
      return;
    }
    const next = transition(state, event, transitionPolicy, Date.now());
    if (next === state) {
      return;
    }
    state = next;
    syncTimersToState();
    listeners.forEach((listener) => listener(state));
  }

  syncTimersToState();

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    recordActivity() {
      if (!destroyed && state.status === 'unlocked') {
        restartIdleTimer();
      }
    },

    beginAuthentication() {
      dispatch({ type: 'BEGIN_AUTH' });
    },

    recordAuthResult(outcome) {
      dispatch({ type: 'AUTH_RESULT', outcome });
    },

    notifyBackground() {
      dispatch({ type: 'APP_BACKGROUNDED' });
    },

    reset() {
      dispatch({ type: 'RESET' });
    },

    destroy() {
      destroyed = true;
      clearIdleTimer();
      clearCooldownTimer();
      listeners.clear();
    },
  };
}
