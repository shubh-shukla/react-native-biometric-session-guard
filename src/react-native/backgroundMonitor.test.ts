import { createReactNativeBackgroundMonitor, type AppStateLike } from './backgroundMonitor.js';

type ChangeHandler = (state: string) => void;

function fakeAppState(initialState: string) {
  const handlers = new Set<ChangeHandler>();

  const appState: AppStateLike = {
    currentState: initialState,
    addEventListener(type, listener) {
      if (type === 'change') {
        handlers.add(listener);
      }
      return { remove: () => handlers.delete(listener) };
    },
  };

  return {
    appState,
    setState(next: string): void {
      appState.currentState = next;
      handlers.forEach((handler) => handler(next));
    },
    listenerCount(): number {
      return handlers.size;
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createReactNativeBackgroundMonitor', () => {
  it('calls notifyBackground() after a sustained departure from active', () => {
    const { appState, setState } = fakeAppState('active');
    const notifyBackground = jest.fn();
    createReactNativeBackgroundMonitor({ notifyBackground }, { appState });

    setState('background');
    jest.advanceTimersByTime(500);

    expect(notifyBackground).toHaveBeenCalledTimes(1);
  });

  it('does not call notifyBackground() for a fast iOS dialog/control-center blip (active -> inactive -> active)', () => {
    const { appState, setState } = fakeAppState('active');
    const notifyBackground = jest.fn();
    createReactNativeBackgroundMonitor({ notifyBackground }, { appState });

    setState('inactive');
    jest.advanceTimersByTime(100);
    setState('active');
    jest.advanceTimersByTime(500);

    expect(notifyBackground).not.toHaveBeenCalled();
  });

  it("does not call notifyBackground() for Android's documented autofill/permission false positive (active -> background -> active)", () => {
    const { appState, setState } = fakeAppState('active');
    const notifyBackground = jest.fn();
    createReactNativeBackgroundMonitor({ notifyBackground }, { appState });

    setState('background');
    jest.advanceTimersByTime(50);
    setState('active');
    jest.advanceTimersByTime(500);

    expect(notifyBackground).not.toHaveBeenCalled();
  });

  it('treats a hop between two non-active states as one continuous departure, not two', () => {
    const { appState, setState } = fakeAppState('active');
    const notifyBackground = jest.fn();
    createReactNativeBackgroundMonitor({ notifyBackground }, { appState });

    setState('inactive');
    jest.advanceTimersByTime(100);
    setState('background');
    jest.advanceTimersByTime(400);

    expect(notifyBackground).toHaveBeenCalledTimes(1);
  });

  it('honors a custom graceMs', () => {
    const { appState, setState } = fakeAppState('active');
    const notifyBackground = jest.fn();
    createReactNativeBackgroundMonitor({ notifyBackground }, { appState, graceMs: 2000 });

    setState('background');
    jest.advanceTimersByTime(500);
    expect(notifyBackground).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1500);
    expect(notifyBackground).toHaveBeenCalledTimes(1);
  });

  it('fires immediately (after the grace period) if constructed while already backgrounded', () => {
    const { appState } = fakeAppState('background');
    const notifyBackground = jest.fn();
    createReactNativeBackgroundMonitor({ notifyBackground }, { appState });

    jest.advanceTimersByTime(500);

    expect(notifyBackground).toHaveBeenCalledTimes(1);
  });

  it('stops watching and cancels a pending grace timer once disposed', () => {
    const { appState, setState, listenerCount } = fakeAppState('active');
    const notifyBackground = jest.fn();
    const dispose = createReactNativeBackgroundMonitor({ notifyBackground }, { appState });

    setState('background');
    dispose();
    jest.advanceTimersByTime(500);

    expect(notifyBackground).not.toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
  });
});
