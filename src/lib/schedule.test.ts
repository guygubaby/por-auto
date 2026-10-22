import { expect, it } from 'vitest';
import { snapshotChanged } from './schedule';
import type { Installed } from '@/types';
it('compares pinned versions, configuration and rehearsal mode with consistent defaults', () => {
  const a = {
    key: 'a',
    commit: 'sha',
    workflow: { version: '1.0.0' },
  } as Installed;
  expect(
    snapshotChanged(a, {
      ...a,
      input: null,
      hooks: { beforeRun: null, afterRun: null },
      executionMode: 'native',
      dryRun: false,
    }),
  ).toBe(false);
  expect(snapshotChanged(a, { ...a, dryRun: true })).toBe(true);
  expect(snapshotChanged(a, { ...a, executionMode: 'visual' })).toBe(true);
});
