import { createSessionGuard, type SessionGuard } from './guard.js';
import type { SessionGuardPolicy } from './types.js';

const basePolicy: SessionGuardPolicy = {
  idleMinutes: 5,
  lockOnBackground: true,
  maxFailedAttempts: 3,
  cooldownMinutes: 10,
};

function minutes(n: number): number {
  return n * 60_000;
}

/** Drives a freshly created guard from its initial locked state to unlocked. */
async function unlock(guard: SessionGuard): Promise<void> {
  await guard.ready;
  guard.beginAuthentication();
  guard.recordAuthResult('success');
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('cold start', () => {
  it('always starts locked, regardless of how the previous session ended', async () => {
    const guard = createSessionGuard(basePolicy);
    await guard.ready;
    expect(guard.getState()).toEqual({ status: 'locked', reason: 'initial', failedAttempts: 0 });
  });
});

describe('idle timeout', () => {
  it('locks with reason "idle" once idleMinutes elapses with no activity', async () => {
    const guard = createSessionGuard(basePolicy);
    await unlock(guard);

    jest.advanceTimersByTime(minutes(5));

    expect(guard.getState()).toEqual({ status: 'locked', reason: 'idle', failedAttempts: 0 });
  });

  it('recordActivity() defers the idle lock by restarting the timer', async () => {
    const guard = createSessionGuard(basePolicy);
    await unlock(guard);

    jest.advanceTimersByTime(minutes(4));
    guard.recordActivity();
    jest.advanceTimersByTime(minutes(4));

    expect(guard.getState().status).toBe('unlocked');

    jest.advanceTimersByTime(minutes(1));

    expect(guard.getState().status).toBe('locked');
  });

  it('does not fire while an auth prompt is already open (race: idle timer during open prompt)', async () => {
    const guard = createSessionGuard(basePolicy);
    await unlock(guard);
    jest.advanceTimersByTime(minutes(5));
    guard.beginAuthentication();

    jest.advanceTimersByTime(minutes(30));

    expect(guard.getState().status).toBe('authenticating');
  });

  it('restarts after a successful authentication returns the guard to unlocked', async () => {
    const guard = createSessionGuard(basePolicy);
    await unlock(guard);
    jest.advanceTimersByTime(minutes(5));
    guard.beginAuthentication();
    guard.recordAuthResult('success');

    jest.advanceTimersByTime(minutes(4));
    expect(guard.getState().status).toBe('unlocked');

    jest.advanceTimersByTime(minutes(1));
    expect(guard.getState()).toEqual({ status: 'locked', reason: 'idle', failedAttempts: 0 });
  });
});

describe('background re-lock', () => {
  it('locks immediately on notifyBackground() while unlocked', async () => {
    const guard = createSessionGuard(basePolicy);
    await unlock(guard);

    guard.notifyBackground();

    expect(guard.getState()).toEqual({ status: 'locked', reason: 'background', failedAttempts: 0 });
  });

  it('clears the idle timer once locked, so it cannot also fire later', async () => {
    const guard = createSessionGuard(basePolicy);
    await unlock(guard);
    const listener = jest.fn();
    guard.subscribe(listener);

    guard.notifyBackground();
    listener.mockClear();
    jest.advanceTimersByTime(minutes(30));

    expect(listener).not.toHaveBeenCalled();
  });

  it('is a no-op while an auth prompt is open (race: backgrounding mid-prompt)', async () => {
    const guard = createSessionGuard(basePolicy);
    await guard.ready;
    guard.beginAuthentication();
    guard.notifyBackground();

    expect(guard.getState().status).toBe('authenticating');
  });
});

describe('failed-attempt lockout', () => {
  it('enters cooldown once maxFailedAttempts is reached and auto-recovers to locked afterwards', async () => {
    const guard = createSessionGuard(basePolicy);
    await guard.ready;
    guard.beginAuthentication();
    guard.recordAuthResult('failure');
    guard.beginAuthentication();
    guard.recordAuthResult('failure');
    guard.beginAuthentication();
    guard.recordAuthResult('failure');

    expect(guard.getState().status).toBe('cooldown');

    jest.advanceTimersByTime(minutes(10));

    expect(guard.getState()).toEqual({
      status: 'locked',
      reason: 'cooldown-expired',
      failedAttempts: 0,
    });
  });

  it('rejects beginAuthentication() while cooldown is active', async () => {
    const guard = createSessionGuard(basePolicy);
    await guard.ready;
    for (let i = 0; i < 3; i += 1) {
      guard.beginAuthentication();
      guard.recordAuthResult('failure');
    }

    guard.beginAuthentication();

    expect(guard.getState().status).toBe('cooldown');
  });

  it('does not penalize a cancelled prompt', async () => {
    const guard = createSessionGuard(basePolicy);
    await guard.ready;
    guard.beginAuthentication();
    guard.recordAuthResult('cancelled');

    expect(guard.getState()).toEqual({ status: 'locked', reason: 'retry', failedAttempts: 0 });
  });
});

describe('subscribe/unsubscribe', () => {
  it('notifies subscribers on real transitions and stops after unsubscribing', async () => {
    const guard = createSessionGuard(basePolicy);
    await guard.ready;
    const listener = jest.fn();
    const unsubscribe = guard.subscribe(listener);

    guard.beginAuthentication();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    guard.recordAuthResult('success');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify subscribers for a fully no-op reset', async () => {
    const guard: SessionGuard = createSessionGuard(basePolicy);
    await unlock(guard);
    const listener = jest.fn();
    guard.subscribe(listener);

    guard.reset();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('destroy', () => {
  it('stops pending timers so no further transitions fire', async () => {
    const guard = createSessionGuard(basePolicy);
    await unlock(guard);
    guard.destroy();

    jest.advanceTimersByTime(minutes(30));

    expect(guard.getState().status).toBe('unlocked');
  });

  it('ignores dispatches and stops notifying subscribers after being destroyed', async () => {
    const guard = createSessionGuard(basePolicy);
    await guard.ready;
    const listener = jest.fn();
    guard.subscribe(listener);
    guard.destroy();

    guard.beginAuthentication();

    expect(listener).not.toHaveBeenCalled();
    expect(guard.getState().status).toBe('locked');
  });
});
