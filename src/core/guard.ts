import { transition, type TransitionPolicy } from './machine.js';
import {
  createInMemoryStorageAdapter,
  readPersistedLockoutState,
  writePersistedLockoutState,
} from './storage.js';
import type {
  AuthOutcome,
  GuardEvent,
  GuardState,
  SessionGuardPolicy,
  StorageAdapter,
} from './types.js';

export interface SessionGuard {
  readonly ready: Promise<void>;
  getState(): GuardState;
  subscribe(listener: (state: GuardState) => void): () => void;
  recordActivity(): void;
  beginAuthentication(): void;
  recordAuthResult(outcome: AuthOutcome): void;
  notifyBackground(): void;
  reset(): void;
  destroy(): void;
}

function warnMissingStorageAdapter(): void {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  console.warn(
    '[react-native-biometric-session-guard] No storageAdapter was provided. Falling back to an ' +
      'in-memory adapter that will NOT survive an app kill, so the failed-attempt lockout can be ' +
      'bypassed by force-quitting the app. Pass a persistent storageAdapter backed by AsyncStorage, ' +
      'MMKV, or similar in production.',
  );
}

export function createSessionGuard(policy: SessionGuardPolicy): SessionGuard {
  const transitionPolicy: TransitionPolicy = {
    lockOnBackground: policy.lockOnBackground,
    maxFailedAttempts: policy.maxFailedAttempts,
    cooldownMinutes: policy.cooldownMinutes,
  };

  const adapter: StorageAdapter = policy.storageAdapter ?? createInMemoryStorageAdapter();
  if (!policy.storageAdapter) {
    warnMissingStorageAdapter();
  }

  let state: GuardState = { status: 'locked', reason: 'initial', failedAttempts: 0 };
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

  const persist = (): void => {
    const cooldownUntil = state.status === 'cooldown' ? state.cooldownUntil : undefined;
    writePersistedLockoutState(adapter, {
      failedAttempts: state.failedAttempts,
      cooldownUntil,
    }).catch(() => {
      // Best-effort: a write failure only weakens the cross-kill guarantee, it
      // doesn't affect the guard's correctness for the current process lifetime.
    });
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
    persist();
    listeners.forEach((listener) => listener(state));
  }

  async function hydrate(): Promise<void> {
    const persisted = await readPersistedLockoutState(adapter);
    if (destroyed || !persisted) {
      return;
    }

    const now = Date.now();
    if (persisted.cooldownUntil !== undefined && persisted.cooldownUntil > now) {
      state = {
        status: 'cooldown',
        failedAttempts: persisted.failedAttempts,
        cooldownUntil: persisted.cooldownUntil,
      };
    } else if (persisted.cooldownUntil !== undefined) {
      state = { status: 'locked', reason: 'cooldown-expired', failedAttempts: 0 };
      persist();
    } else if (persisted.failedAttempts > 0) {
      state = { status: 'locked', reason: 'initial', failedAttempts: persisted.failedAttempts };
    } else {
      return;
    }

    syncTimersToState();
    listeners.forEach((listener) => listener(state));
  }

  syncTimersToState();
  const readyPromise = hydrate();

  return {
    ready: readyPromise,

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
