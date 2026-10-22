import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScheduleEditor } from '@/routes/schedules';
import { invoke } from '@/lib/bridge';
import type { Installed, Schedule } from '@/types';

vi.mock('@/lib/bridge', () => ({ invoke: vi.fn(), desktop: true }));

const workflow: Installed = {
  key: 'wecom-open',
  registryUrl: 'https://github.com/example/workflows',
  reference: 'main',
  commit: 'fixture',
  workflow: {
    id: 'wecom-open',
    name: '打开企业微信',
    version: '1.0.0',
    description: '',
    package: 'com.tencent.wework',
    steps: [],
  },
  dryRun: true,
};

function renderEditor(item: Schedule | null = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(['store'], {
    schemaVersion: 1,
    registries: [],
    installed: [workflow],
  });
  client.setQueryData(['environment'], {
    ready: true,
    devices: [{ serial: 'phone-a', model: 'Phone A', state: 'device' }],
  });
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === 'preview_cron'
      ? [1792746000000, 1792832400000, 1792918800000]
      : { tasks: [], runningIds: [] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <ScheduleEditor item={item} onClose={() => {}} />
    </QueryClientProvider>,
  );
  return () => {
    view.unmount();
    client.clear();
    vi.clearAllMocks();
  };
}

it('creates a weekly task by clicking days and time, with Shanghai hidden and an automatic preview', async () => {
  const cleanup = renderEditor();
  try {
    expect(screen.queryByText('Cron 表达式')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('时区')).not.toBeInTheDocument();
    expect(screen.queryByText('Asia/Shanghai')).not.toBeInTheDocument();
    await screen.findByText('接下来三次执行时间');
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('preview_cron', {
        cron: '0 9 * * *',
        timezone: 'Asia/Shanghai',
      }),
    );
    fireEvent.change(screen.getByLabelText('任务名称'), {
      target: { value: '每周报告' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Phone A/ }));
    fireEvent.click(screen.getByRole('radio', { name: '每周' }));
    fireEvent.change(screen.getByLabelText('执行时间'), {
      target: { value: '18:30' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '周一' }));
    fireEvent.click(screen.getByRole('button', { name: '保存任务' }));
    await screen.findByText('请至少选择一天');
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => command === 'save_schedule'),
    ).toBe(false);
    for (const day of ['周一', '周三', '周五'])
      fireEvent.click(screen.getByRole('checkbox', { name: day }));
    fireEvent.click(screen.getByRole('button', { name: '保存任务' }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('save_schedule', {
        input: expect.objectContaining({
          name: '每周报告',
          cron: '30 18 * * 1,3,5',
          timezone: 'Asia/Shanghai',
          serials: ['phone-a'],
        }),
      }),
    );
  } finally {
    cleanup();
  }
});

it('keeps an existing special rule and timezone unchanged when saving other task details', async () => {
  const cleanup = renderEditor({
    id: 'existing',
    name: '已有任务',
    cron: '0 9 1 * 1',
    timezone: 'Asia/Tokyo',
    enabled: true,
    serials: ['phone-a'],
    snapshot: workflow,
  } as Schedule);
  try {
    expect(screen.getByRole('radio', { name: '原有规则' })).toBeChecked();
    expect(screen.queryByLabelText('时区')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存任务' }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('save_schedule', {
        input: expect.objectContaining({
          id: 'existing',
          cron: '0 9 1 * 1',
          timezone: 'Asia/Tokyo',
        }),
      }),
    );
  } finally {
    cleanup();
  }
});
