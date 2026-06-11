const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = __dirname;
const files = ['memory.js', 'mmu.js', 'rcp.js', 'cpu.js'];
let combined = ''; for (const f of files) combined += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n';
combined += '\nthis.__classes = { Memory, MMU, RCP, CPU };\n';
const sandbox = { console, setTimeout: () => {}, clearTimeout: () => {}, performance: { now: () => Date.now() }, Math, Number, BigInt, JSON, DataView, ArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, Array };
vm.createContext(sandbox); vm.runInContext(combined, sandbox, { filename: 'combined-emu.js' });
const { Memory, MMU, RCP, CPU } = sandbox.__classes;
const romBuf = fs.readFileSync(path.join(ROOT, 'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab = romBuf.buffer.slice(romBuf.byteOffset, romBuf.byteOffset + romBuf.byteLength);
const FB_W=320, FB_H=240;
const framebuffer = new sandbox.Uint8Array(FB_W*FB_H*4);
const ram = new Memory(8 * 1024 * 1024); const mmu = new MMU(ram); const rcp = new RCP(mmu, framebuffer); const cpu = new CPU(mmu, rcp);
mmu.cpu = cpu; mmu.rcp = rcp; ram.loadRom(ab);
cpu.isRunning = true; if (!cpu.isHleBootDone) cpu.performHleBoot();

// Original combiner gets shade and tex from rasterizer. Wrap the rasterizer 
// itself instead so we can intercept the final FB write more directly.
const origRast = rcp.rasterizeTriangle.bind(rcp);
let interceptCount = 0;
rcp.rasterizeTriangle = function(v1, v2, v3, addr) {
    interceptCount++;
    return origRast(v1, v2, v3, addr);
};

let nonZeroWrites = 0;
let totalFBWrites = 0;
const origSetU16 = DataView.prototype.setUint16;
DataView.prototype.setUint16 = function(off, v, le) {
    if (off >= 0x38f800 && off < 0x3da800) {
        totalFBWrites++;
        if (v !== 0 && v !== 0x0001 && nonZeroWrites < 10) {
            console.log(`  FB[0x${off.toString(16)}] = 0x${v.toString(16)} (tri ${interceptCount})`);
            nonZeroWrites++;
        }
    }
    return origSetU16.call(this, off, v, le);
};

const STEPS = 200000000; const t0 = Date.now();
for (let i = 0; i < STEPS; i++) { cpu.step(); if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 30000) break; if ((i & 0xFFFF) === 0 && rcp.f3dTaskCount >= 96) break; }
console.log('total FB writes:', totalFBWrites, 'nonzero (not 0 or 1):', nonZeroWrites);
console.log('f3d:', rcp.f3dTaskCount, 'tri:', rcp.drawStats.triangles);
