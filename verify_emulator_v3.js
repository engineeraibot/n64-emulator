const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => {
    console.log(`BROWSER CONSOLE: ${msg.type().toUpperCase()}: ${msg.text()}`);
  });

  const url = 'file://' + path.resolve('index.html');
  await page.goto(url);

  const romPath = path.resolve('Super Mario 64 (Europe) (En,Fr,De).n64');
  const romBuffer = fs.readFileSync(romPath);

  console.log('Loading ROM...');

  await page.evaluate((buffer) => {
    const uint8 = new Uint8Array(buffer);
    const blob = new Blob([uint8]);
    const file = new File([blob], 'sm64.n64');
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const input = document.getElementById('rom-file');
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, Array.from(romBuffer));

  console.log('ROM loaded, waiting for 15 seconds...');
  await page.waitForTimeout(15000);

  console.log('Taking screenshot...');
  await page.screenshot({ path: 'screenshot_v3.png' });

  await browser.close();
})();
