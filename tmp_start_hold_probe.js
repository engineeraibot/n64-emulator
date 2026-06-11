const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.rcp && (window.rcp.f3dTaskCount || 0) >= 96, { timeout: 70000 }).catch(() => {});

  const before = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rspTaskCount: window.rcp?.rspTaskCount || 0,
    f3dTaskCount: window.rcp?.f3dTaskCount || 0,
    buttons: window.mmu?.buttons || 0
  }));

  await page.evaluate(() => {
    const mmu = window.mmu;
    if (!mmu) return;
    mmu.buttons |= 0x1000;
    mmu.updateController(mmu.buttons, mmu.stickX, mmu.stickY);
  });

  await page.waitForTimeout(1800);

  await page.evaluate(() => {
    const mmu = window.mmu;
    if (!mmu) return;
    mmu.buttons &= ~0x1000;
    mmu.updateController(mmu.buttons, mmu.stickX, mmu.stickY);
  });

  await page.waitForTimeout(4000);

  const after = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rspTaskCount: window.rcp?.rspTaskCount || 0,
    f3dTaskCount: window.rcp?.f3dTaskCount || 0,
    f3dex2TaskCount: window.rcp?.f3dex2TaskCount || 0,
    buttons: window.mmu?.buttons || 0,
    latestVideoTarget: window.rcp?.latestVideoTarget || null,
    viOrigin: window.mmu?.viRegisters?.[1] & 0x7FFFFF,
    viWidth: window.mmu?.viRegisters?.[2] & 0xFFF,
    viType: window.mmu?.viRegisters?.[0] & 0x3
  }));

  await page.screenshot({ path: 'test-results/tmp-after-start-hold.png', fullPage: true });

  console.log(JSON.stringify({ before, after }, null, 2));
  await browser.close();
})();
