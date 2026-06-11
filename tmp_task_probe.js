const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('console', msg => console.log(`PAGE ${msg.type()}: ${msg.text()}`));
  await page.goto('http://localhost:8000/index.html');

  await page.waitForFunction(() => window.rcp && window.mmu && window.cpu, null, { timeout: 15000 });

  await page.evaluate(() => {
    const rcp = window.rcp;
    if (!rcp.__taskProbePatched) {
      rcp.__taskProbePatched = true;
      rcp.__taskTypeCounts = {};
      const original = rcp.runRspTask.bind(rcp);
      rcp.runRspTask = function patchedRunRspTask() {
        const type = this.mmu.spDmemView.getUint32(0xFC0, false) >>> 0;
        this.__taskTypeCounts[type] = (this.__taskTypeCounts[type] || 0) + 1;
        return original();
      };
    }
  });

  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => {
      const rcp = window.rcp;
      const mmu = window.mmu;
      return {
        sec: performance.now() / 1000,
        rspTasks: rcp.rspTaskCount,
        rdpCmds: rcp.rdpCommandCount,
        f3dTasks: rcp.f3dTaskCount,
        taskTypeCounts: rcp.__taskTypeCounts,
        spStatus: (mmu.spRegisters[4] >>> 0),
        miIntr: (mmu.miRegisters[2] >>> 0),
        miMask: (mmu.miRegisters[3] >>> 0),
        viOrigin: (mmu.viRegisters[1] >>> 0),
        viWidth: (mmu.viRegisters[2] & 0xFFF),
      };
    });
    console.log(JSON.stringify(s));
  }

  await browser.close();
})();
