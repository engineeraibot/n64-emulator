const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto('file://' + path.resolve('index.html'));

  const romPath = path.resolve('Super Mario 64 (Europe) (En,Fr,De).n64');
  await page.setInputFiles('#rom-file', romPath);

  console.log('ROM loaded, waiting for emulation...');
  await page.waitForTimeout(20000); // Wait 20 seconds for better results

  await page.screenshot({ path: 'sm64_test_result.png' });
  await browser.close();
})();
