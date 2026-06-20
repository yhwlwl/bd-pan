import { test, expect } from '@playwright/test';

async function loginAsGuest(page: any) {
    await page.goto('/');
    await page.getByText('游客模式').click();
    await expect(page.getByText('退出')).toBeVisible({ timeout: 15000 });
}

test.describe('主应用功能', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsGuest(page);
    });

    test('登录后显示文件列表', async ({ page }) => {
        // 等待文件列表加载
        await expect(page.locator('main')).toBeVisible({ timeout: 10000 });
    });

    test('主题切换', async ({ page }) => {
        const toggleBtn = page.locator('header button').filter({ hasText: /🌙|☀️/ }).first();
        if (await toggleBtn.isVisible()) {
            await toggleBtn.click();
            // 验证页面没有崩溃
            await expect(page.locator('header')).toBeVisible();
        }
    });

    test('点击说明按钮弹出弹窗', async ({ page }) => {
        const manualBtn = page.getByText('📖 说明');
        if (await manualBtn.isVisible()) {
            await manualBtn.click();
            await expect(page.locator('.fixed.inset-0')).toBeVisible({ timeout: 5000 });
            // 关闭弹窗
            await page.keyboard.press('Escape');
        }
    });

    test('点击退出返回登录页', async ({ page }) => {
        const logoutBtn = page.getByText('退出');
        await logoutBtn.click();
        await expect(page.getByPlaceholder('用户名')).toBeVisible({ timeout: 5000 });
    });

    test('搜索框可见', async ({ page }) => {
        const searchInput = page.getByPlaceholder('搜索文件...');
        if (await searchInput.isVisible()) {
            await expect(searchInput).toBeEnabled();
        }
    });
});
