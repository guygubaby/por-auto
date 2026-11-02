import { expect, it } from 'vitest';
import {
  describeSchedule,
  readScheduleTiming,
  scheduleCron,
  scheduleIntervals,
  scheduleTimingSchema,
  snapshotChanged,
} from './schedule';
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

it('converts simple schedule choices to five-field rules and restores them for editing', () => {
  const cases = [
    ['0 9 * * *', { repeat: 'daily', time: '09:00' }],
    ['5 18 * * 1-5', { repeat: 'weekdays', time: '18:05' }],
    ['30 8 * * 0,1,3', { repeat: 'weekly', time: '08:30', days: [0, 1, 3] }],
    ['0 0 31 * *', { repeat: 'monthly', time: '00:00', day: 31 }],
  ] as const;
  for (const [cron, timing] of cases) {
    expect(readScheduleTiming(cron)).toEqual(timing);
    expect(scheduleCron(scheduleTimingSchema.parse(timing))).toBe(cron);
  }
  expect(describeSchedule('0 9 * * *')).toBe('每天 09:00');
  expect(describeSchedule('5 18 * * 1-5')).toBe('周一至周五 18:05');
  expect(describeSchedule('30 8 * * 0,1,3')).toBe('每周日、周一、周三 08:30');
  expect(describeSchedule('0 0 31 * *')).toBe('每月 31 日 00:00');
  for (const minutes of scheduleIntervals) {
    const timing = { repeat: 'interval', minutes } as const;
    expect(readScheduleTiming(scheduleCron(timing))).toEqual(timing);
  }
  expect(scheduleCron({ repeat: 'interval', minutes: 30 })).toBe(
    '*/30 * * * *',
  );
  expect(scheduleCron({ repeat: 'interval', minutes: 120 })).toBe(
    '0 */2 * * *',
  );
});

it('preserves existing complex rules and rejects incomplete or misleading new choices', () => {
  for (const cron of ['0 9 1 * 1', '0 9 * JAN MON', '0 9,18 * * *']) {
    const timing = readScheduleTiming(cron);
    expect(timing).toEqual({ repeat: 'custom', cron });
    expect(scheduleCron(timing)).toBe(cron);
  }
  for (const timing of [
    { repeat: 'daily', time: '' },
    { repeat: 'daily', time: '24:00' },
    { repeat: 'weekly', time: '09:00', days: [] },
    { repeat: 'monthly', time: '09:00', day: 32 },
    { repeat: 'interval', minutes: 7 },
  ])
    expect(scheduleTimingSchema.safeParse(timing).success).toBe(false);
});
