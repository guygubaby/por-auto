import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toast } from 'sonner';
import { useUI } from './ui-store';
import { runBatch } from './batch';
import type { RunResult } from '@/types';
vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));
describe('frozen device batches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUI.setState({
      running: false,
      stopping: false,
      runs: [],
      serials: [],
      workflow: '',
    });
  });
  it('keeps four workers, frozen targets and failed-device isolation', async () => {
    let active = 0,
      max = 0;
    const calls: string[] = [];
    const devices = ['A', 'B', 'C', 'D', 'E', 'F'].map((serial) => ({
      serial,
      model: serial,
      state: 'device',
    }));
    await runBatch(devices, 'fixed', async (command, args) => {
      expect(command).toBe('run_workflow');
      expect(args?.workflowKey).toBe('fixed');
      const serial = String(args?.serial);
      calls.push(serial);
      useUI.setState({ serials: ['changed'], workflow: 'changed' });
      useUI.getState().onProgress({
        serial,
        workflow_key: 'fixed',
        scheduled: true,
        step: 1,
        total: 2,
        message: 'scheduled',
      });
      expect(
        useUI.getState().runs.find((r) => r.serial === serial)?.progress,
      ).toBeUndefined();
      active++;
      max = Math.max(max, active);
      await Promise.resolve();
      active--;
      if (serial === 'B') throw Error('USB disconnected');
      return {
        serial,
        error: serial === 'C' ? 'Target missing' : null,
        outputs: {},
      } as RunResult;
    });
    expect(calls).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(max).toBe(4);
    expect(useUI.getState().runs.map((r) => r.status)).toEqual([
      'completed',
      'failed',
      'failed',
      'completed',
      'completed',
      'completed',
    ]);
    expect(useUI.getState().running).toBe(false);
    expect(toast.loading).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(
      '本轮任务部分完成',
      expect.objectContaining({
        id: 'run-manual-batch',
        description: '共 6 台，成功 4 台，失败 2 台。',
      }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('does not run an empty selection or launch a second active batch', async () => {
    let calls = 0;
    useUI.setState({ running: true });
    await runBatch(
      [{ serial: 'A', model: 'A', state: 'device' }],
      'fixed',
      async () => {
        calls++;
        return {} as RunResult;
      },
    );
    expect(calls).toBe(0);
    expect(toast.loading).not.toHaveBeenCalled();
  });

  it('replaces the running message with one completion message for the whole batch', async () => {
    await runBatch(
      [{ serial: 'A', model: 'A', state: 'device' }],
      'fixed',
      async () => ({ error: null, outputs: {} }) as RunResult,
    );
    expect(toast.loading).toHaveBeenCalledWith(
      '本轮任务正在运行',
      expect.objectContaining({ id: 'run-manual-batch', duration: Infinity }),
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      '本轮任务已完成',
      expect.objectContaining({
        id: 'run-manual-batch',
        duration: 6000,
        description: '共 1 台，成功 1 台，失败 0 台。',
      }),
    );
  });

  it('reports a stopped batch instead of showing a success message', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const devices = ['A', 'B', 'C', 'D', 'E'].map((serial) => ({
      serial,
      model: serial,
      state: 'device',
    }));
    const batch = runBatch(devices, 'fixed', async () => {
      await pending;
      return { error: null, outputs: {} } as RunResult;
    });
    useUI.setState({ stopping: true });
    release();
    await batch;
    expect(toast.warning).toHaveBeenCalledWith(
      '本轮任务已停止',
      expect.objectContaining({
        description: '共 5 台，成功 4 台，失败或未执行 1 台。',
      }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
