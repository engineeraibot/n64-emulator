const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:8000/index.html');
  const targetF3DTasks = Number(process.env.WAIT_F3D_TASKS || 96);
  try {
    await page.waitForFunction((target) => {
      const rcp = window.rcp;
      return !!rcp && (rcp.f3dTaskCount || 0) >= target;
    }, targetF3DTasks, { timeout: 45000 });
  } catch (_) {
    // Fall back to a bounded delay if the target task count is never reached.
    await page.waitForTimeout(5000);
  }
  await page.screenshot({ path: 'test-results/tmp-after-loadblock-fix.png', fullPage: true });

  const state = await page.evaluate(() => {
    const rcp = window.rcp;
    const rsp = rcp?.rspState || {};
    const ds = rcp?.drawStats || {};
    const rowWrites = Array.from(ds.rowWrites || []);
    let firstRow = -1;
    let lastRow = -1;
    let totalRowWrites = 0;
    for (let i = 0; i < rowWrites.length; i++) {
      const n = rowWrites[i] | 0;
      totalRowWrites += n;
      if (n > 0) {
        if (firstRow === -1) firstRow = i;
        lastRow = i;
      }
    }
    const rd = new DataView(window.mmu.memory.rdram);

    const decode5551 = (v) => ({
      r: ((v >> 11) & 0x1F) << 3,
      g: ((v >> 6) & 0x1F) << 3,
      b: ((v >> 1) & 0x1F) << 3,
      a: (v & 1) ? 255 : 0
    });

    const drawFrame = (origin, width, type) => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(320, 240);
      const bpp = type === 3 ? 4 : 2;
      let p = 0;
      for (let y = 0; y < 240; y++) {
        for (let x = 0; x < 320; x++) {
          const a = (origin + (y * width + x) * bpp) & 0x7FFFFF;
          if (type === 2) {
            const v = (rd.getUint8(a) << 8) | rd.getUint8((a + 1) & 0x7FFFFF);
            const c = decode5551(v);
            img.data[p++] = c.r;
            img.data[p++] = c.g;
            img.data[p++] = c.b;
            img.data[p++] = 255;
          } else {
            img.data[p++] = rd.getUint8(a);
            img.data[p++] = rd.getUint8((a + 1) & 0x7FFFFF);
            img.data[p++] = rd.getUint8((a + 2) & 0x7FFFFF);
            img.data[p++] = 255;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL('image/png');
    };

    const history = (rcp?.videoTargetHistory || []).slice(-24);
    const unique = [];
    const seen = new Set();
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      const key = `${h.origin}:${h.width}:${h.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({
        origin: h.origin,
        width: h.width,
        type: h.type,
        sequence: h.sequence,
        dataUrl: drawFrame(h.origin, h.width, h.type),
        rgba8888DataUrl: drawFrame(h.origin, h.width, 3)
      });
      if (unique.length >= 4) break;
    }
    const tile0 = rsp.tiles?.[0] || {};
    const tileW = Math.max(1, Math.floor(((tile0.lrs || 0) - (tile0.uls || 0)) / 4) + 1);
    const tileH = Math.max(1, Math.floor(((tile0.lrt || 0) - (tile0.ult || 0)) / 4) + 1);

    const dumpTile0DataUrl = (() => {
      const tmem = rcp?.tmem;
      if (!tmem || tileW <= 0 || tileH <= 0) return null;
      const canvas = document.createElement('canvas');
      canvas.width = tileW;
      canvas.height = tileH;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(tileW, tileH);
      const lineBytes = (tile0.line || 0) * 8;
      const tmemBase = (tile0.tmem || 0) * 8;
      let p = 0;
      for (let y = 0; y < tileH; y++) {
        for (let x = 0; x < tileW; x++) {
          const off = tmemBase + y * lineBytes + x * 2;
          if (off + 1 < tmem.length) {
            const v = (tmem[off] << 8) | tmem[off + 1];
            img.data[p++] = ((v >> 11) & 0x1F) << 3;
            img.data[p++] = ((v >> 6) & 0x1F) << 3;
            img.data[p++] = ((v >> 1) & 0x1F) << 3;
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
      const out = document.createElement('canvas');
      out.width = tileW * 16;
      out.height = tileH * 16;
      const outCtx = out.getContext('2d');
      outCtx.imageSmoothingEnabled = false;
      outCtx.drawImage(canvas, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    })();

    return {
      instr: Number(window.cpu?.instructionCount || 0),
      rspTaskCount: rcp?.rspTaskCount || 0,
      f3dTaskCount: rcp?.f3dTaskCount || 0,
      f3dex2TaskCount: rcp?.f3dex2TaskCount || 0,
      displayListAbortCount: rcp?.displayListAbortCount || 0,
      displayListReturnCount: rcp?.displayListReturnCount || 0,
      rdpCommandCount: rcp?.rdpCommandCount || 0,
      drawStats: {
        triangles: ds.triangles || 0,
        texturedTriangles: ds.texturedTriangles || 0,
        untexturedTriangles: ds.untexturedTriangles || 0,
        textureEnabledTriangles: ds.textureEnabledTriangles || 0,
        textureDisabledTriangles: ds.textureDisabledTriangles || 0,
        fillRects: ds.fillRects || 0,
        texRects: ds.texRects || 0,
        minX: ds.minX,
        minY: ds.minY,
        maxX: ds.maxX,
        maxY: ds.maxY,
        firstRow,
        lastRow,
        totalRowWrites
      },
      dlOpcodeHistogram: rcp?.dlOpcodeHistogram || null,
      dlSamples: rcp?.dlSamples || null,
      taskTypeHistogram: rcp?.taskTypeHistogram || null,
      vi: {
        origin: window.mmu?.viRegisters?.[1] & 0x7FFFFF,
        width: window.mmu?.viRegisters?.[2] & 0xFFF,
        type: window.mmu?.viRegisters?.[0] & 0x3,
        vStart: window.mmu?.viRegisters?.[10] >>> 0,
        yScale: window.mmu?.viRegisters?.[13] >>> 0,
      },
      viDataUrl: drawFrame(
        window.mmu?.viRegisters?.[1] & 0x7FFFFF,
        window.mmu?.viRegisters?.[2] & 0xFFF,
        window.mmu?.viRegisters?.[0] & 0x3
      ),
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
      viewport: rsp.viewport || null,
      geometryMode: rsp.geometryMode >>> 0,
      combine: rsp.combine || null,
      otherMode: {
        hi: rsp.otherModeHi >>> 0,
        lo: rsp.otherModeLo >>> 0
      },
      currentTile: rsp.currentTile | 0,
      segments: Array.from(rsp.segments || []),
      tile0WH: { w: tileW, h: tileH },
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
      verticesHead: (rsp.vertices || []).slice(0, 24).map((v, idx) => ({
        idx,
        x: v?.x,
        y: v?.y,
        z: v?.z,
        w: v?.w,
        r: v?.r,
        g: v?.g,
        b: v?.b,
        a: v?.a,
        s: v?.s,
        t: v?.t
      })),
      latestVideoTarget: rcp?.latestVideoTarget || null,
      historyTail: (rcp?.videoTargetHistory || []).slice(-12),
      textureSampleStats: rcp?.textureSampleStats ? {
        calls: rcp.textureSampleStats.calls || 0,
        oob: rcp.textureSampleStats.oob || 0,
        maxAbsS: rcp.textureSampleStats.maxAbsS || 0,
        maxAbsT: rcp.textureSampleStats.maxAbsT || 0,
        tileCalls: Array.from(rcp.textureSampleStats.tileCalls || [])
      } : null,
      tile0DataUrl: dumpTile0DataUrl,
      uniqueHistoryFrames: unique,
      screenDataUrl: document.getElementById('screen')?.toDataURL('image/png') || null
    };
  });

  fs.writeFileSync('test-results/tmp-inspect-state.json', JSON.stringify(state, null, 2));
  if (state.tile0DataUrl) {
    const base64 = state.tile0DataUrl.split(',')[1];
    fs.writeFileSync('test-results/tmp-tile0.png', Buffer.from(base64, 'base64'));
  }
  if (state.screenDataUrl) {
    const base64 = state.screenDataUrl.split(',')[1];
    fs.writeFileSync('test-results/tmp-screen-canvas.png', Buffer.from(base64, 'base64'));
  }
  if (state.viDataUrl) {
    const base64 = state.viDataUrl.split(',')[1];
    fs.writeFileSync('test-results/tmp-vi-direct.png', Buffer.from(base64, 'base64'));
  }
  if (Array.isArray(state.uniqueHistoryFrames)) {
    for (let i = 0; i < state.uniqueHistoryFrames.length; i++) {
      const f = state.uniqueHistoryFrames[i];
      if (!f.dataUrl) continue;
      const base64 = f.dataUrl.split(',')[1];
      const hex = (f.origin >>> 0).toString(16).padStart(6, '0');
      fs.writeFileSync(`test-results/tmp-frame-${i + 1}-${hex}.png`, Buffer.from(base64, 'base64'));
      if (f.rgba8888DataUrl) {
        const rgba64 = f.rgba8888DataUrl.split(',')[1];
        fs.writeFileSync(`test-results/tmp-frame-${i + 1}-${hex}-rgba8888.png`, Buffer.from(rgba64, 'base64'));
      }
      delete f.dataUrl;
      delete f.rgba8888DataUrl;
    }
  }
  console.log(JSON.stringify({
    instr: state.instr,
    rspTaskCount: state.rspTaskCount,
    f3dTaskCount: state.f3dTaskCount,
    f3dex2TaskCount: state.f3dex2TaskCount,
    displayListAbortCount: state.displayListAbortCount,
    displayListReturnCount: state.displayListReturnCount,
    rdpCommandCount: state.rdpCommandCount,
    drawStats: state.drawStats,
    vi: state.vi,
    colorImage: state.colorImage,
    textureImage: state.textureImage,
    currentTile: state.currentTile
  }, null, 2));

  await browser.close();
})();
