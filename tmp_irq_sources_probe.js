const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.mmu && window.cpu && window.rcp, null, { timeout: 20000 });
  await page.evaluate(() => {
    const mmu = window.mmu;
    if (mmu.__irqPatched) return;
    mmu.__irqPatched = true;
    mmu.__irqSeen = { sp: 0, si: 0, ai: 0, vi: 0, pi: 0, dp: 0, any: 0 };
    mmu.__irqSamples = [];
    const orig = mmu.updateInterrupts.bind(mmu);
    mmu.updateInterrupts = function() {
      const mi = this.miRegisters[2] >>> 0;
      if (mi) {
        this.__irqSeen.any++;
        if (mi & 0x01) this.__irqSeen.sp++;
        if (mi & 0x02) this.__irqSeen.si++;
        if (mi & 0x04) this.__irqSeen.ai++;
        if (mi & 0x08) this.__irqSeen.vi++;
        if (mi & 0x10) this.__irqSeen.pi++;
        if (mi & 0x20) this.__irqSeen.dp++;
        if (this.__irqSamples.length < 120) {
          this.__irqSamples.push({ t: performance.now(), instr: Number(window.cpu?.instructionCount || 0), mi });
        }
      }
      return orig();
    };
  });
  await page.waitForTimeout(26000);
  const report = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rsp: window.rcp?.rspTaskCount || 0,
    f3d: window.rcp?.f3dTaskCount || 0,
    irqSeen: window.mmu?.__irqSeen || {},
    pifCmdCalls: window.mmu?.controllerDebug?.pifCmdCalls || 0,
    buttonReads: window.mmu?.controllerDebug?.buttonReads || 0,
    samples: window.mmu?.__irqSamples || []
  }));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})();
