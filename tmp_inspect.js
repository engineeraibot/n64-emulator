const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(20000);

  const state = await page.evaluate(() => {
    const rcp = window.rcp;
    const rsp = rcp?.rspState || {};
    return {
      instr: Number(window.cpu?.instructionCount || 0),
      rspTaskCount: rcp?.rspTaskCount || 0,
      rdpCommandCount: rcp?.rdpCommandCount || 0,
      drawStats: rcp?.drawStats || null,
      dlOpcodeHistogram: rcp?.dlOpcodeHistogram || null,
      taskTypeHistogram: rcp?.taskTypeHistogram || null,
      vi: {
        origin: window.mmu?.viRegisters?.[1] & 0x7FFFFF,
        width: window.mmu?.viRegisters?.[2] & 0xFFF,
        type: window.mmu?.viRegisters?.[0] & 0x3,
      },
      colorImage: {
        origin: rsp.colorImage & 0x7FFFFF,
        width: rsp.colorImageWidth | 0,
        size: rsp.colorImageSize | 0,
      },
      textureImage: {
        origin: rsp.textureImage & 0x7FFFFF,
        width: rsp.textureImageWidth | 0,
        size: rsp.textureImageSize | 0,
      },
      combine: rsp.combine || null,
      otherMode: {
        hi: rsp.otherModeHi >>> 0,
        lo: rsp.otherModeLo >>> 0
      },
      currentTile: rsp.currentTile | 0,
      tiles: (rsp.tiles || []).map((t, idx) => ({
        idx,
        format: t.format,
        size: t.size,
        line: t.line,
        tmem: t.tmem,
        palette: t.palette,
        uls: t.uls,
        ult: t.ult,
        lrs: t.lrs,
        lrt: t.lrt,
        maskS: t.maskS,
        maskT: t.maskT,
        shiftS: t.shiftS,
        shiftT: t.shiftT
      })),
      latestVideoTarget: rcp?.latestVideoTarget || null,
      historyTail: (rcp?.videoTargetHistory || []).slice(-12)
    };
  });

  console.log(JSON.stringify(state, null, 2));
  await browser.close();
})();
