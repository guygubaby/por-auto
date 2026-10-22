import { test, expect } from '@playwright/test';
test('all pages, configuration and three theme modes work in the browser', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '工作台', exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  const lightBackground = await page
    .locator('body')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.getByRole('link', { name: '跳到主要内容' }).press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(
    page.getByRole('heading', { name: '工作台', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '开始正式运行', exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: 'work/ui-verification-cache/workspace-light.png',
    fullPage: true,
  });
  await page.getByRole('combobox', { name: '主题', exact: true }).click();
  await page.getByRole('option', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('body')).not.toHaveCSS(
    'background-color',
    lightBackground,
  );
  await page.screenshot({
    path: 'work/ui-verification-cache/workspace-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('combobox', { name: '主题', exact: true }).click();
  await page.getByRole('option', { name: '跟随系统', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  for (const name of [
    '运行结果',
    '定时任务',
    '运行记录',
    '工作流商店',
    '设置',
    '使用指引',
  ]) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(
      page.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByText('视觉模型', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '工作台', exact: true }).click();
  await page
    .getByRole('button', { name: '配置 企业微信批量发送消息', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('switch', { name: '预演模式', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page
    .getByRole('button', { name: '配置 企业微信批量发送消息', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: '消息来源', exact: true }).click();
  await page.getByRole('option', { name: 'HTTP 接口', exact: true }).click();
  await dialog.getByRole('combobox', { name: '方法', exact: true }).click();
  await page.getByRole('option', { name: 'POST', exact: true }).click();
  await expect(
    dialog.getByLabel('JSON 请求内容', { exact: false }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(errors).toEqual([]);
});
test('layout stays usable at compact widths', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: '移动导航' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'work/ui-verification-cache/workspace-compact.png',
    fullPage: true,
  });
});
