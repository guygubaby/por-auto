import { isMyGo } from 'mygo-runtime';
import { Desktop, events } from '@/mygo';
import { isBatch, type Store, type Workflow } from '@/types';
const definitions = import.meta.glob('../../workflows/*/workflow.json', {
  eager: true,
  import: 'default',
});
export const workflows = Object.values(definitions) as Workflow[];
export const desktop = isMyGo();
export const officialURL = 'https://github.com/guygubaby/por-auto';
const preview: Store = {
  schemaVersion: 1,
  registries: [
    {
      url: officialURL,
      reference: 'main',
      name: 'Por Auto 官方工作流',
      commit: 'bundled',
      workflows,
    },
  ],
  installed: workflows.map((workflow) => ({
    key: `preview-${workflow.id}`,
    registryUrl: officialURL,
    reference: 'main',
    commit: 'bundled',
    workflow,
    dryRun: true,
    executionMode: 'native',
    input: isBatch(workflow)
      ? {
          message: { type: 'manual', text: '' },
          recipients: { direct: false, groups: true },
          intervalMs: 1000,
        }
      : null,
  })),
};
export async function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (desktop) return (await Desktop.call(command, args)) as T;
  const defaults: Record<string, unknown> = {
    workflow_store: preview,
    check_environment: {
      ready: false,
      devices: [],
      version: '37.0.1',
      platform: 'preview',
    },
    list_runs: [],
    list_schedules: { tasks: [], runningIds: [], error: null },
    vision_provider: null,
    active_runs: {},
    ui_settings: { theme: 'system' },
    update_status: {
      phase: 'idle',
      currentVersion: '0.4.0',
      autoCheck: true,
      downloaded: 0,
    },
  };
  if (Object.hasOwn(defaults, command))
    return structuredClone(defaults[command]) as T;
  throw new Error('请在桌面客户端执行此操作，浏览器仅提供界面预览。');
}
export function subscribe(name: string, listener: (payload: unknown) => void) {
  if (!desktop) return () => {};
  return events.desktopChanged.on((event) => {
    if (event.name === name) listener(event.payload);
  });
}
