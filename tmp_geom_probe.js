const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(12000);
  const data = await page.evaluate(() => {
    const rs = window.rcp?.rspState;
    if (!rs) return { err: 'no-rsp' };
    const verts = rs.vertices.slice(0, 24).map((v, i) => ({
      i,
      x: v.x,
      y: v.y,
      z: v.z,
      w: v.w,
      r: v.r,
      g: v.g,
      b: v.b,
      a: v.a
    }));
    return {
      instr: Number(window.cpu?.instructionCount || 0),
      rdp: window.rcp?.rdpCommandCount,
      triangles: window.rcp?.drawStats?.triangles,
      geometryMode: rs.geometryMode >>> 0,
      verts,
    };
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
