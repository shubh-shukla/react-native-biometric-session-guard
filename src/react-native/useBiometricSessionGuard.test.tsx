/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { createSessionGuard, type SessionGuardPolicy } from '../core/index.js';
import { useBiometricSessionGuard } from './useBiometricSessionGuard.js';

const policy: SessionGuardPolicy = {
  idleMinutes: 5,
  lockOnBackground: true,
  maxFailedAttempts: 3,
  cooldownMinutes: 10,
};

describe('useBiometricSessionGuard', () => {
  it('returns the guard current state on first render', async () => {
    const guard = createSessionGuard(policy);
    await guard.ready;

    const { result } = renderHook(() => useBiometricSessionGuard(guard));

    expect(result.current).toEqual({ status: 'locked', reason: 'initial', failedAttempts: 0 });
    guard.destroy();
  });

  it('re-renders with the new state on every guard transition', async () => {
    const guard = createSessionGuard(policy);
    await guard.ready;

    const { result } = renderHook(() => useBiometricSessionGuard(guard));

    act(() => {
      guard.beginAuthentication();
    });
    expect(result.current.status).toBe('authenticating');

    act(() => {
      guard.recordAuthResult('success');
    });
    expect(result.current).toEqual({ status: 'unlocked', failedAttempts: 0 });

    guard.destroy();
  });

  it('stops re-rendering once unmounted', async () => {
    const guard = createSessionGuard(policy);
    await guard.ready;

    const { result, unmount } = renderHook(() => useBiometricSessionGuard(guard));
    unmount();

    act(() => {
      guard.beginAuthentication();
    });

    expect(result.current).toEqual({ status: 'locked', reason: 'initial', failedAttempts: 0 });
    guard.destroy();
  });
});
