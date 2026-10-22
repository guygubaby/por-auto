import { z } from 'zod';
import type { Installed } from '@/types';

export const scheduleIntervals = [
  1, 5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 720,
];
export const weekdays = [
  '周日',
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
];
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '请选择执行时间');
export const scheduleTimingSchema = z.discriminatedUnion('repeat', [
  z.object({ repeat: z.enum(['daily', 'weekdays']), time: timeSchema }),
  z.object({
    repeat: z.literal('weekly'),
    time: timeSchema,
    days: z.array(z.number().int().min(0).max(6)).min(1, '请至少选择一天'),
  }),
  z.object({
    repeat: z.literal('monthly'),
    time: timeSchema,
    day: z.number().int().min(1).max(31),
  }),
  z.object({
    repeat: z.literal('interval'),
    minutes: z
      .number()
      .refine((n) => scheduleIntervals.includes(n), '请选择运行间隔'),
  }),
  z.object({
    repeat: z.literal('custom'),
    cron: z
      .string()
      .max(200)
      .regex(/^\S+(?:\s+\S+){4}$/, '原有时间规则无效'),
  }),
]);
export type ScheduleTiming = z.infer<typeof scheduleTimingSchema>;

export function scheduleCron(timing: ScheduleTiming): string {
  if (timing.repeat === 'custom') return timing.cron;
  if (timing.repeat === 'interval') {
    if (timing.minutes === 1) return '* * * * *';
    if (timing.minutes < 60) return `*/${timing.minutes} * * * *`;
    if (timing.minutes === 60) return '0 * * * *';
    return `0 */${timing.minutes / 60} * * *`;
  }
  const [hour, minute] = timing.time.split(':').map(Number);
  const prefix = `${minute} ${hour}`;
  switch (timing.repeat) {
    case 'daily':
      return `${prefix} * * *`;
    case 'weekdays':
      return `${prefix} * * 1-5`;
    case 'weekly':
      return `${prefix} * * ${[...new Set(timing.days)].sort((a, b) => a - b).join(',')}`;
    case 'monthly':
      return `${prefix} ${timing.day} * *`;
  }
}

export function readScheduleTiming(cron: string): ScheduleTiming {
  const normalized = cron.trim().split(/\s+/).join(' ');
  if (normalized.split(' ').length !== 5) return { repeat: 'custom', cron };
  for (const minutes of scheduleIntervals) {
    const timing: ScheduleTiming = { repeat: 'interval', minutes };
    if (scheduleCron(timing) === normalized) return timing;
  }
  const [minute, hour, day, month, week] = normalized.split(' ');
  if (/^\d+$/.test(minute ?? '') && /^\d+$/.test(hour ?? '') && month === '*') {
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    let timing: unknown;
    if (day === '*' && week === '*') timing = { repeat: 'daily', time };
    else if (day === '*' && (week === '1-5' || week === '1,2,3,4,5'))
      timing = { repeat: 'weekdays', time };
    else if (day === '*' && /^[0-6](?:,[0-6])*$/.test(week ?? ''))
      timing = { repeat: 'weekly', time, days: week.split(',').map(Number) };
    else if (/^\d+$/.test(day ?? '') && week === '*')
      timing = { repeat: 'monthly', time, day: Number(day) };
    const parsed = scheduleTimingSchema.safeParse(timing);
    if (parsed.success) return parsed.data;
  }
  return { repeat: 'custom', cron };
}

export function describeSchedule(cron: string): string {
  const timing = readScheduleTiming(cron);
  switch (timing.repeat) {
    case 'daily':
      return `每天 ${timing.time}`;
    case 'weekdays':
      return `周一至周五 ${timing.time}`;
    case 'weekly':
      return `每${timing.days.map((day) => weekdays[day]).join('、')} ${timing.time}`;
    case 'monthly':
      return `每月 ${timing.day} 日 ${timing.time}`;
    case 'interval':
      return timing.minutes < 60
        ? `每 ${timing.minutes} 分钟`
        : `每 ${timing.minutes / 60} 小时`;
    case 'custom':
      return '按原有时间规则执行';
  }
}

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
