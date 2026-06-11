const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(30000);

  const state = await page.evaluate(() => {
    const mmu = window.mmu;
    const rcp = window.rcp;
    const rd = new DataView(mmu.memory.rdram);
    const viOrigin = (mmu.viRegisters[1] & 0x7FFFFF) >>> 0;
    const viWidth = (mmu.viRegisters[2] & 0xFFF) >>> 0;
    const viType = (mmu.viRegisters[0] & 0x3) >>> 0;
    const height = 240;

    const scan = (origin, width, type) => {
      if (!origin || !width || (type !== 2 && type !== 3)) return { nonBlack: 0, sample: [] };
      let nonBlack = 0;
      const sample = [];
      if (type === 2) {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const addr = (origin + ((y * width + x) << 1)) & 0x7FFFFF;
            const v = rd.getUint16(addr, false);
            const r = ((v >> 11) & 0x1F) << 3;
            const g = ((v >> 6) & 0x1F) << 3;
            const b = ((v >> 1) & 0x1F) << 3;
            if (r > 12 || g > 12 || b > 12) nonBlack++;
            if (sample.length < 16 && (x % 40 === 0) && (y % 30 === 0)) sample.push(v >>> 0);
          }
        }
      } else {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const addr = (origin + ((y * width + x) << 2)) & 0x7FFFFF;
            const r = rd.getUint8(addr);
            const g = rd.getUint8(addr + 1);
            const b = rd.getUint8(addr + 2);
            if (r > 12 || g > 12 || b > 12) nonBlack++;
            if (sample.length < 16 && (x % 40 === 0) && (y % 30 === 0)) sample.push((r << 16) | (g << 8) | b);
          }
        }
      }
      return { nonBlack, sample };
    };

    const direct = scan(viOrigin, viWidth, viType);
    const selected = (typeof rcp.getDeterministicVideoTarget === 'function')
      ? rcp.getDeterministicVideoTarget(viOrigin, viWidth, viType)
      : null;
    const selectedScan = selected ? scan(selected.origin >>> 0, selected.width >>> 0, selected.type >>> 0) : null;
    const latest = rcp.latestVideoTarget || null;
    const latestScan = latest ? scan(latest.origin >>> 0, latest.width >>> 0, latest.type >>> 0) : null;
    const snapshot = rcp.lastRichVideoSnapshot || null;

    return {
      instr: Number(window.cpu?.instructionCount || 0),
      rspTaskCount: rcp.rspTaskCount,
      f3dTaskCount: rcp.f3dTaskCount,
      vi: { origin: viOrigin, width: viWidth, type: viType },
      direct,
      selected,
      selectedScan,
      latest,
      latestScan,
      snapshot: snapshot ? {
        origin: snapshot.origin,
        width: snapshot.width,
        type: snapshot.type,
        height: snapshot.height,
        nonBlack: snapshot.nonBlack,
        sequence: snapshot.sequence
      } : null
    };
  });

  console.log(JSON.stringify(state, null, 2));
  await browser.close();
})();
