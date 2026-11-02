import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunProgress } from './common';
import type { DeviceRun } from '@/types';

it('waits for actual progress and marks only completed runs as full', () => {
  const run: DeviceRun = {
    serial: 'A',
    model: 'Phone A',
    status: 'running',
    result: null,
    error: null,
  };
  const { rerender } = render(<RunProgress run={run} />);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  const progressed = {
    ...run,
    progress: {
      serial: 'A',
      workflow_key: 'w',
      scheduled: false,
      step: 2,
      total: 4,
      message: '正在读取',
    },
  };
  rerender(<RunProgress run={progressed} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2');
  expect(screen.getByText('步骤 2 / 4')).toBeInTheDocument();
  expect(screen.getByText('50%')).toBeInTheDocument();
  rerender(<RunProgress run={{ ...progressed, status: 'failed' }} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2');
  expect(screen.getByText('步骤 2 / 4')).toBeInTheDocument();
  rerender(<RunProgress run={{ ...progressed, status: 'completed' }} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '4');
  expect(screen.getByText('步骤 4 / 4')).toBeInTheDocument();
  expect(screen.getByText('100%')).toBeInTheDocument();
});
