// Run until a specific F3D task completes, then snapshot the FB it drew into.
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const zlib=require('zlib');
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

// Hook drawTriangle to record per-task triangle counts and dump every few tasks
let lastTaskCount = 0;
const origDraw = rcp.drawTriangle.bind(rcp);
let drawCount = 0;
rcp.drawTriangle = function(v1, v2, v3) {
    drawCount++;
    if (drawCount >= 6 && drawCount <= 50) {
        // Log this triangle's params
        const sx = [v1.x, v2.x, v3.x].map(x => Math.round(x*10)/10);
        const sy = [v1.y, v2.y, v3.y].map(x => Math.round(x*10)/10);
        const sz = [v1.z, v2.z, v3.z].map(x => Math.round(x*1000)/1000);
        const cw = [v1.cw, v2.cw, v3.cw].map(x => Math.round(x*100)/100);
        const r = [v1.r, v2.r, v3.r];
        const g = [v1.g, v2.g, v3.g];
        const b = [v1.b, v2.b, v3.b];
        const useTex = this.rspState.useTexture;
        const ci = '0x' + (this.rspState.colorImage>>>0).toString(16);
        console.log(`#${drawCount} ci=${ci} useTex=${useTex} sx=${sx} sy=${sy} sz=${sz} cw=${cw} r=${r} g=${g} b=${b}`);
    }
    return origDraw(v1, v2, v3);
};

const STEPS = 200000000; const t0 = Date.now();
for (let i = 0; i < STEPS; i++) {
    cpu.step();
    if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 25000) break;
    if (drawCount >= 50) break;
}
console.log('[snap1] f3d:', rcp.f3dTaskCount, 'tri:', rcp.drawStats.triangles, 'fr:', rcp.drawStats.fillRects);
