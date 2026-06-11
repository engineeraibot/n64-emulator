const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(18000);
  const data = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rsp: window.rcp?.rspTaskCount,
    rdp: window.rcp?.rdpCommandCount,
    viewport: window.rcp?.rspState?.viewport,
    geom: window.rcp?.rspState?.geometryMode >>> 0,
    drawStats: window.rcp?.drawStats,
  }));
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
