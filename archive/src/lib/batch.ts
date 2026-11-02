import { invoke } from './bridge';
import { useUI } from './ui-store';
import { notifyRun } from './run-feedback';
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
  notifyRun({
    id: 'manual-batch',
    name: '本轮任务',
    status: 'running',
    message: `正在处理 ${devices.length} 台设备，完成后会自动提示。`,
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
    const stopped = useUI.getState().stopping;
    useUI.setState((s) => ({
      running: false,
      stopping: false,
      runs: s.runs.map((r) =>
        r.status === 'queued'
          ? { ...r, status: 'failed', error: '已停止，未执行此手机任务' }
          : r,
      ),
    }));
    const runs = useUI.getState().runs;
    const completed = runs.filter((run) => run.status === 'completed').length;
    const failed = runs.length - completed;
    let status = 'completed';
    if (stopped) status = 'stopped';
    else if (failed > 0) status = completed > 0 ? 'partial' : 'failed';
    notifyRun({
      id: 'manual-batch',
      name: '本轮任务',
      status,
      message: `共 ${runs.length} 台，成功 ${completed} 台，${stopped ? '失败或未执行' : '失败'} ${failed} 台。`,
    });
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
