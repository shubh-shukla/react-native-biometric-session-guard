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

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('idle timeout', () => {
  it('locks with reason "idle" once idleMinutes elapses with no activity', () => {
    const guard = createSessionGuard(basePolicy);

    jest.advanceTimersByTime(minutes(5));

    expect(guard.getState()).toEqual({ status: 'locked', reason: 'idle', failedAttempts: 0 });
  });

  it('recordActivity() defers the idle lock by restarting the timer', () => {
    const guard = createSessionGuard(basePolicy);

    jest.advanceTimersByTime(minutes(4));
    guard.recordActivity();
    jest.advanceTimersByTime(minutes(4));

    expect(guard.getState().status).toBe('unlocked');

    jest.advanceTimersByTime(minutes(1));

    expect(guard.getState().status).toBe('locked');
  });

  it('does not fire while an auth prompt is already open (race: idle timer during open prompt)', () => {
    const guard = createSessionGuard(basePolicy);
    jest.advanceTimersByTime(minutes(5));
    guard.beginAuthentication();

    jest.advanceTimersByTime(minutes(30));

    expect(guard.getState().status).toBe('authenticating');
  });

  it('restarts after a successful authentication returns the guard to unlocked', () => {
    const guard = createSessionGuard(basePolicy);
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
  it('locks immediately on notifyBackground() while unlocked', () => {
    const guard = createSessionGuard(basePolicy);
    guard.notifyBackground();
    expect(guard.getState()).toEqual({ status: 'locked', reason: 'background', failedAttempts: 0 });
  });

  it('clears the idle timer once locked, so it cannot also fire later', () => {
    const guard = createSessionGuard(basePolicy);
    const listener = jest.fn();
    guard.subscribe(listener);

    guard.notifyBackground();
    listener.mockClear();
    jest.advanceTimersByTime(minutes(30));

    expect(listener).not.toHaveBeenCalled();
  });

  it('is a no-op while an auth prompt is open (race: backgrounding mid-prompt)', () => {
    const guard = createSessionGuard(basePolicy);
    guard.notifyBackground();
    guard.beginAuthentication();
    guard.notifyBackground();

    expect(guard.getState().status).toBe('authenticating');
  });
});

describe('failed-attempt lockout', () => {
  it('enters cooldown once maxFailedAttempts is reached and auto-recovers to locked afterwards', () => {
    const guard = createSessionGuard(basePolicy);
    guard.notifyBackground();
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

  it('rejects beginAuthentication() while cooldown is active', () => {
    const guard = createSessionGuard(basePolicy);
    guard.notifyBackground();
    for (let i = 0; i < 3; i += 1) {
      guard.beginAuthentication();
      guard.recordAuthResult('failure');
    }

    guard.beginAuthentication();

    expect(guard.getState().status).toBe('cooldown');
  });

  it('does not penalize a cancelled prompt', () => {
    const guard = createSessionGuard(basePolicy);
    guard.notifyBackground();
    guard.beginAuthentication();
    guard.recordAuthResult('cancelled');

    expect(guard.getState()).toEqual({ status: 'locked', reason: 'retry', failedAttempts: 0 });
  });
});

describe('subscribe/unsubscribe', () => {
  it('notifies subscribers on real transitions and stops after unsubscribing', () => {
    const guard = createSessionGuard(basePolicy);
    const listener = jest.fn();
    const unsubscribe = guard.subscribe(listener);

    guard.notifyBackground();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    guard.reset();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify subscribers for a fully no-op reset', () => {
    const guard: SessionGuard = createSessionGuard(basePolicy);
    const listener = jest.fn();
    guard.subscribe(listener);

    guard.reset();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('destroy', () => {
  it('stops pending timers so no further transitions fire', () => {
    const guard = createSessionGuard(basePolicy);
    guard.destroy();

    jest.advanceTimersByTime(minutes(30));

    expect(guard.getState()).toEqual({ status: 'unlocked', failedAttempts: 0 });
  });

  it('ignores dispatches and stops notifying subscribers after being destroyed', () => {
    const guard = createSessionGuard(basePolicy);
    const listener = jest.fn();
    guard.subscribe(listener);
    guard.destroy();

    guard.notifyBackground();

    expect(listener).not.toHaveBeenCalled();
    expect(guard.getState().status).toBe('unlocked');
  });
});
