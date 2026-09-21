import { createSessionGuard } from './index.js';

describe('public entry point', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exposes a working createSessionGuard, starting locked', async () => {
    const guard = createSessionGuard({
      idleMinutes: 5,
      lockOnBackground: true,
      maxFailedAttempts: 3,
      cooldownMinutes: 10,
    });

    await guard.ready;
    expect(guard.getState()).toEqual({ status: 'locked', reason: 'initial', failedAttempts: 0 });
  });
});
