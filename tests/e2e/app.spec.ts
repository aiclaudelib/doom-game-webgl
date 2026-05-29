import { expect, test } from '@playwright/test'

test('renders the empty React app', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})
