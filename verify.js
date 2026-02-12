const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const romPath = path.resolve('Super Mario 64 (Europe) (En,Fr,De).n64');
  const romBase64 = fs.readFileSync(romPath).toString('base64');

  await page.goto('file://' + path.resolve('index.html'));

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await page.evaluate((base64) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    window.mmu.memory.loadRom(bytes.buffer);
    window.cpu.run();
  }, romBase64);

  // Run for 30 seconds to see if it reaches something
  await page.waitForTimeout(30000);

  await page.screenshot({ path: 'screenshot.png' });
  await browser.close();
})();
