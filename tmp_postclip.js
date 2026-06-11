const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = __dirname;
const files = ['memory.js', 'mmu.js', 'rcp.js', 'cpu.js'];
let combined = ''; for (const f of files) combined += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n';
combined += '\nthis.__classes = { Memory, MMU, RCP, CPU };\n';
const sandbox = {
    console, setTimeout: () => {}, clearTimeout: () => {},
    performance: { now: () => Date.now() },
    Math, Number, BigInt, JSON, DataView, ArrayBuffer,
    Uint8Array, Uint16Array, Uint32Array,
    Int8Array, Int16Array, Int32Array,
    Float32Array, Float64Array, Array,
};
vm.createContext(sandbox);
vm.runInContext(combined, sandbox, { filename: 'combined-emu.js' });
const { Memory, MMU, RCP, CPU } = sandbox.__classes;
const romBuf = fs.readFileSync(path.join(ROOT, 'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab = romBuf.buffer.slice(romBuf.byteOffset, romBuf.byteOffset + romBuf.byteLength);
const FB_W=320, FB_H=240;
const framebuffer = new sandbox.Uint8Array(FB_W*FB_H*4);
const ram = new Memory(8 * 1024 * 1024);
const mmu = new MMU(ram);
const rcp = new RCP(mmu, framebuffer);
const cpu = new CPU(mmu, rcp);
mmu.cpu = cpu; mmu.rcp = rcp; ram.loadRom(ab);
cpu.isRunning = true;
if (!cpu.isHleBootDone) cpu.performHleBoot();

// Hook rasterizeTriangle to record post-clip triangles
const postClip = [];
let count = 0;
const origRast = rcp.rasterizeTriangle.bind(rcp);
rcp.rasterizeTriangle = function(v1, v2, v3, addr) {
    count++;
    if (postClip.length < 30 && count > 50) {
        postClip.push({
            n: count,
            x: [v1.x, v2.x, v3.x].map(x=>Math.round(x*10)/10),
            y: [v1.y, v2.y, v3.y].map(x=>Math.round(x*10)/10),
            r: [v1.r|0, v2.r|0, v3.r|0],
            g: [v1.g|0, v2.g|0, v3.g|0],
            b: [v1.b|0, v2.b|0, v3.b|0],
        });
    }
    return origRast(v1, v2, v3, addr);
};

const STEPS = 200000000; const t0 = Date.now();
for (let i = 0; i < STEPS; i++) { cpu.step(); if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 25000) break; if (count >= 200) break; }
console.log('[postclip] f3d:', rcp.f3dTaskCount, 'tri:', rcp.drawStats.triangles, 'offscreen:', rcp.drawStats.offscreenTriangles||0);
console.log('[postclip] sample post-clip triangles:');
for (const t of postClip) {
    const bx = Math.min(...t.x), Bx = Math.max(...t.x);
    const by = Math.min(...t.y), By = Math.max(...t.y);
    console.log(`#${t.n} x=${t.x} y=${t.y} bbox=${(Bx-bx).toFixed(1)}x${(By-by).toFixed(1)} colors=[(${t.r[0]},${t.g[0]},${t.b[0]}),(${t.r[1]},${t.g[1]},${t.b[1]}),(${t.r[2]},${t.g[2]},${t.b[2]})]`);
}
