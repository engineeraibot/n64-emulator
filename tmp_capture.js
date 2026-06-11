const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(20000);
  await page.screenshot({ path: 'test-results/live-current-20s.png', fullPage: true });
  const state = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rsp: window.rcp?.rspTaskCount || 0,
    rdp: window.rcp?.rdpCommandCount || 0,
    viOrigin: window.mmu?.viRegisters?.[1] >>> 0,
    viWidth: window.mmu?.viRegisters?.[2] & 0xFFF,
    viType: window.mmu?.viRegisters?.[0] & 0x3,
    ciOrigin: window.rcp?.rspState?.colorImage >>> 0,
    ciWidth: window.rcp?.rspState?.colorImageWidth || 0,
    ciSize: window.rcp?.rspState?.colorImageSize,
  }));
  console.log(JSON.stringify(state, null, 2));
  await browser.close();
})();
