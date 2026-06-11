const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.mmu && window.cpu && window.rcp, null, { timeout: 20000 });
  await page.evaluate(() => {
    const mmu = window.mmu;
    if (mmu.__siTracePatched) return;
    mmu.__siTracePatched = true;
    mmu.__siWrites = [];
    mmu.__siWriteCounts = {};
    const orig = mmu.handleSiWrite.bind(mmu);
    mmu.handleSiWrite = function(a, v) {
      const idx = (a - 0x04800000) >> 2;
      this.__siWriteCounts[idx] = (this.__siWriteCounts[idx] || 0) + 1;
      if (this.__siWrites.length < 300) {
        this.__siWrites.push({ t: performance.now(), idx, a: a >>> 0, v: v >>> 0, instr: Number(window.cpu?.instructionCount || 0) });
      }
      return orig(a, v);
    };
  });
  await page.waitForTimeout(30000);
  const report = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rsp: window.rcp?.rspTaskCount || 0,
    f3d: window.rcp?.f3dTaskCount || 0,
    siWriteCounts: window.mmu?.__siWriteCounts || {},
    siWrites: (window.mmu?.__siWrites || []).slice(-50),
    pifCmdCalls: window.mmu?.controllerDebug?.pifCmdCalls || 0,
    buttonReads: window.mmu?.controllerDebug?.buttonReads || 0,
    infoReads: window.mmu?.controllerDebug?.infoReads || 0
  }));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})();
