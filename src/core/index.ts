export { createSessionGuard } from './guard.js';
export type { SessionGuard } from './guard.js';
export { createInMemoryStorageAdapter } from './storage.js';
export type {
  AuthOutcome,
  GuardState,
  LockReason,
  SessionGuardPolicy,
  StorageAdapter,
  UnlockedState,
  LockedState,
  AuthenticatingState,
  CooldownState,
} from './types.js';
