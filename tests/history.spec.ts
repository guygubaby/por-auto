import { test, expect } from '@playwright/test';

test('large history stays paged, searchable and linked to the URL', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const records = Array.from({ length: 1000 }, (_, index) => ({
      id: String(1_000_000 + index),
      workflow_name: `验收流程-${String(index).padStart(4, '0')}`,
      workflow_version: '1.0.0',
      serial: 'fixture-device',
      timestamp: 1_790_000_000_000 + index,
      status: 'completed',
      dry_run: true,
    }));
    Object.assign(window, {
      mygo: {
        on: () => () => {},
        call: async (
          _method: string,
          command: string,
          args: Record<string, unknown> = {},
        ) => {
          if (command === 'ui_settings') return { theme: 'light' };
          if (command === 'list_runs') return records;
          if (command === 'run_details')
            return {
              summary: records.find((record) => record.id === args.id),
              result: { outputs: {}, screenshot: null, warning: null },
              targets: Array.from({ length: 1000 }, (_, index) => ({
                title: `对象-${String(index).padStart(4, '0')}`,
                status: 'rehearsed',
                error: null,
              })),
              events: Array.from({ length: 500 }, (_, index) => ({
                timestamp: 1_790_000_000_000 + index,
                message: `步骤-${String(index).padStart(4, '0')}`,
              })),
              folder: '/tmp/disposable-history-fixture',
            };
          if (command === 'active_runs') return {};
          if (command === 'check_environment')
            return {
              ready: true,
              devices: [],
              version: 'fixture',
              platform: 'fixture',
            };
          throw new Error(`Unexpected fixture call: ${command}`);
        },
      },
    });
  });
  await page.goto('/#/history');
  await expect(
    page.getByRole('heading', { name: '运行记录', exact: true }),
  ).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(50);
  await expect(page.locator('tbody tr').first()).toContainText('验收流程-0000');
  await page
    .getByRole('navigation', { name: '运行记录分页' })
    .getByRole('button', { name: '下一页' })
    .click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('tbody tr').first()).toContainText('验收流程-0050');
  await page.reload();
  await expect(page.locator('tbody tr').first()).toContainText('验收流程-0050');
  await page
    .getByRole('textbox', { name: '搜索运行记录' })
    .fill('验收流程-0999');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr').first()).toContainText('验收流程-0999');
  await page
    .getByRole('textbox', { name: '搜索运行记录' })
    .fill('不存在的流程');
  await expect(
    page.getByText('没有匹配的运行记录', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await page.getByRole('button', { name: '详情', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('list', { name: '接收对象结果' }).getByRole('listitem'),
  ).toHaveCount(50);
  await dialog
    .getByRole('navigation', { name: '接收对象分页' })
    .getByRole('button', { name: '下一页' })
    .click();
  await expect(dialog.getByText('对象-0050', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('list', { name: '执行日志列表' })).toHaveCount(
    0,
  );
  await dialog.locator('summary').filter({ hasText: '执行日志' }).click();
  await expect(
    dialog.getByRole('list', { name: '执行日志列表' }).getByRole('listitem'),
  ).toHaveCount(50);
  await dialog
    .getByRole('navigation', { name: '执行日志分页' })
    .getByRole('button', { name: '下一页' })
    .click();
  await expect(
    dialog.getByRole('list', { name: '执行日志列表' }),
  ).toContainText('步骤-0050');
});
