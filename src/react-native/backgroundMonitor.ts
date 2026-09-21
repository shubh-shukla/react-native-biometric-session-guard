import type { SessionGuard } from '../core/index.js';

/**
 * A structural stand-in for react-native's AppState, kept deliberately
 * decoupled from RN's own AppState type - which is shaped differently
 * between legacy and New Architecture codegen and shifts across RN
 * versions. The real AppState export satisfies this shape at runtime
 * regardless of how its own type is expressed internally.
 */
export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface AppStateLike {
  currentState: string;
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}

export interface BackgroundMonitorOptions {
  appState: AppStateLike;
  /**
   * How long the app must stay away from "active" before it's treated as a
   * genuine backgrounding. Dialogs, permission prompts, and Android's own
   * autofill-picker false positive all bounce back to "active" within a
   * frame or two; a real app switch or device lock does not.
   */
  graceMs?: number;
}

const DEFAULT_GRACE_MS = 500;

export function createReactNativeBackgroundMonitor(
  guard: Pick<SessionGuard, 'notifyBackground'>,
  { appState, graceMs = DEFAULT_GRACE_MS }: BackgroundMonitorOptions,
): () => void {
  let graceTimer: ReturnType<typeof setTimeout> | undefined;

  const clearGraceTimer = (): void => {
    if (graceTimer !== undefined) {
      clearTimeout(graceTimer);
      graceTimer = undefined;
    }
  };

  const handleChange = (nextState: string): void => {
    if (nextState === 'active') {
      clearGraceTimer();
      return;
    }

    if (graceTimer !== undefined) {
      return;
    }

    graceTimer = setTimeout(() => {
      graceTimer = undefined;
      guard.notifyBackground();
    }, graceMs);
  };

  if (appState.currentState !== 'active') {
    handleChange(appState.currentState);
  }

  const subscription = appState.addEventListener('change', handleChange);

  return () => {
    clearGraceTimer();
    subscription.remove();
  };
}
