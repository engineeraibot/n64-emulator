const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.mmu && window.rcp && window.cpu, null, { timeout: 15000 });

  await page.evaluate(() => {
    const mmu = window.mmu;
    if (mmu.__siProbePatched) return;
    mmu.__siProbePatched = true;
    mmu.__siStats = { writeDma: 0, readDma: 0, complete: 0, pifCmd: 0, joyRead: 0 };

    const origDoSiDma = mmu.doSiDma.bind(mmu);
    mmu.doSiDma = function patchedDoSiDma(toPif) {
      if (toPif) this.__siStats.writeDma++;
      else this.__siStats.readDma++;
      return origDoSiDma(toPif);
    };

    const origHandlePifCommand = mmu.handlePifCommand.bind(mmu);
    mmu.handlePifCommand = function patchedHandlePifCommand() {
      this.__siStats.pifCmd++;
      return origHandlePifCommand();
    };

    const origProcessJoybusRead = mmu.processJoybusRead.bind(mmu);
    mmu.processJoybusRead = function patchedProcessJoybusRead() {
      this.__siStats.joyRead++;
      return origProcessJoybusRead();
    };

    const origCheck = mmu.checkInternalEvents.bind(mmu);
    mmu.checkInternalEvents = function patchedCheckInternalEvents() {
      const before = this.siBusyUntil;
      const out = origCheck();
      if (before > 0 && this.siBusyUntil === 0) this.__siStats.complete++;
      return out;
    };
  });

  await page.waitForTimeout(30000);
  const s = await page.evaluate(() => ({
    instr: Number(window.cpu?.instructionCount || 0),
    rspTaskCount: window.rcp?.rspTaskCount || 0,
    f3dTaskCount: window.rcp?.f3dTaskCount || 0,
    siStats: window.mmu?.__siStats || null,
    controllerDebug: window.mmu?.controllerDebug || null,
    siRegs: Array.from(window.mmu?.siRegisters || []),
    miRegs: Array.from(window.mmu?.miRegisters || [])
  }));
  console.log(JSON.stringify(s, null, 2));
  await browser.close();
})();
