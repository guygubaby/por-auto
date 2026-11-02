import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);
export function formatTime(
  value: number | null | undefined,
  zone = 'Asia/Shanghai',
) {
  if (!value) return '尚未运行';
  try {
    return dayjs(value).tz(zone).format('MM-DD HH:mm:ss');
  } catch {
    return dayjs(value).toISOString();
  }
}
export const statusLabels: Record<string, string> = {
  completed: '已完成',
  partial: '部分完成',
  stopped: '已停止',
  failed: '失败',
  running: '运行中',
  pending: '待处理',
  opening: '正在进入',
  rehearsing: '历史测试中',
  rehearsed: '历史测试完成',
  sent: '已发送',
  uncertain: '结果待核对',
  skipped: '已跳过',
  queued: '排队中',
  interrupted: '已中断',
};
