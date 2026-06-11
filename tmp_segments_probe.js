const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(18000);
  const data = await page.evaluate(() => {
    const rs = window.rcp?.rspState;
    if (!rs) return { err: 'no-rsp' };
    return {
      instr: Number(window.cpu?.instructionCount || 0),
      rsp: window.rcp?.rspTaskCount,
      rdp: window.rcp?.rdpCommandCount,
      segments: Array.from(rs.segments || []),
      currentTile: rs.currentTile,
      geometryMode: rs.geometryMode >>> 0,
      modelTop: rs.modelviewStack?.[rs.modelviewStack.length - 1],
      projection: rs.projectionMatrix,
    };
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
