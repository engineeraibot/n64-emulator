const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(20000);
  await page.screenshot({ path: 'test-results/tmp-deterministic-capture.png', fullPage: true });
  const out = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rsp: window.rcp?.rspTaskCount,
    rdp: window.rcp?.rdpCommandCount,
    viOrigin: window.mmu?.viRegisters?.[1] & 0x7FFFFF,
    viWidth: window.mmu?.viRegisters?.[2] & 0xFFF,
    viType: window.mmu?.viRegisters?.[0] & 0x3,
    latestVideoTarget: window.rcp?.latestVideoTarget || null,
    targetHistoryTail: (window.rcp?.videoTargetHistory || []).slice(-5),
    selectedFrame: (typeof window.rcp?.getDeterministicVideoTarget === 'function')
      ? window.rcp.getDeterministicVideoTarget(window.mmu.viRegisters[1] & 0x7FFFFF, window.mmu.viRegisters[2] & 0xFFF, window.mmu.viRegisters[0] & 0x3)
      : null,
  }));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
