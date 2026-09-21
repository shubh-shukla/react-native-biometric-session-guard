import { useSyncExternalStore } from 'react';
import type { GuardState, SessionGuard } from '../core/index.js';

export function useBiometricSessionGuard(
  guard: Pick<SessionGuard, 'subscribe' | 'getState'>,
): GuardState {
  return useSyncExternalStore(guard.subscribe, guard.getState);
}
