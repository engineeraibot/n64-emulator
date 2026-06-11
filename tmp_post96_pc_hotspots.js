const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.cpu && window.mmu && window.rcp, null, { timeout: 20000 });

  await page.evaluate(() => {
    const cpu = window.cpu;
    if (cpu.__post96Patch) return;
    cpu.__post96Patch = true;
    cpu.__post96Counts = Object.create(null);
    cpu.__post96Samples = [];
    cpu.__post96Ticks = 0;
    const origStep = cpu.step.bind(cpu);
    cpu.step = function patchedStep() {
      const out = origStep();
      if ((window.rcp?.f3dTaskCount || 0) >= 96) {
        if ((this.instructionCount & 0x3F) === 0) {
          const pc = Number(this.pc & 0xFFFFFFFFn) >>> 0;
          this.__post96Counts[pc] = (this.__post96Counts[pc] || 0) + 1;
          this.__post96Ticks++;
          if (this.__post96Samples.length < 80) {
            const g = this.gpr;
            this.__post96Samples.push({
              instr: Number(this.instructionCount || 0),
              pc,
              a0: Number(g[4] & 0xFFFFFFFFn) >>> 0,
              a1: Number(g[5] & 0xFFFFFFFFn) >>> 0,
              v0: Number(g[2] & 0xFFFFFFFFn) >>> 0,
              t0: Number(g[8] & 0xFFFFFFFFn) >>> 0,
              t1: Number(g[9] & 0xFFFFFFFFn) >>> 0,
              mi: window.mmu?.miRegisters?.[2] >>> 0,
              sp: window.mmu?.spRegisters?.[4] >>> 0
            });
          }
        }
      }
      return out;
    };
  });

  await page.waitForFunction(() => (window.rcp?.f3dTaskCount || 0) >= 96, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(7000);

  const report = await page.evaluate(() => {
    const cpu = window.cpu;
    const entries = Object.entries(cpu.__post96Counts || {}).map(([pc, c]) => ({ pc: Number(pc) >>> 0, c }));
    entries.sort((a,b) => b.c - a.c);
    return {
      instr: Number(cpu?.instructionCount || 0),
      rsp: window.rcp?.rspTaskCount || 0,
      f3d: window.rcp?.f3dTaskCount || 0,
      ticks: cpu.__post96Ticks || 0,
      top: entries.slice(0, 40),
      samples: cpu.__post96Samples || [],
      mi: Array.from(window.mmu?.miRegisters || []),
      si: Array.from(window.mmu?.siRegisters || []),
      vi: Array.from(window.mmu?.viRegisters || []),
      controller: window.mmu?.controllerDebug || {}
    };
  });

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})();
