const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.cpu && window.mmu && window.rcp, null, { timeout: 20000 });

  await page.evaluate(() => {
    const cpu = window.cpu;
    const mmu = window.mmu;
    if (cpu.__pcSamplePatched) return;
    cpu.__pcSamplePatched = true;
    cpu.__pcSamples = [];
    const watch = new Set([0x80242E54, 0x802F502C, 0x80244104, 0x8024425C, 0x802DFF18, 0x802E202C]);

    const origStep = cpu.step.bind(cpu);
    cpu.step = function patchedStep() {
      const pc32 = Number(this.pc & 0xFFFFFFFFn) >>> 0;
      if (watch.has(pc32) && this.__pcSamples.length < 240) {
        const g = this.gpr;
        const a0 = Number(g[4] & 0xFFFFFFFFn) >>> 0;
        const a1 = Number(g[5] & 0xFFFFFFFFn) >>> 0;
        const a2 = Number(g[6] & 0xFFFFFFFFn) >>> 0;
        const a3 = Number(g[7] & 0xFFFFFFFFn) >>> 0;
        const v0 = Number(g[2] & 0xFFFFFFFFn) >>> 0;
        const v1 = Number(g[3] & 0xFFFFFFFFn) >>> 0;
        const t0 = Number(g[8] & 0xFFFFFFFFn) >>> 0;
        const t1 = Number(g[9] & 0xFFFFFFFFn) >>> 0;
        const ra = Number(g[31] & 0xFFFFFFFFn) >>> 0;
        let qState = null;
        const q = a0 & 0x1FFFFFFF;
        if (q >= 0 && q + 0x14 < 0x800000) {
          try {
            const rd = new DataView(mmu.memory.rdram);
            qState = {
              q,
              validCount: rd.getUint32(q + 0x8, false) >>> 0,
              first: rd.getUint32(q + 0xC, false) >>> 0,
              msgCount: rd.getUint32(q + 0x10, false) >>> 0
            };
          } catch (e) {}
        }
        this.__pcSamples.push({
          instr: Number(this.instructionCount || 0),
          pc: pc32,
          a0, a1, a2, a3, v0, v1, t0, t1, ra,
          qState,
          f3d: window.rcp?.f3dTaskCount || 0,
          rsp: window.rcp?.rspTaskCount || 0,
          miIntr: window.mmu?.miRegisters?.[2] >>> 0
        });
      }
      return origStep();
    };
  });

  await page.waitForTimeout(30000);
  const report = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rsp: window.rcp?.rspTaskCount || 0,
    f3d: window.rcp?.f3dTaskCount || 0,
    samples: window.cpu?.__pcSamples || []
  }));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})();
