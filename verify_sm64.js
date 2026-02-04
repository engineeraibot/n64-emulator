const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', msg => {
      const text = msg.text();
      // Log more stuff to see what's happening
      if (text.includes('G_SETCIMG') || text.includes('G_FILLRECT') || text.includes('DrawTriangle') || text.includes('RDP Command') || text.includes('PC:')) {
           console.log('PAGE LOG:', text);
      } else if (text.includes('Completed') || text.includes('Triggered') || text.includes('IGNORING') || text.includes('vector area')) {
           console.log('PAGE LOG:', text);
      }
  });
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto('file://' + path.resolve('index.html'));

  const romPath = path.resolve('Super Mario 64 (Europe) (En,Fr,De).n64');
  await page.setInputFiles('#rom-file', romPath);

  console.log('ROM loaded, waiting for emulation...');
  await page.waitForTimeout(30000); // Wait 30 seconds

  await page.screenshot({ path: 'sm64_test_result.png' });
  await browser.close();
})();
