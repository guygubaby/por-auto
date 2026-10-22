import { describe, it, expect, beforeEach } from 'vitest';
import { useUI } from './ui-store';
import { runBatch } from './batch';
import type { RunResult } from '@/types';
describe('frozen device batches', () => {
  beforeEach(() =>
    useUI.setState({
      running: false,
      stopping: false,
      runs: [],
      serials: [],
      workflow: '',
    }),
  );
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
  });
});
