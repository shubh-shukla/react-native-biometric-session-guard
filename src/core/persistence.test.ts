import { createSessionGuard } from './guard.js';
import type { SessionGuardPolicy, StorageAdapter } from './types.js';

const basePolicy: SessionGuardPolicy = {
  idleMinutes: 5,
  lockOnBackground: true,
  maxFailedAttempts: 3,
  cooldownMinutes: 10,
};

function minutes(n: number): number {
  return n * 60_000;
}

function fakeStorageAdapter(initial?: Record<string, string>): StorageAdapter {
  const store = new Map(Object.entries(initial ?? {}));
  return {
    async getItem(key) {
      return store.get(key) ?? null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
  };
}

const STORAGE_KEY = '@react-native-biometric-session-guard/lockout-state';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('persistence across app kill', () => {
  it('does not warn when a storageAdapter is provided', async () => {
    const storageAdapter = fakeStorageAdapter();
    const guard = createSessionGuard({ ...basePolicy, storageAdapter });
    await guard.ready;

    expect(console.warn).not.toHaveBeenCalled();
  });

  it('warns when no storageAdapter is provided', async () => {
    const guard = createSessionGuard(basePolicy);
    await guard.ready;

    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('resumes a survived failed-attempt count instead of resetting it (kill-to-reset attack)', async () => {
    const storageAdapter = fakeStorageAdapter({
      [STORAGE_KEY]: JSON.stringify({ failedAttempts: 2 }),
    });

    const guard = createSessionGuard({ ...basePolicy, storageAdapter });
    await guard.ready;

    expect(guard.getState()).toEqual({ status: 'locked', reason: 'initial', failedAttempts: 2 });

    guard.beginAuthentication();
    guard.recordAuthResult('failure');

    expect(guard.getState().status).toBe('cooldown');
  });

  it('rehydrates directly into cooldown with the remaining duration if killed mid-cooldown', async () => {
    const cooldownUntil = Date.now() + minutes(7);
    const storageAdapter = fakeStorageAdapter({
      [STORAGE_KEY]: JSON.stringify({ failedAttempts: 3, cooldownUntil }),
    });

    const guard = createSessionGuard({ ...basePolicy, storageAdapter });
    await guard.ready;

    expect(guard.getState()).toEqual({ status: 'cooldown', failedAttempts: 3, cooldownUntil });

    jest.advanceTimersByTime(minutes(7));

    expect(guard.getState()).toEqual({
      status: 'locked',
      reason: 'cooldown-expired',
      failedAttempts: 0,
    });
  });

  it('auto-recovers and resets the counter if the cooldown fully elapsed while the app was dead', async () => {
    const cooldownUntil = Date.now() - minutes(1);
    const storageAdapter = fakeStorageAdapter({
      [STORAGE_KEY]: JSON.stringify({ failedAttempts: 3, cooldownUntil }),
    });

    const guard = createSessionGuard({ ...basePolicy, storageAdapter });
    await guard.ready;

    expect(guard.getState()).toEqual({
      status: 'locked',
      reason: 'cooldown-expired',
      failedAttempts: 0,
    });
  });

  it('persists failedAttempts and cooldownUntil so a re-created guard rehydrates the same state', async () => {
    const storageAdapter = fakeStorageAdapter();
    const first = createSessionGuard({ ...basePolicy, storageAdapter });
    await first.ready;

    first.beginAuthentication();
    first.recordAuthResult('failure');
    first.beginAuthentication();
    first.recordAuthResult('failure');
    first.beginAuthentication();
    first.recordAuthResult('failure');
    expect(first.getState().status).toBe('cooldown');
    first.destroy();

    const second = createSessionGuard({ ...basePolicy, storageAdapter });
    await second.ready;

    expect(second.getState().status).toBe('cooldown');
    expect(second.getState().failedAttempts).toBe(3);
  });

  it('clears the persisted lockout after reset(), so a re-created guard starts clean', async () => {
    const storageAdapter = fakeStorageAdapter();
    const first = createSessionGuard({ ...basePolicy, storageAdapter });
    await first.ready;
    first.beginAuthentication();
    first.recordAuthResult('failure');
    first.reset();
    first.destroy();

    const second = createSessionGuard({ ...basePolicy, storageAdapter });
    await second.ready;

    expect(second.getState()).toEqual({ status: 'locked', reason: 'initial', failedAttempts: 0 });
  });

  it('falls back to a clean state when the persisted payload is corrupted', async () => {
    const storageAdapter = fakeStorageAdapter({ [STORAGE_KEY]: 'not-json' });
    const guard = createSessionGuard({ ...basePolicy, storageAdapter });
    await guard.ready;

    expect(guard.getState()).toEqual({ status: 'locked', reason: 'initial', failedAttempts: 0 });
  });
});
