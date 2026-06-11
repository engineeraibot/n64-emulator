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

// Patch rasterizeTriangle to LOG writes to FB
const writes = { tri: 0, fill: 0, other: 0 };
const origRast = rcp.rasterizeTriangle.bind(rcp);
rcp.rasterizeTriangle = function(v1, v2, v3, addr) {
    // We'll wrap setUint16 within the call. Replace rdram view with a proxy view.
    const origMem = this.mmu.memory.rdram;
    return origRast.call(this, v1, v2, v3, addr);
};

// Track FB writes via DMA / mmu.write32. Intercept MMU writes:
const origW8 = mmu.memory.write8.bind(mmu.memory);
const origW16 = mmu.memory.write16.bind(mmu.memory);
const origW32 = mmu.memory.write32.bind(mmu.memory);
let totalRDRAMwrites = 0;
let fbWrites38f = 0, fbWrites3b5 = 0, fbWrites3da = 0;
const fbBase = (a) => {
    const m = a & 0x7FFFFF;
    if (m >= 0x38f800 && m < 0x3b5000) return '0x38f800';
    if (m >= 0x3b5000 && m < 0x3da800) return '0x3b5000';
    if (m >= 0x3da800 && m < 0x400000) return '0x3da800';
    return null;
};
const fbBuckets = { '0x38f800': 0, '0x3b5000': 0, '0x3da800': 0 };
mmu.memory.write8 = function(a, v) { const f = fbBase(a); if (f) fbBuckets[f]++; return origW8(a, v); };
mmu.memory.write16 = function(a, v) { const f = fbBase(a); if (f) fbBuckets[f]++; return origW16(a, v); };
mmu.memory.write32 = function(a, v) { const f = fbBase(a); if (f) fbBuckets[f] += 2; return origW32(a, v); };

const STEPS = 200000000; const t0 = Date.now();
for (let i = 0; i < STEPS; i++) {
    cpu.step();
    if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 35000) break;
    if ((i & 0xFFFF) === 0 && rcp.f3dTaskCount >= 100) break;
}
console.log('[fbw] f3d:', rcp.f3dTaskCount, 'tri:', rcp.drawStats.triangles);
console.log('[fbw] FB write counts via mmu writers:', fbBuckets);
console.log('[fbw] note: rasterizeTriangle uses DataView directly so its writes are NOT counted here');
