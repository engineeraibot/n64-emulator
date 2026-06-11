const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.rcp && (window.rcp.f3dTaskCount || 0) >= 96, { timeout: 70000 }).catch(() => {});

  const before = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    f3dTaskCount: window.rcp?.f3dTaskCount || 0,
    rspTaskCount: window.rcp?.rspTaskCount || 0,
    controllerDebug: window.mmu?.controllerDebug || null
  }));

  await page.evaluate(() => {
    const mmu = window.mmu;
    mmu.buttons |= 0x1000;
    mmu.updateController(mmu.buttons, 0, 0);
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const mmu = window.mmu;
    mmu.buttons &= ~0x1000;
    mmu.updateController(mmu.buttons, 0, 0);
  });
  await page.waitForTimeout(2500);

  const after = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    f3dTaskCount: window.rcp?.f3dTaskCount || 0,
    rspTaskCount: window.rcp?.rspTaskCount || 0,
    controllerDebug: window.mmu?.controllerDebug || null,
    latestVideoTarget: window.rcp?.latestVideoTarget || null
  }));

  console.log(JSON.stringify({ before, after }, null, 2));
  await browser.close();
})();
