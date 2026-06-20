import { test, expect } from '@playwright/test';

test.describe('登录页', () => {
    test('页面加载后显示登录表单', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByPlaceholder('用户名')).toBeVisible();
        await expect(page.getByPlaceholder('密码')).toBeVisible();
        await expect(page.getByText('登 录')).toBeVisible();
        await expect(page.getByText('游客模式')).toBeVisible();
    });

    test('空输入登录应报错', async ({ page }) => {
        await page.goto('/');
        await page.getByText('登 录').click();
        await expect(page.getByText('请填写用户名及访问密钥', { exact: false })).toBeVisible({ timeout: 5000 });
    });

    test('错误密码登录应报错', async ({ page }) => {
        await page.goto('/');
        await page.getByPlaceholder('用户名').fill('admin');
        await page.getByPlaceholder('密码').fill('wrongpassword');
        await page.getByText('登 录').click();
        await expect(page.getByText('用户名或密码错误', { exact: false })).toBeVisible({ timeout: 10000 });
    });

    test('游客登录成功进入主应用', async ({ page }) => {
        await page.goto('/');
        await page.getByText('游客模式').click();
        // 验证进入主应用（头部导航出现）
        await expect(page.getByText('退出')).toBeVisible({ timeout: 15000 });
        // 验证角色标签
        await expect(page.getByText('guest', { exact: false })).toBeVisible({ timeout: 5000 });
    });
});

test.describe('管理员登录', () => {
    test('登录成功后显示管理按钮', async ({ page }) => {
        await page.goto('/');
        await page.getByPlaceholder('用户名').fill('admin');
        await page.getByPlaceholder('密码').fill(process.env.TEST_ADMIN_PASSWORD || '');
        await page.getByText('登 录').click();
        // admin 才有的按钮
        await expect(page.getByText('👑 管理')).toBeVisible({ timeout: 15000 });
    });
});
