const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(30000);
  const state = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rspTaskCount: window.rcp?.rspTaskCount || 0,
    f3dTaskCount: window.rcp?.f3dTaskCount || 0,
    controllerDebug: window.mmu?.controllerDebug || null,
    latestVideoTarget: window.rcp?.latestVideoTarget || null
  }));
  console.log(JSON.stringify(state, null, 2));
  await browser.close();
})();
