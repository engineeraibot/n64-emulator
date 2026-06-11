const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(45000);
  const s = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rsp: window.rcp?.rspTaskCount || 0,
    f3d: window.rcp?.f3dTaskCount || 0,
    type: window.rcp?.taskTypeHistogram || {},
    controller: window.mmu?.controllerDebug || {}
  }));
  console.log(JSON.stringify(s, null, 2));
  await browser.close();
})();