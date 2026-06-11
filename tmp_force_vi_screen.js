const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.rcp, null, { timeout: 15000 });
  await page.evaluate(() => {
    const rcp = window.rcp;
    rcp.getDeterministicVideoTarget = function forceVi(viOrigin, viWidth, viType) {
      return {
        origin: viOrigin & 0x7FFFFF,
        width: viWidth | 0,
        type: viType | 0,
        height: 240,
        source: 'forced-vi'
      };
    };
  });
  await page.waitForTimeout(30000);
  await page.screenshot({ path: 'test-results/tmp-forced-vi-30s.png', fullPage: true });
  const s = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    f3dTaskCount: window.rcp?.f3dTaskCount || 0,
    rspTaskCount: window.rcp?.rspTaskCount || 0,
    viOrigin: window.mmu?.viRegisters?.[1] & 0x7FFFFF,
    viWidth: window.mmu?.viRegisters?.[2] & 0xFFF,
    viType: window.mmu?.viRegisters?.[0] & 0x3
  }));
  console.log(JSON.stringify(s, null, 2));
  await browser.close();
})();
