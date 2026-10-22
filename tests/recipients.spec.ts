import { test, expect } from '@playwright/test';

test('recipient categories replace name selection and save formal execution explicitly', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let item = {
      key: 'disposable-recipient-fixture',
      registryUrl: 'https://example.invalid/fixtures',
      reference: 'main',
      commit: 'fixture',
      workflow: {
        schemaVersion: 1,
        minEngine: 3,
        id: 'wecom-broadcast',
        name: '企业微信批量发送消息',
        version: '1.0.0',
        package: 'com.tencent.wework',
        description: 'fixture',
        steps: [
          {
            id: 'batch',
            name: '批量消息',
            action: { type: 'chat_broadcast' },
          },
        ],
      },
      input: {
        message: { type: 'manual', text: '验收消息' },
        recipients: {
          scope: 'groups',
          mode: 'selected',
          names: ['旧版测试对象'],
        },
        intervalMs: 1000,
      },
      dryRun: false,
      executionMode: 'visual',
    } as Record<string, unknown>;
    const saves: Record<string, unknown>[] = [];
    Object.assign(window, {
      recipientFixtureSaves: saves,
      mygo: {
        on: () => () => {},
        call: async (
          _method: string,
          command: string,
          args: Record<string, unknown> = {},
        ) => {
          if (command === 'ui_settings') return { theme: 'light' };
          if (command === 'workflow_store')
            return { schemaVersion: 1, registries: [], installed: [item] };
          if (command === 'configure_workflow') {
            saves.push(structuredClone(args));
            item = {
              ...item,
              input: args.input,
              dryRun: args.dryRun,
              hooks: args.hooks,
              executionMode: args.executionMode,
            };
            return { schemaVersion: 1, registries: [], installed: [item] };
          }
          if (command === 'list_runs') return [];
          if (command === 'active_runs') return {};
          if (command === 'check_environment')
            return {
              ready: true,
              devices: [],
              platform: 'fixture',
              version: 'fixture',
            };
          throw Error(`Unexpected recipient fixture call: ${command}`);
        },
      },
    });
  });
  await page.goto('/#/');
  await page
    .getByRole('button', { name: '配置 企业微信批量发送消息', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('switch', { name: '预演模式', exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('checkbox', { name: /^全部群聊/ }),
  ).toBeChecked();
  await expect(
    dialog.getByRole('checkbox', { name: /^全部单聊/ }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole('textbox', { name: '完整会话名称' }),
  ).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '读取会话' })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: '接收对象' })).toHaveCount(
    0,
  );
  await dialog.getByRole('checkbox', { name: /^全部单聊/ }).press('Space');
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  let saved = await page.evaluate(
    () =>
      (
        window as unknown as {
          recipientFixtureSaves: {
            input: { recipients: unknown };
            dryRun: boolean;
          }[];
        }
      ).recipientFixtureSaves,
  );
  expect(saved).toHaveLength(1);
  expect(saved[0].input.recipients).toEqual({ groups: true, direct: true });
  expect(saved[0].dryRun).toBe(false);
  await page
    .getByRole('button', { name: '配置 企业微信批量发送消息', exact: true })
    .click();
  await dialog.getByRole('checkbox', { name: /^全部群聊/ }).uncheck();
  await dialog.getByRole('checkbox', { name: /^全部单聊/ }).uncheck();
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(
    page.getByText('至少选择全部单聊或全部群聊', { exact: true }),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  saved = await page.evaluate(
    () =>
      (
        window as unknown as {
          recipientFixtureSaves: {
            input: { recipients: unknown };
            dryRun: boolean;
          }[];
        }
      ).recipientFixtureSaves,
  );
  expect(saved).toHaveLength(1);
  await dialog.getByRole('checkbox', { name: /^全部单聊/ }).check();
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('全部单聊', { exact: true })).toBeVisible();
});
