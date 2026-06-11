// Dump first N triangles' clip-space coords and final screen-space coords,
// plus a histogram of their bounding boxes after rasterization.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const ROM_PATH = path.join(ROOT, 'Super Mario 64 (Europe) (En,Fr,De).n64');

const files = ['memory.js', 'mmu.js', 'rcp.js', 'cpu.js'];
let combined = '';
for (const f of files) combined += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n';
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

const romBuf = fs.readFileSync(ROM_PATH);
const ab = romBuf.buffer.slice(romBuf.byteOffset, romBuf.byteOffset + romBuf.byteLength);

const FB_W = 320, FB_H = 240;
const framebuffer = new sandbox.Uint8Array(FB_W * FB_H * 4);
const ram = new Memory(8 * 1024 * 1024);
const mmu = new MMU(ram);
const rcp = new RCP(mmu, framebuffer);
const cpu = new CPU(mmu, rcp);
mmu.cpu = cpu; mmu.rcp = rcp;
ram.loadRom(ab);
cpu.isRunning = true;
if (!cpu.isHleBootDone) cpu.performHleBoot();

// Wrap drawTriangle to capture inputs.
const capLimit = 30;
const captures = [];
const histogram = new Array(8).fill(0);  // binned max(|x|, |y|) ranges
const origDraw = rcp.drawTriangle.bind(rcp);
rcp.drawTriangle = function(v1, v2, v3) {
    if (captures.length < capLimit) {
        captures.push({
            cnt: captures.length,
            v1: { cx: v1.cx, cy: v1.cy, cz: v1.cz, cw: v1.cw, sx: v1.x, sy: v1.y, sz: v1.z },
            v2: { cx: v2.cx, cy: v2.cy, cz: v2.cz, cw: v2.cw, sx: v2.x, sy: v2.y, sz: v2.z },
            v3: { cx: v3.cx, cy: v3.cy, cz: v3.cz, cw: v3.cw, sx: v3.x, sy: v3.y, sz: v3.z },
            gm: this.rspState.geometryMode >>> 0,
            tex: !!this.rspState.useTexture,
        });
    }
    const m = Math.max(Math.abs(v1.x), Math.abs(v1.y), Math.abs(v2.x), Math.abs(v2.y), Math.abs(v3.x), Math.abs(v3.y));
    let bin = 0;
    if (m > 320) bin = 1;
    if (m > 1000) bin = 2;
    if (m > 3000) bin = 3;
    if (m > 10000) bin = 4;
    if (m > 30000) bin = 5;
    if (m > 100000) bin = 6;
    if (m > 1000000) bin = 7;
    histogram[bin]++;
    return origDraw(v1, v2, v3);
};

const STEPS = 25000000;
const t0 = Date.now();
for (let i = 0; i < STEPS; i++) {
    cpu.step();
    if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 30000) break;
}
console.log('[dump] triangles drawn:', rcp.drawStats && rcp.drawStats.triangles);
console.log('[dump] f3d tasks:', rcp.f3dTaskCount);
console.log('[dump] histogram of max(|sx|,|sy|):');
console.log('  in-frame (<=320):', histogram[0]);
console.log('  modest (320-1000):', histogram[1]);
console.log('  large (1000-3000):', histogram[2]);
console.log('  huge (3000-10000):', histogram[3]);
console.log('  massive (10000-30000):', histogram[4]);
console.log('  ridiculous (30000-100000):', histogram[5]);
console.log('  absurd (100000-1e6):', histogram[6]);
console.log('  insane (>1e6):', histogram[7]);

console.log('[dump] first', captures.length, 'triangles:');
for (const c of captures) {
    const fmt = (v) => `cw=${v.cw.toFixed(3)} | s=(${v.sx.toFixed(1)},${v.sy.toFixed(1)})`;
    console.log(`#${c.cnt} gm=0x${c.gm.toString(16)} tex=${c.tex}`);
    console.log(`  v1 ${fmt(c.v1)}`);
    console.log(`  v2 ${fmt(c.v2)}`);
    console.log(`  v3 ${fmt(c.v3)}`);
}
