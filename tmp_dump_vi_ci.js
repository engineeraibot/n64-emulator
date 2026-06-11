const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  await page.waitForTimeout(18000);

  const out = await page.evaluate(() => {
    const FBW = 320;
    const FBH = 240;
    const rd = new DataView(window.mmu.memory.rdram);
    const viOrigin = window.mmu.viRegisters[1] & 0x7FFFFF;
    const viWidth = window.mmu.viRegisters[2] & 0xFFF;
    const viType = window.mmu.viRegisters[0] & 0x3;
    const ciOrigin = window.rcp?.rspState?.colorImage & 0x7FFFFF;
    const ciWidth = window.rcp?.rspState?.colorImageWidth | 0;
    const ciType = (window.rcp?.rspState?.colorImageSize === 3) ? 3 : 2;

    const decode5551 = (v) => ({
      r: ((v >> 11) & 0x1F) << 3,
      g: ((v >> 6) & 0x1F) << 3,
      b: ((v >> 1) & 0x1F) << 3,
      a: (v & 1) ? 255 : 0
    });

    const draw = (origin, width, type) => {
      const canvas = document.createElement('canvas');
      canvas.width = FBW; canvas.height = FBH;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(FBW, FBH);
      let p = 0;
      const bpp = type === 3 ? 4 : 2;
      for (let y = 0; y < FBH; y++) {
        for (let x = 0; x < FBW; x++) {
          const a = (origin + (y * width + x) * bpp) & 0x7FFFFF;
          if (type === 2) {
            const v = (rd.getUint8(a) << 8) | rd.getUint8((a + 1) & 0x7FFFFF);
            const c = decode5551(v);
            img.data[p++] = c.r;
            img.data[p++] = c.g;
            img.data[p++] = c.b;
            img.data[p++] = 255;
          } else if (type === 3) {
            img.data[p++] = rd.getUint8(a);
            img.data[p++] = rd.getUint8((a + 1) & 0x7FFFFF);
            img.data[p++] = rd.getUint8((a + 2) & 0x7FFFFF);
            img.data[p++] = 255;
          } else {
            img.data[p++] = 0;
            img.data[p++] = 0;
            img.data[p++] = 0;
            img.data[p++] = 255;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL('image/png');
    };

    return {
      instr: Number(window.cpu.instructionCount),
      rsp: window.rcp.rspTaskCount,
      rdp: window.rcp.rdpCommandCount,
      viOrigin,
      viWidth,
      viType,
      ciOrigin,
      ciWidth,
      ciType,
      viDataUrl: draw(viOrigin, viWidth, viType),
      ciDataUrl: draw(ciOrigin, ciWidth, ciType),
    };
  });

  const writeDataUrl = (dataUrl, file) => {
    const base64 = dataUrl.split(',')[1];
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
  };

  writeDataUrl(out.viDataUrl, 'test-results/tmp-direct-vi.png');
  writeDataUrl(out.ciDataUrl, 'test-results/tmp-direct-ci.png');
  fs.writeFileSync('test-results/tmp-direct-state.json', JSON.stringify(out, null, 2));

  await browser.close();
})();
