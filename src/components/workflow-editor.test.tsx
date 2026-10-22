import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowEditor } from './workflow-editor';
import { defaultInput, type Installed } from '@/types';
import { invoke } from '@/lib/bridge';

vi.mock('@/lib/bridge', () => ({ invoke: vi.fn(), desktop: false }));

it('configures and saves a batch workflow whose ID has no broadcast substring', async () => {
  const item: Installed = {
    key: 'custom',
    registryUrl: 'https://github.com/example/workflows',
    reference: 'main',
    commit: 'fixture',
    dryRun: true,
    workflow: {
      id: 'daily-report',
      name: 'Daily report',
      version: '1.0.0',
      description: '',
      package: 'com.tencent.wework',
      steps: [{ name: 'Send', action: { type: 'chat_broadcast' } }],
    },
    input: { ...defaultInput(), message: { type: 'manual', text: 'Hello' } },
  };
  vi.mocked(invoke).mockResolvedValue({
    registries: [],
    installed: [item],
    schemaVersion: 1,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkflowEditor item={item} onClose={() => {}} />
    </QueryClientProvider>,
  );
  expect(screen.getByText('消息与接收对象')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      'configure_workflow',
      expect.objectContaining({ key: item.key, input: item.input }),
    ),
  );
});
