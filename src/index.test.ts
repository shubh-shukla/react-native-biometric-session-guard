import { createSessionGuard } from './index.js';

describe('public entry point', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exposes a working createSessionGuard', () => {
    const guard = createSessionGuard({
      idleMinutes: 5,
      lockOnBackground: true,
      maxFailedAttempts: 3,
      cooldownMinutes: 10,
    });

    expect(guard.getState()).toEqual({ status: 'unlocked', failedAttempts: 0 });
  });
});
