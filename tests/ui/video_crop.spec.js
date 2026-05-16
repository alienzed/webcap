// Playwright test for video cropping overlay (full user flow)
const { test, expect } = require('@playwright/test');

test('Video cropping overlay works and is isolated', async ({ page }) => {
  await page.goto('http://localhost:5000/');
  // Navigate into zero-two-dance/wantest/src_videos
  const folderPath = ['zero-two-dance', 'wantest', 'src_videos'];
  for (const folder of folderPath) {
    await page.waitForSelector(`#media-list .media-item.folder-item`);
    // Find the folder by text
    const folderEl = await page.locator(`#media-list .media-item.folder-item`).filter({ hasText: folder }).first();
    await folderEl.click();
  }
  // Wait for media items to load
  await page.waitForSelector('#media-list .media-item[data-type="media"]');
  // Find the first video file (by icon or extension in label)
  const mediaItems = await page.$$('#media-list .media-item[data-type="media"]');
  let videoItem = null;
  for (const item of mediaItems) {
    const text = await item.textContent();
    if (/🎬|\.mp4|\.webm|\.mov|\.avi|\.mkv|\.ogg|\.m4v/i.test(text)) {
      videoItem = item;
      break;
    }
  }
  if (!videoItem) throw new Error('No video file found in test folder');
  // Right-click video item to open context menu
  await videoItem.click({ button: 'right' });
  // Wait for context menu and click the crop/extract frame action (label 'Crop', 'Extract Frame', or 'Clip...')
  let found = false;
  for (const label of ['Crop', 'Extract Frame', 'Clip...']) {
    const btn = await page.$(`.caption-context-menu-item:text(\"${label}\")`);
    if (btn) {
      await btn.click();
      found = true;
      break;
    }
  }
  if (!found) throw new Error('No video crop/extract frame action found in context menu');
  // Overlay cropper should appear
  await expect(page.locator('#video-clip-crop-image')).toBeVisible();
  await expect(page.locator('.cropper-crop-box')).toBeVisible();
  // Simulate dragging crop box (move by 10px)
  const cropBox = page.locator('.cropper-crop-box');
  const box = await cropBox.boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 15, box.y + 15);
  await page.mouse.up();
  // Click apply
  await page.click('#video-clip-crop-apply-btn');
  // Overlay should disappear
  await expect(page.locator('#video-clip-crop-image')).toBeHidden();
});
