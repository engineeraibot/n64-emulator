const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(14000);
  const data = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rsp: window.rcp?.rspTaskCount,
    rdp: window.rcp?.rdpCommandCount,
    f3d: window.rcp?.f3dTaskCount,
    f3dex2: window.rcp?.f3dex2TaskCount,
    histogram: window.rcp?.dlOpcodeHistogram,
    vtxSamples: window.rcp?.dlSamples?.vtx,
    triSamples: window.rcp?.dlSamples?.tri1,
    movememSamples: window.rcp?.dlSamples?.movemem,
    useTexture: window.rcp?.rspState?.useTexture,
    otherModeLo: window.rcp?.rspState?.otherModeLo >>> 0,
    otherModeHi: window.rcp?.rspState?.otherModeHi >>> 0,
  }));
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
