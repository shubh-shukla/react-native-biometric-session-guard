export type LockReason = 'initial' | 'idle' | 'background' | 'retry' | 'cooldown-expired';

export type AuthOutcome = 'success' | 'failure' | 'cancelled';

export interface UnlockedState {
  status: 'unlocked';
  failedAttempts: number;
}

export interface LockedState {
  status: 'locked';
  reason: LockReason;
  failedAttempts: number;
}

export interface AuthenticatingState {
  status: 'authenticating';
  failedAttempts: number;
}

export interface CooldownState {
  status: 'cooldown';
  failedAttempts: number;
  cooldownUntil: number;
}

export type GuardState = UnlockedState | LockedState | AuthenticatingState | CooldownState;

export type GuardEvent =
  | { type: 'ACTIVITY' }
  | { type: 'IDLE_TIMEOUT' }
  | { type: 'APP_BACKGROUNDED' }
  | { type: 'BEGIN_AUTH' }
  | { type: 'AUTH_RESULT'; outcome: AuthOutcome }
  | { type: 'COOLDOWN_EXPIRED' }
  | { type: 'RESET' };

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface SessionGuardPolicy {
  idleMinutes: number;
  lockOnBackground: boolean;
  maxFailedAttempts: number;
  cooldownMinutes: number;
  backgroundGraceMs?: number;
  storageAdapter?: StorageAdapter;
}
