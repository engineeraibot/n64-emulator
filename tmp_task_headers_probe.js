const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.rcp && window.mmu, null, { timeout: 15000 });

  await page.evaluate(() => {
    const rcp = window.rcp;
    if (rcp.__hdrProbePatched) return;
    rcp.__hdrProbePatched = true;
    rcp.__taskHeaders = [];
    const original = rcp.runRspTask.bind(rcp);
    rcp.runRspTask = function patchedRunRspTask() {
      const base = 0xFC0;
      const hdr = {
        rspCountBefore: this.rspTaskCount,
        type: this.mmu.spDmemView.getUint32(base + 0x00, false) >>> 0,
        flags: this.mmu.spDmemView.getUint32(base + 0x08, false) >>> 0,
        dataPtr: this.mmu.spDmemView.getUint32(base + 0x30, false) >>> 0,
        dataSize: this.mmu.spDmemView.getUint32(base + 0x34, false) >>> 0,
        yieldDataPtr: this.mmu.spDmemView.getUint32(base + 0x38, false) >>> 0,
        yieldDataSize: this.mmu.spDmemView.getUint32(base + 0x3C, false) >>> 0,
        spStatusBefore: this.mmu.spRegisters[4] >>> 0,
        miIntrBefore: this.mmu.miRegisters[2] >>> 0
      };
      const out = original();
      hdr.rspCountAfter = this.rspTaskCount;
      hdr.f3dTaskCountAfter = this.f3dTaskCount;
      hdr.spStatusAfter = this.mmu.spRegisters[4] >>> 0;
      hdr.miIntrAfter = this.mmu.miRegisters[2] >>> 0;
      this.__taskHeaders.push(hdr);
      if (this.__taskHeaders.length > 256) this.__taskHeaders.shift();
      return out;
    };
  });

  await page.waitForTimeout(25000);

  const state = await page.evaluate(() => ({
    allHeaders: window.rcp?.__taskHeaders || [],
    instr: Number(window.cpu?.instructionCount || 0),
    rspTaskCount: window.rcp?.rspTaskCount || 0,
    f3dTaskCount: window.rcp?.f3dTaskCount || 0,
    taskTypeHistogram: window.rcp?.taskTypeHistogram || null,
    lastHeaders: (window.rcp?.__taskHeaders || []).slice(-60),
    lastGraphicsHeaders: (window.rcp?.__taskHeaders || []).filter(h => h.type === 1).slice(-20),
    spStatus: window.mmu?.spRegisters?.[4] >>> 0,
    miIntr: window.mmu?.miRegisters?.[2] >>> 0,
    miMask: window.mmu?.miRegisters?.[3] >>> 0
  }));
  console.log(JSON.stringify(state, null, 2));
  await browser.close();
})();
