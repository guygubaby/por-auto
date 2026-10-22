import { expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { notifyRun } from './run-feedback';

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

it('updates one scheduled-run notification and ignores ordinary refresh events', () => {
  for (const value of [null, {}, { status: 'completed' }]) notifyRun(value);
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.loading).not.toHaveBeenCalled();
  notifyRun({
    id: 'batch-id',
    name: '每日报告',
    status: 'running',
    message: '正在处理 2 台设备',
  });
  notifyRun({
    id: 'batch-id',
    name: '每日报告',
    status: 'failed',
    message: '设备已断开',
  });
  expect(toast.loading).toHaveBeenCalledWith(
    '每日报告正在运行',
    expect.objectContaining({ id: 'run-batch-id', duration: Infinity }),
  );
  expect(toast.error).toHaveBeenCalledWith(
    '每日报告执行失败',
    expect.objectContaining({
      id: 'run-batch-id',
      description: '设备已断开',
      duration: 6000,
    }),
  );
  expect(toast.success).not.toHaveBeenCalled();
});
