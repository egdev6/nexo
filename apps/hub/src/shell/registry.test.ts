import { beforeEach, expect, it, vi } from 'vitest';
import { subscribeRegistry } from './registry';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: mocks.isTauri, invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.isTauri.mockReturnValue(true);
});

it('subscribes before fetching so an event cannot be lost during the initial snapshot', async () => {
  const stop = vi.fn();
  let onEvent: ((event: { payload: { revision: number; apps: [] } }) => void) | undefined;
  let reply: ((value: { revision: number; apps: [] }) => void) | undefined;
  mocks.listen.mockImplementation(async (_name, callback) => {
    onEvent = callback;
    return stop;
  });
  mocks.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const revisions: number[] = [];
  const pending = subscribeRegistry((snapshot) => revisions.push(snapshot.revision));
  await vi.waitFor(() => expect(reply).toBeTypeOf('function'));
  onEvent!({ payload: { revision: 2, apps: [] } });
  reply!({ revision: 1, apps: [] });
  const unlisten = await pending;
  await vi.waitFor(() => expect(revisions).toEqual([2, 1]));
  expect(mocks.listen).toHaveBeenCalledBefore(mocks.invoke);
  unlisten();
  expect(stop).toHaveBeenCalledOnce();
});

it('returns cleanup even when the initial snapshot never resolves', async () => {
  const stop = vi.fn();
  mocks.listen.mockResolvedValue(stop);
  mocks.invoke.mockReturnValue(new Promise(() => {}));
  let cleanup: (() => void) | undefined;
  void subscribeRegistry(() => {}).then((value) => {
    cleanup = value;
  });
  await vi.waitFor(() => expect(cleanup).toBeTypeOf('function'));
  cleanup!();
  expect(stop).toHaveBeenCalledOnce();
});

it('unsubscribes when the initial snapshot fails', async () => {
  const stop = vi.fn();
  mocks.listen.mockResolvedValue(stop);
  mocks.invoke.mockRejectedValue(new Error('unavailable'));
  const onError = vi.fn();
  await subscribeRegistry(() => {}, onError);
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  expect(onError).toHaveBeenCalledOnce();
});

it('does not use the bridge in a browser preview', async () => {
  mocks.isTauri.mockReturnValue(false);
  const stop = await subscribeRegistry(() => {});
  stop();
  expect(mocks.listen).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
