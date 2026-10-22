import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { Route } from '@/routes/index';
import { Route as ResultsRoute } from '@/routes/results';
import { ActiveDeviceProgress } from './active-device-progress';
import { invoke } from '@/lib/bridge';
import { useUI } from '@/lib/ui-store';
import type { RunSummary } from '@/types';

vi.mock('@/lib/bridge', () => ({ invoke: vi.fn(), desktop: false }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    to,
    children,
    ...props
  }: PropsWithChildren<{ to: string; className?: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(['store'], {
    installed: [],
    registries: [],
    schemaVersion: 1,
  });
  client.setQueryData(['environment'], {
    ready: true,
    version: '37.0.1',
    platform: 'darwin',
    devices: [{ serial: 'A', model: '设备 A', state: 'device' }],
  });
  client.setQueryData(['active-runs'], {});
  useUI.setState({ running: false, runs: [] });
  return client;
}

it('opens the selected recent record in the existing details dialog and closes it', async () => {
  const client = setup();
  const records: RunSummary[] = ['recent-new', 'recent-old'].map(
    (id, index) => ({
      id,
      workflow_name: '读取姓名',
      workflow_version: '1.0.0',
      serial: 'A',
      timestamp: 1792662000000 - index * 60000,
      status: 'completed',
    }),
  );
  client.setQueryData(['runs'], records);
  vi.mocked(invoke).mockResolvedValue({
    summary: records[1],
    result: null,
    targets: [],
    events: [],
    folder: '/fixture/run',
  });
  const Workspace = Route.options.component;
  if (!Workspace) throw new Error('Workspace route is missing');
  const view = render(
    <QueryClientProvider client={client}>
      <Workspace />
    </QueryClientProvider>,
  );
  try {
    const rows = screen.getAllByRole('button', { name: /读取姓名/ });
    fireEvent.click(rows[1]);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('run_details', { id: 'recent-old' }),
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  } finally {
    view.unmount();
    client.clear();
    vi.clearAllMocks();
  }
});

it('shows live scheduled device steps and updates them with the query cache', async () => {
  const client = setup();
  const progress = {
    serial: 'A',
    workflow_key: 'w',
    scheduled: true,
    step: 2,
    total: 4,
    message: '正在读取当前界面',
  };
  client.setQueryData(['active-runs'], { A: progress });
  const view = render(
    <QueryClientProvider client={client}>
      <ActiveDeviceProgress />
    </QueryClientProvider>,
  );
  try {
    expect(screen.getByText('步骤 2 / 4')).toBeInTheDocument();
    expect(screen.getByText('正在读取当前界面')).toBeInTheDocument();
    client.setQueryData(['active-runs'], {
      A: { ...progress, step: 3, message: '正在确认结果' },
    });
    expect(await screen.findByText('步骤 3 / 4')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: '设备 A执行进度' }),
    ).toHaveAttribute('value', '3');
  } finally {
    view.unmount();
    client.clear();
  }
});

it('shows scheduled progress on the results page without a manual batch', () => {
  const client = setup();
  client.setQueryData(['runs'], []);
  client.setQueryData(['active-runs'], {
    A: {
      serial: 'A',
      scheduled: true,
      step: 2,
      total: 4,
      message: '定时任务正在发送',
    },
  });
  const Results = ResultsRoute.options.component;
  if (!Results) throw new Error('Results route is missing');
  const view = render(
    <QueryClientProvider client={client}>
      <Results />
    </QueryClientProvider>,
  );
  try {
    expect(screen.getByText('定时任务正在发送')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: '设备 A执行进度' }),
    ).toHaveAttribute('value', '2');
  } finally {
    view.unmount();
    client.clear();
  }
});

it('keeps scheduled device B visible alongside a manual batch on device A', () => {
  for (const route of [Route, ResultsRoute]) {
    const client = setup();
    client.setQueryData(['runs'], []);
    useUI.setState({
      running: true,
      runs: [
        {
          serial: 'A',
          model: '设备 A',
          status: 'running',
          error: null,
          result: null,
        },
      ],
    });
    client.setQueryData(['active-runs'], {
      A: {
        serial: 'A',
        scheduled: false,
        step: 1,
        total: 4,
        message: '手动 A 正在执行',
      },
      B: {
        serial: 'B',
        scheduled: true,
        step: 2,
        total: 4,
        message: '定时 B 正在执行',
      },
    });
    const Page = route.options.component;
    if (!Page) throw new Error('Route component is missing');
    const view = render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    );
    try {
      expect(screen.getByText('定时 B 正在执行')).toBeInTheDocument();
      expect(screen.queryByText('手动 A 正在执行')).not.toBeInTheDocument();
      expect(screen.getAllByRole('progressbar')).toHaveLength(1);
      expect(
        screen.getByRole('progressbar', { name: 'B执行进度' }),
      ).toHaveAttribute('value', '2');
    } finally {
      view.unmount();
      client.clear();
      useUI.setState({ running: false, runs: [] });
    }
  }
});
