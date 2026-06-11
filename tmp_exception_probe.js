const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.on('console', msg => {
    const t = msg.type();
    if (t === 'warning' || t === 'error') console.log(`PAGE ${t}: ${msg.text()}`);
  });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.cpu && window.mmu && window.rcp, null, { timeout: 20000 });

  await page.evaluate(() => {
    const cpu = window.cpu;
    if (cpu.__excProbePatched) return;
    cpu.__excProbePatched = true;
    cpu.__excCounts = {};
    cpu.__excSamples = [];
    const orig = cpu.raiseException.bind(cpu);
    cpu.raiseException = function patchedRaise(code, pc, ds) {
      this.__excCounts[code] = (this.__excCounts[code] || 0) + 1;
      if (this.__excSamples.length < 40) {
        this.__excSamples.push({
          t: performance.now(),
          code,
          pc: Number(pc & 0xFFFFFFFFn) >>> 0,
          ds: !!ds,
          status: Number(this.cp0Registers[12] & 0xFFFFFFFFn) >>> 0,
          cause: Number(this.cp0Registers[13] & 0xFFFFFFFFn) >>> 0
        });
      }
      return orig(code, pc, ds);
    };
  });

  await page.waitForTimeout(30000);

  const report = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    pc: Number(window.cpu?.pc & 0xFFFFFFFFn) >>> 0,
    rspTasks: window.rcp?.rspTaskCount || 0,
    f3dTasks: window.rcp?.f3dTaskCount || 0,
    taskTypeHistogram: window.rcp?.taskTypeHistogram || {},
    controllerDebug: window.mmu?.controllerDebug || {},
    siRegs: Array.from(window.mmu?.siRegisters || []),
    miRegs: Array.from(window.mmu?.miRegisters || []),
    viRegs: Array.from(window.mmu?.viRegisters || []),
    excCounts: window.cpu?.__excCounts || {},
    excSamples: window.cpu?.__excSamples || []
  }));

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})();
