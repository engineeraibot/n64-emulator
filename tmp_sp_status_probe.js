const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.rcp && window.mmu && window.cpu, null, { timeout: 20000 });
  await page.evaluate(() => {
    const rcp = window.rcp;
    if (rcp.__spProbePatched) return;
    rcp.__spProbePatched = true;
    rcp.__spWrites = [];
    const origHandle = rcp.handleSpWrite.bind(rcp);
    rcp.handleSpWrite = function(addr, value) {
      if ((addr >>> 0) === 0x04040010) {
        if (this.__spWrites.length < 5000) {
          this.__spWrites.push({
            instr: Number(this.mmu.cpu?.instructionCount || 0),
            value: value >>> 0,
            pre: this.mmu.spRegisters[4] >>> 0,
            rsp: this.rspTaskCount | 0,
            f3d: this.f3dTaskCount | 0,
            typeAtCall: this.mmu.spDmemView.getUint32(0xFC0, false) >>> 0
          });
        }
      }
      return origHandle(addr, value);
    };
  });
  await page.waitForTimeout(45000);
  const out = await page.evaluate(() => {
    const rcp = window.rcp;
    const all = rcp.__spWrites || [];
    const tail = all.slice(-120);
    return {
      instr: Number(window.cpu?.instructionCount || 0),
      rsp: rcp.rspTaskCount,
      f3d: rcp.f3dTaskCount,
      typeHist: rcp.taskTypeHistogram,
      writes: tail
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();