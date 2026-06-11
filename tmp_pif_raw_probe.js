const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(16000);
  const state = await page.evaluate(() => {
    const mmu = window.mmu;
    const pif = Array.from(mmu?.pifRam || []);
    const ch = (mmu?.joybusChannels || []).map(c => c ? { channel:c.channel, tx:c.tx, rx:c.rx, sl:c.sl, rl:c.rl } : null);
    return {
      instr: Number(window.cpu?.instructionCount || 0),
      rsp: window.rcp?.rspTaskCount || 0,
      f3d: window.rcp?.f3dTaskCount || 0,
      controllerDebug: mmu?.controllerDebug || {},
      pif,
      joybusChannels: ch,
      siRegs: Array.from(mmu?.siRegisters || []),
      miRegs: Array.from(mmu?.miRegisters || [])
    };
  });
  console.log(JSON.stringify(state, null, 2));
  await browser.close();
})();
