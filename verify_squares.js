const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto('file://' + path.resolve('index.html'));

  const romPath = path.resolve('squaresdemo.n64');
  await page.setInputFiles('#rom-file', romPath);

  console.log('ROM loaded, waiting for emulation...');
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'squares_test_result.png' });
  await browser.close();
})();
