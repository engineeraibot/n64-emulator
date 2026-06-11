const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForFunction(() => window.cpu && window.mmu, null, { timeout: 20000 });
  await page.waitForTimeout(12000);
  const out = await page.evaluate(() => {
    const cpu = window.cpu;
    const bases = [0x80242e20, 0x802f4fe0, 0x80244100];
    const dump = {};
    for (const b of bases) {
      const arr = [];
      for (let off = 0; off < 0x80; off += 4) {
        const pc = BigInt((b + off) >>> 0);
        let ins = 0;
        try { ins = cpu.readInstructionWord(pc) >>> 0; } catch (e) { ins = 0; }
        arr.push({ pc: (b + off) >>> 0, ins });
      }
      dump[b >>> 0] = arr;
    }
    return dump;
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();