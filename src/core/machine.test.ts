import { transition, type TransitionPolicy } from './machine.js';
import type { GuardState, LockReason } from './types.js';

const policy: TransitionPolicy = {
  lockOnBackground: true,
  maxFailedAttempts: 3,
  cooldownMinutes: 5,
};

const NOW = 1_700_000_000_000;

const unlocked = (failedAttempts = 0): GuardState => ({ status: 'unlocked', failedAttempts });
const locked = (reason: LockReason, failedAttempts = 0): GuardState => ({
  status: 'locked',
  reason,
  failedAttempts,
});
const authenticating = (failedAttempts = 0): GuardState => ({
  status: 'authenticating',
  failedAttempts,
});
const cooldown = (cooldownUntil: number, failedAttempts = 3): GuardState => ({
  status: 'cooldown',
  failedAttempts,
  cooldownUntil,
});

describe('transition table: unlocked', () => {
  it('ACTIVITY is a no-op', () => {
    expect(transition(unlocked(), { type: 'ACTIVITY' }, policy, NOW)).toEqual(unlocked());
  });

  it('IDLE_TIMEOUT locks with reason "idle"', () => {
    expect(transition(unlocked(), { type: 'IDLE_TIMEOUT' }, policy, NOW)).toEqual(locked('idle'));
  });

  it('APP_BACKGROUNDED locks with reason "background" when lockOnBackground is enabled', () => {
    expect(transition(unlocked(), { type: 'APP_BACKGROUNDED' }, policy, NOW)).toEqual(
      locked('background'),
    );
  });

  it('APP_BACKGROUNDED is a no-op when lockOnBackground is disabled', () => {
    const disabled: TransitionPolicy = { ...policy, lockOnBackground: false };
    expect(transition(unlocked(), { type: 'APP_BACKGROUNDED' }, disabled, NOW)).toEqual(unlocked());
  });

  it('BEGIN_AUTH is a no-op (nothing to authenticate against)', () => {
    expect(transition(unlocked(), { type: 'BEGIN_AUTH' }, policy, NOW)).toEqual(unlocked());
  });

  it('AUTH_RESULT is a no-op (no auth in flight)', () => {
    expect(
      transition(unlocked(), { type: 'AUTH_RESULT', outcome: 'success' }, policy, NOW),
    ).toEqual(unlocked());
  });

  it('RESET clears failedAttempts and stays unlocked', () => {
    expect(transition(unlocked(2), { type: 'RESET' }, policy, NOW)).toEqual(unlocked(0));
  });
});

describe('transition table: locked', () => {
  it('BEGIN_AUTH moves to authenticating, preserving failedAttempts', () => {
    expect(transition(locked('idle', 1), { type: 'BEGIN_AUTH' }, policy, NOW)).toEqual(
      authenticating(1),
    );
  });

  it('ACTIVITY is a no-op while locked', () => {
    expect(transition(locked('idle'), { type: 'ACTIVITY' }, policy, NOW)).toEqual(locked('idle'));
  });

  it('APP_BACKGROUNDED is a no-op while already locked (idempotent)', () => {
    expect(transition(locked('idle'), { type: 'APP_BACKGROUNDED' }, policy, NOW)).toEqual(
      locked('idle'),
    );
  });

  it('AUTH_RESULT is a no-op while locked (no auth in flight)', () => {
    expect(
      transition(locked('idle'), { type: 'AUTH_RESULT', outcome: 'success' }, policy, NOW),
    ).toEqual(locked('idle'));
  });

  it('RESET clears failedAttempts and returns to unlocked', () => {
    expect(transition(locked('idle', 2), { type: 'RESET' }, policy, NOW)).toEqual(unlocked(0));
  });
});

describe('transition table: authenticating', () => {
  it('AUTH_RESULT success unlocks and resets failedAttempts', () => {
    expect(
      transition(authenticating(2), { type: 'AUTH_RESULT', outcome: 'success' }, policy, NOW),
    ).toEqual(unlocked(0));
  });

  it('AUTH_RESULT failure below the threshold increments the counter and returns to locked with reason "retry"', () => {
    expect(
      transition(authenticating(1), { type: 'AUTH_RESULT', outcome: 'failure' }, policy, NOW),
    ).toEqual(locked('retry', 2));
  });

  it('AUTH_RESULT failure that reaches maxFailedAttempts enters cooldown', () => {
    expect(
      transition(authenticating(2), { type: 'AUTH_RESULT', outcome: 'failure' }, policy, NOW),
    ).toEqual(cooldown(NOW + policy.cooldownMinutes * 60_000, 3));
  });

  it('AUTH_RESULT cancelled returns to locked with reason "retry" without penalty', () => {
    expect(
      transition(authenticating(1), { type: 'AUTH_RESULT', outcome: 'cancelled' }, policy, NOW),
    ).toEqual(locked('retry', 1));
  });

  it('APP_BACKGROUNDED is a no-op while a prompt is in flight (race: backgrounding mid-prompt)', () => {
    expect(transition(authenticating(1), { type: 'APP_BACKGROUNDED' }, policy, NOW)).toEqual(
      authenticating(1),
    );
  });

  it('BEGIN_AUTH is a no-op while already authenticating (race: double-invoked prompt)', () => {
    expect(transition(authenticating(1), { type: 'BEGIN_AUTH' }, policy, NOW)).toEqual(
      authenticating(1),
    );
  });

  it('RESET clears failedAttempts and returns to unlocked', () => {
    expect(transition(authenticating(2), { type: 'RESET' }, policy, NOW)).toEqual(unlocked(0));
  });
});

describe('transition table: cooldown', () => {
  const activeCooldown = cooldown(NOW + 60_000);

  it('COOLDOWN_EXPIRED returns to locked with reason "cooldown-expired" and resets the counter', () => {
    expect(transition(activeCooldown, { type: 'COOLDOWN_EXPIRED' }, policy, NOW)).toEqual(
      locked('cooldown-expired', 0),
    );
  });

  it('ACTIVITY is a no-op during cooldown', () => {
    expect(transition(activeCooldown, { type: 'ACTIVITY' }, policy, NOW)).toEqual(activeCooldown);
  });

  it('APP_BACKGROUNDED is a no-op during cooldown', () => {
    expect(transition(activeCooldown, { type: 'APP_BACKGROUNDED' }, policy, NOW)).toEqual(
      activeCooldown,
    );
  });

  it('BEGIN_AUTH is a no-op during cooldown (host must wait for COOLDOWN_EXPIRED)', () => {
    expect(transition(activeCooldown, { type: 'BEGIN_AUTH' }, policy, NOW)).toEqual(activeCooldown);
  });

  it('AUTH_RESULT is a no-op during cooldown', () => {
    expect(
      transition(activeCooldown, { type: 'AUTH_RESULT', outcome: 'success' }, policy, NOW),
    ).toEqual(activeCooldown);
  });

  it('RESET escapes cooldown early and returns to unlocked', () => {
    expect(transition(activeCooldown, { type: 'RESET' }, policy, NOW)).toEqual(unlocked(0));
  });
});

describe('race condition: multiple triggers firing near-simultaneously', () => {
  it('two APP_BACKGROUNDED events in a row resolve deterministically to the same locked state', () => {
    const afterFirst = transition(unlocked(), { type: 'APP_BACKGROUNDED' }, policy, NOW);
    const afterSecond = transition(afterFirst, { type: 'APP_BACKGROUNDED' }, policy, NOW);
    expect(afterFirst).toEqual(locked('background'));
    expect(afterSecond).toEqual(locked('background'));
  });

  it('an IDLE_TIMEOUT immediately followed by APP_BACKGROUNDED both land on locked, non-destructively', () => {
    const afterIdle = transition(unlocked(), { type: 'IDLE_TIMEOUT' }, policy, NOW);
    const afterBackground = transition(afterIdle, { type: 'APP_BACKGROUNDED' }, policy, NOW);
    expect(afterIdle).toEqual(locked('idle'));
    expect(afterBackground).toEqual(locked('idle'));
  });
});
