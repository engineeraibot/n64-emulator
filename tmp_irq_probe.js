const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.rcp && (window.rcp.f3dTaskCount || 0) >= 96, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const s = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    f3dTaskCount: window.rcp?.f3dTaskCount || 0,
    rspTaskCount: window.rcp?.rspTaskCount || 0,
    viRegs: Array.from(window.mmu?.viRegisters || []),
    miRegs: Array.from(window.mmu?.miRegisters || []),
    siRegs: Array.from(window.mmu?.siRegisters || []),
    piRegs: Array.from(window.mmu?.piRegisters || []),
    aiRegs: Array.from(window.mmu?.aiRegisters || []),
    viNextInterrupt: window.mmu?.viNextInterrupt || 0,
    siBusyUntil: window.mmu?.siBusyUntil || 0,
    aiBusyUntil: window.mmu?.aiBusyUntil || 0,
    piBusyUntil: window.mmu?.piBusyUntil || 0,
    cp0Cause: (window.cpu?.cp0Registers?.[13] || 0n).toString(),
    cp0Status: (window.cpu?.cp0Registers?.[12] || 0n).toString(),
    controllerDebug: window.mmu?.controllerDebug || null
  }));
  console.log(JSON.stringify(s, null, 2));
  await browser.close();
})();
