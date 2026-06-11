const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.rcp && window.mmu && window.cpu, null, { timeout: 20000 });

  await page.evaluate(() => {
    const rcp = window.rcp;
    if (rcp.__transitionPatched) return;
    rcp.__transitionPatched = true;
    rcp.__typeCounts = {};
    rcp.__lastType1 = null;
    rcp.__after96 = [];
    rcp.__hit96AtRsp = -1;
    const orig = rcp.runRspTask.bind(rcp);
    rcp.runRspTask = function() {
      const base = 0xFC0;
      const type = this.mmu.spDmemView.getUint32(base + 0x00, false) >>> 0;
      const hdr = {
        rspBefore: this.rspTaskCount,
        type,
        flags: this.mmu.spDmemView.getUint32(base + 0x08, false) >>> 0,
        ucStart: this.mmu.spDmemView.getUint32(base + 0x10, false) >>> 0,
        ucSize: this.mmu.spDmemView.getUint32(base + 0x14, false) >>> 0,
        ucData: this.mmu.spDmemView.getUint32(base + 0x18, false) >>> 0,
        ucDataSize: this.mmu.spDmemView.getUint32(base + 0x1C, false) >>> 0,
        dataPtr: this.mmu.spDmemView.getUint32(base + 0x30, false) >>> 0,
        dataSize: this.mmu.spDmemView.getUint32(base + 0x34, false) >>> 0,
        yieldDataPtr: this.mmu.spDmemView.getUint32(base + 0x38, false) >>> 0,
        yieldDataSize: this.mmu.spDmemView.getUint32(base + 0x3C, false) >>> 0,
      };

      this.__typeCounts[type] = (this.__typeCounts[type] || 0) + 1;
      const out = orig();

      hdr.rspAfter = this.rspTaskCount;
      hdr.f3dAfter = this.f3dTaskCount;
      if (type === 1) this.__lastType1 = hdr;
      if (this.f3dTaskCount >= 96 && this.__hit96AtRsp < 0) {
        this.__hit96AtRsp = this.rspTaskCount;
      }
      if (this.__hit96AtRsp >= 0 && this.__after96.length < 40) {
        this.__after96.push(hdr);
      }
      return out;
    };
  });

  await page.waitForFunction(() => window.rcp && window.rcp.__hit96AtRsp >= 0 && window.rcp.__after96.length >= 30, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const report = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rsp: window.rcp?.rspTaskCount || 0,
    f3d: window.rcp?.f3dTaskCount || 0,
    typeCounts: window.rcp?.__typeCounts || {},
    hit96AtRsp: window.rcp?.__hit96AtRsp,
    lastType1: window.rcp?.__lastType1,
    after96: window.rcp?.__after96 || [],
    controllerDebug: window.mmu?.controllerDebug || {}
  }));

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})();
