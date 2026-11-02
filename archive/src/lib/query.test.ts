import { expect, it, vi } from 'vitest';
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryObserver,
  MutationObserver,
} from '@tanstack/react-query';
import { invoke } from './bridge';
import {
  activeQuery,
  environmentQuery,
  queryClient,
  schedulesQuery,
  storeQuery,
} from './query';

vi.mock('./bridge', () => ({ desktop: true, invoke: vi.fn() }));

it('reads local schedule and device progress even without internet access', async () => {
  const client = new QueryClient();
  onlineManager.setOnline(false);
  const active = { A: { step: 2, total: 4, message: '正在确认结果' } };
  const schedules = { tasks: [], runningIds: ['daily'], error: null };
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === 'active_runs' ? active : schedules,
  );
  const pending = Promise.allSettled([
    client.fetchQuery(activeQuery),
    client.fetchQuery(schedulesQuery),
  ]);
  try {
    expect(invoke).toHaveBeenCalledWith('active_runs');
    expect(invoke).toHaveBeenCalledWith('list_schedules');
    expect(await pending).toEqual([
      { status: 'fulfilled', value: active },
      { status: 'fulfilled', value: schedules },
    ]);
  } finally {
    await client.cancelQueries();
    await pending;
    client.clear();
    onlineManager.setOnline(true);
    vi.clearAllMocks();
  }
});

it('keeps local page loading and task actions available while offline', async () => {
  onlineManager.setOnline(false);
  vi.mocked(invoke).mockResolvedValue({ installed: [], registries: [] });
  const pending = Promise.allSettled([
    queryClient.fetchQuery(storeQuery),
    new MutationObserver(queryClient, {
      mutationFn: () => invoke('save_schedule'),
    }).mutate(),
  ]);
  try {
    expect(invoke).toHaveBeenCalledWith('workflow_store');
    await Promise.resolve();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith('save_schedule');
    expect(
      (await pending).every((result) => result.status === 'fulfilled'),
    ).toBe(true);
  } finally {
    onlineManager.setOnline(true);
    await queryClient.resumePausedMutations();
    queryClient.clear();
    await pending;
    vi.clearAllMocks();
  }
});

it('automatically updates device connection and authorization while offline and unfocused', async () => {
  vi.useFakeTimers();
  const environment = {
    ready: true,
    version: '37.0.1',
    platform: 'darwin',
    devices: [],
  };
  const device = { serial: 'phone-a', model: 'Phone A', state: 'device' };
  vi.mocked(invoke)
    .mockResolvedValueOnce(environment)
    .mockResolvedValueOnce({
      ...environment,
      devices: [{ ...device, state: 'unauthorized' }],
    })
    .mockResolvedValueOnce({ ...environment, devices: [device] })
    .mockResolvedValue(environment);
  const client = new QueryClient();
  const observer = new QueryObserver(client, environmentQuery);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(observer.getCurrentResult().data?.devices).toEqual([]);
    focusManager.setFocused(false);
    onlineManager.setOnline(false);

    await vi.advanceTimersByTimeAsync(2000);
    expect(observer.getCurrentResult().data?.devices).toEqual([
      { ...device, state: 'unauthorized' },
    ]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(observer.getCurrentResult().data?.devices).toEqual([device]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(observer.getCurrentResult().data?.devices).toEqual([]);

    unsubscribe();
    const calls = vi.mocked(invoke).mock.calls.length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(invoke).toHaveBeenCalledTimes(calls);
  } finally {
    unsubscribe();
    client.clear();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    vi.useRealTimers();
    vi.clearAllMocks();
  }
});
