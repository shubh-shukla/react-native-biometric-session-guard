import type { StorageAdapter } from './types.js';

export interface PersistedLockoutState {
  failedAttempts: number;
  cooldownUntil?: number;
}

const STORAGE_KEY = '@react-native-biometric-session-guard/lockout-state';

export function createInMemoryStorageAdapter(): StorageAdapter {
  const store = new Map<string, string>();
  return {
    async getItem(key) {
      return store.get(key) ?? null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
  };
}

export async function readPersistedLockoutState(
  adapter: StorageAdapter,
): Promise<PersistedLockoutState | undefined> {
  const raw = await adapter.getItem(STORAGE_KEY);
  if (raw === null) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as PersistedLockoutState).failedAttempts !== 'number'
    ) {
      return undefined;
    }
    return parsed as PersistedLockoutState;
  } catch {
    return undefined;
  }
}

export function writePersistedLockoutState(
  adapter: StorageAdapter,
  value: PersistedLockoutState,
): Promise<void> {
  return adapter.setItem(STORAGE_KEY, JSON.stringify(value));
}
