const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.rcp && window.mmu, null, { timeout: 20000 });

  await page.evaluate(() => {
    const rcp = window.rcp;
    if (rcp.__obufProbePatched) return;
    rcp.__obufProbePatched = true;
    rcp.__gfxTaskOut = [];
    const rd = new DataView(window.mmu.memory.rdram);
    const orig = rcp.runRspTask.bind(rcp);
    rcp.runRspTask = function() {
      const b = 0xFC0;
      const type = this.mmu.spDmemView.getUint32(b + 0x00, false) >>> 0;
      const outPtr = this.mmu.spDmemView.getUint32(b + 0x28, false) & 0x7FFFFF;
      const outSizePtr = this.mmu.spDmemView.getUint32(b + 0x2C, false) & 0x7FFFFF;
      let outSizeBefore = 0;
      let outHeadBefore = 0;
      if (outSizePtr + 3 < 0x800000) outSizeBefore = rd.getUint32(outSizePtr, false) >>> 0;
      if (outPtr + 3 < 0x800000) outHeadBefore = rd.getUint32(outPtr, false) >>> 0;
      const rspBefore = this.rspTaskCount;
      const f3dBefore = this.f3dTaskCount;

      const ret = orig();

      if (type === 1 && this.__gfxTaskOut.length < 160) {
        let outSizeAfter = 0;
        let outHeadAfter = 0;
        if (outSizePtr + 3 < 0x800000) outSizeAfter = rd.getUint32(outSizePtr, false) >>> 0;
        if (outPtr + 3 < 0x800000) outHeadAfter = rd.getUint32(outPtr, false) >>> 0;
        this.__gfxTaskOut.push({
          rspBefore,
          f3dBefore,
          f3dAfter: this.f3dTaskCount,
          dataPtr: this.mmu.spDmemView.getUint32(b + 0x30, false) >>> 0,
          dataSize: this.mmu.spDmemView.getUint32(b + 0x34, false) >>> 0,
          outPtr,
          outSizePtr,
          outSizeBefore,
          outSizeAfter,
          outHeadBefore,
          outHeadAfter,
        });
      }
      return ret;
    };
  });

  await page.waitForFunction(() => window.rcp && window.rcp.f3dTaskCount >= 96, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const report = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rsp: window.rcp?.rspTaskCount || 0,
    f3d: window.rcp?.f3dTaskCount || 0,
    gfxTaskOut: window.rcp?.__gfxTaskOut || []
  }));

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})();
