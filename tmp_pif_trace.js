const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.mmu && window.cpu && window.rcp, null, { timeout: 20000 });

  await page.evaluate(() => {
    const mmu = window.mmu;
    if (mmu.__pifTracePatched) return;
    mmu.__pifTracePatched = true;
    mmu.__pifTrace = [];

    const origHandle = mmu.handlePifCommand.bind(mmu);
    mmu.handlePifCommand = function patchedHandlePifCommand() {
      const before = Array.from(this.pifRam.slice(0, 16));
      const cmdByte = this.pifRam[0x3F] & 0xFF;
      let channels = [];
      try {
        channels = this.parseJoybusChannels().map(c => ({ ch: c.channel, sl: c.sl, rl: c.rl, cmd: c.cmd }));
      } catch (e) {}
      const out = origHandle();
      const after = Array.from(this.pifRam.slice(0, 16));
      this.__pifTrace.push({
        kind: 'handlePifCommand',
        t: performance.now(),
        cmdByte,
        before,
        after,
        channels,
        buttonReads: this.controllerDebug.buttonReads,
        infoReads: this.controllerDebug.infoReads
      });
      if (this.__pifTrace.length > 400) this.__pifTrace.shift();
      return out;
    };

    const origProcess = mmu.processJoybusRead.bind(mmu);
    mmu.processJoybusRead = function patchedProcessJoybusRead() {
      const channels = this.parseJoybusChannels().map(c => ({ ch: c.channel, sl: c.sl, rl: c.rl, cmd: c.cmd }));
      const pre = this.controllerDebug.buttonReads;
      const out = origProcess();
      const post = this.controllerDebug.buttonReads;
      this.__pifTrace.push({
        kind: 'processJoybusRead',
        t: performance.now(),
        channels,
        deltaButtons: post - pre,
        buttonReads: post,
        infoReads: this.controllerDebug.infoReads,
        pif0_16: Array.from(this.pifRam.slice(0, 16))
      });
      if (this.__pifTrace.length > 400) this.__pifTrace.shift();
      return out;
    };
  });

  await page.waitForTimeout(25000);

  const report = await page.evaluate(() => {
    const mmu = window.mmu;
    const trace = mmu.__pifTrace || [];
    const summary = {
      instr: Number(window.cpu?.instructionCount || 0),
      rspTaskCount: window.rcp?.rspTaskCount || 0,
      f3dTaskCount: window.rcp?.f3dTaskCount || 0,
      pifCmdCalls: mmu.controllerDebug.pifCmdCalls,
      buttonReads: mmu.controllerDebug.buttonReads,
      infoReads: mmu.controllerDebug.infoReads,
      lastPifCmdByte: mmu.controllerDebug.lastPifCmdByte,
      traceCount: trace.length,
      last20: trace.slice(-20)
    };
    return summary;
  });

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})();
