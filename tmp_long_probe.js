const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(90000);
  const s = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rsp: window.rcp?.rspTaskCount || 0,
    f3d: window.rcp?.f3dTaskCount || 0,
    taskType: window.rcp?.taskTypeHistogram || {},
    controller: window.mmu?.controllerDebug || {},
    viOrigin: window.mmu?.viRegisters?.[1] >>> 0,
    viWidth: (window.mmu?.viRegisters?.[2] & 0xFFF) >>> 0
  }));
  console.log(JSON.stringify(s, null, 2));
  await browser.close();
})();
