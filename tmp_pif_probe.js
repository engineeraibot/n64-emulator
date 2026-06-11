const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(15000);
  const state = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rspTaskCount: window.rcp?.rspTaskCount || 0,
    f3dTaskCount: window.rcp?.f3dTaskCount || 0,
    controllerDebug: window.mmu?.controllerDebug || null,
    siRegs: Array.from(window.mmu?.siRegisters || []),
    pifCmd: window.mmu?.pifRam?.[0x3F] ?? null
  }));
  console.log(JSON.stringify(state, null, 2));
  await browser.close();
})();
