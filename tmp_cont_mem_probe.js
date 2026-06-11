const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(18000);
  const out = await page.evaluate(() => {
    const rd = new Uint8Array(window.mmu.memory.rdram);
    const dump = (base, len=64) => Array.from(rd.slice(base, base + len));
    return {
      instr: Number(window.cpu?.instructionCount || 0),
      rsp: window.rcp?.rspTaskCount || 0,
      f3d: window.rcp?.f3dTaskCount || 0,
      a335B80: dump(0x335B80, 96),
      a336CA0: dump(0x336CA0, 96),
      pif: Array.from(window.mmu?.pifRam || []),
      ctrl: window.mmu?.controllerDebug || {}
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
