import { z } from 'zod';
import { toast } from 'sonner';

const runFeedbackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['running', 'completed', 'partial', 'failed', 'stopped']),
  message: z.string(),
});

export function notifyRun(value: unknown) {
  const parsed = runFeedbackSchema.safeParse(value);
  if (!parsed.success) return;
  const { id, name, status, message } = parsed.data;
  const feedback = {
    running: { show: toast.loading, label: '正在运行' },
    completed: { show: toast.success, label: '已完成' },
    partial: { show: toast.warning, label: '部分完成' },
    failed: { show: toast.error, label: '执行失败' },
    stopped: { show: toast.warning, label: '已停止' },
  }[status];
  feedback.show(`${name}${feedback.label}`, {
    id: `run-${id}`,
    description: message,
    duration: status === 'running' ? Infinity : 6000,
  });
}
