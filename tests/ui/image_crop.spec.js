// Playwright test for image cropping modal (full user flow)
const { test, expect } = require('@playwright/test');

test('Image cropping modal works and is isolated', async ({ page }) => {
  await page.goto('http://localhost:5000/');
  // Wait for folder list
  await page.waitForSelector('#media-list .media-item.folder-item');
  // Click first folder
  await page.click('#media-list .media-item.folder-item');
  // Wait for images to load
  await page.waitForSelector('#media-list .media-item[data-type="media"]');
  // Right-click first image to open context menu
  const firstImage = page.locator('#media-list .media-item[data-type="media"]');
  await firstImage.first().click({ button: 'right' });
  // Wait for context menu and click the crop action (exact label 'Crop...')
  await page.click('.caption-context-menu-item:text("Crop...")');
  // Modal should appear
  await expect(page.locator('#crop-modal')).toBeVisible();
  // Cropper should be initialized
  await expect(page.locator('.cropper-crop-box')).toBeVisible();
  // Simulate dragging crop box (move by 10px)
  const cropBox = page.locator('.cropper-crop-box');
  const box = await cropBox.boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 15, box.y + 15);
  await page.mouse.up();
  // Click apply
  await page.click('#crop-apply-btn');
  // Modal should close
  await expect(page.locator('#crop-modal')).toBeHidden();
});
