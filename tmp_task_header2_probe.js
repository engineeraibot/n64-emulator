const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.rcp && window.mmu, null, { timeout: 20000 });

  await page.evaluate(() => {
    const rcp = window.rcp;
    if (rcp.__hdr2Patched) return;
    rcp.__hdr2Patched = true;
    rcp.__lastType1List = [];
    rcp.__firstType2After96 = [];
    rcp.__f3dReached = false;
    const orig = rcp.runRspTask.bind(rcp);
    rcp.runRspTask = function() {
      const b = 0xFC0;
      const hdr = {
        rspBefore: this.rspTaskCount,
        type: this.mmu.spDmemView.getUint32(b + 0x00, false) >>> 0,
        flags: this.mmu.spDmemView.getUint32(b + 0x04, false) >>> 0,
        ucodeBoot: this.mmu.spDmemView.getUint32(b + 0x08, false) >>> 0,
        ucodeBootSize: this.mmu.spDmemView.getUint32(b + 0x0C, false) >>> 0,
        ucode: this.mmu.spDmemView.getUint32(b + 0x10, false) >>> 0,
        ucodeSize: this.mmu.spDmemView.getUint32(b + 0x14, false) >>> 0,
        ucodeData: this.mmu.spDmemView.getUint32(b + 0x18, false) >>> 0,
        ucodeDataSize: this.mmu.spDmemView.getUint32(b + 0x1C, false) >>> 0,
        dramStack: this.mmu.spDmemView.getUint32(b + 0x20, false) >>> 0,
        dramStackSize: this.mmu.spDmemView.getUint32(b + 0x24, false) >>> 0,
        outputBuff: this.mmu.spDmemView.getUint32(b + 0x28, false) >>> 0,
        outputBuffSize: this.mmu.spDmemView.getUint32(b + 0x2C, false) >>> 0,
        dataPtr: this.mmu.spDmemView.getUint32(b + 0x30, false) >>> 0,
        dataSize: this.mmu.spDmemView.getUint32(b + 0x34, false) >>> 0,
        yieldDataPtr: this.mmu.spDmemView.getUint32(b + 0x38, false) >>> 0,
        yieldDataSize: this.mmu.spDmemView.getUint32(b + 0x3C, false) >>> 0
      };
      const out = orig();
      hdr.rspAfter = this.rspTaskCount;
      hdr.f3dAfter = this.f3dTaskCount;
      if (hdr.type === 1) {
        this.__lastType1List.push(hdr);
        if (this.__lastType1List.length > 12) this.__lastType1List.shift();
      }
      if (this.f3dTaskCount >= 96) this.__f3dReached = true;
      if (this.__f3dReached && hdr.type === 2 && this.__firstType2After96.length < 12) {
        this.__firstType2After96.push(hdr);
      }
      return out;
    };
  });

  await page.waitForFunction(() => window.rcp && window.rcp.f3dTaskCount >= 96 && window.rcp.__firstType2After96.length >= 8, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const report = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rsp: window.rcp?.rspTaskCount || 0,
    f3d: window.rcp?.f3dTaskCount || 0,
    lastType1List: window.rcp?.__lastType1List || [],
    firstType2After96: window.rcp?.__firstType2After96 || [],
  }));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})();
