import type { Installed } from '@/types';
export function snapshotChanged(a: Installed, b: Installed) {
  function comparable(v: Installed) {
    return JSON.stringify({
      key: v.key,
      commit: v.commit,
      version: v.workflow.version,
      input: v.input ?? null,
      hooks: {
        beforeRun: v.hooks?.beforeRun ?? null,
        afterRun: v.hooks?.afterRun ?? null,
      },
      executionMode: v.executionMode ?? 'native',
      dryRun: v.dryRun ?? false,
    });
  }
  return comparable(a) !== comparable(b);
}
