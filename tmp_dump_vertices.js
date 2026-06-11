const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(20000);
  const info = await page.evaluate(() => {
    const r = window.rcp;
    const v = (r?.rspState?.vertices || []).slice(0, 32).map((x, i) => ({
      i,
      x: x?.x,
      y: x?.y,
      z: x?.z,
      w: x?.w,
      r: x?.r,
      g: x?.g,
      b: x?.b,
      a: x?.a,
      s: x?.s,
      t: x?.t
    }));
    return {
      segments: Array.from(r?.rspState?.segments || []),
      viewport: r?.rspState?.viewport || null,
      currentTile: r?.rspState?.currentTile,
      textureScaleS: r?.rspState?.textureScaleS,
      textureScaleT: r?.rspState?.textureScaleT,
      vertices: v
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
