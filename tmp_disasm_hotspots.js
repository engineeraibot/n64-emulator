const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(20000);
  const addrs = [0x802EF620,0x802E6494,0x802F1198,0x802DF758,0x80242E54,0x802F502C,0x80244104,0x8024425C];
  const out = await page.evaluate((addrs) => {
    const cpu = window.cpu;
    const result = {};
    for (const a of addrs) {
      const arr = [];
      for (let off = -16; off <= 16; off += 4) {
        const pc = (a + off) >>> 0;
        let ins = 0;
        try { ins = cpu.readInstructionWord(BigInt(pc)) >>> 0; } catch (e) {}
        arr.push({ pc, ins });
      }
      result[a >>> 0] = arr;
    }
    return result;
  }, addrs);
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
