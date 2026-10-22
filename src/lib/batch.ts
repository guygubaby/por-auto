import { invoke } from './bridge';
import { useUI } from './ui-store';
import type { Device, RunResult } from '@/types';
export async function runBatch(
  devices: Device[],
  workflowKey: string,
  run = invoke<RunResult>,
): Promise<void> {
  const initial = useUI.getState();
  if (initial.running || devices.length === 0) return;
  useUI.setState({
    running: true,
    stopping: false,
    runWorkflowKey: workflowKey,
    runs: devices.map((d) => ({
      ...d,
      status: 'queued',
      result: null,
      error: null,
    })),
  });
  let cursor = 0;
  try {
    await Promise.all(
      Array.from({ length: Math.min(4, devices.length) }, async () => {
        while (cursor < devices.length && !useUI.getState().stopping) {
          const device = devices[cursor++];
          useUI.setState((s) => ({
            runs: s.runs.map((r) =>
              r.serial === device.serial ? { ...r, status: 'running' } : r,
            ),
          }));
          try {
            const result = await run('run_workflow', {
              serial: device.serial,
              workflowKey,
            });
            useUI.setState((s) => ({
              runs: s.runs.map((r) =>
                r.serial === device.serial
                  ? {
                      ...r,
                      status: result.error ? 'failed' : 'completed',
                      result,
                      error: result.error,
                    }
                  : r,
              ),
            }));
          } catch (error) {
            useUI.setState((s) => ({
              runs: s.runs.map((r) =>
                r.serial === device.serial
                  ? { ...r, status: 'failed', error: String(error) }
                  : r,
              ),
            }));
          }
        }
      }),
    );
  } finally {
    useUI.setState((s) => ({
      running: false,
      stopping: false,
      runs: s.runs.map((r) =>
        r.status === 'queued'
          ? { ...r, status: 'failed', error: '已停止，未执行此手机任务' }
          : r,
      ),
    }));
  }
}
export async function stopBatch() {
  const state = useUI.getState();
  if (!state.running || state.stopping) return;
  useUI.setState({ stopping: true });
  try {
    await invoke('cancel_device_tasks', {
      serials: state.runs
        .filter((r) => ['queued', 'running'].includes(r.status))
        .map((r) => r.serial),
    });
  } catch (e) {
    useUI.setState({ stopping: false });
    throw e;
  }
}
