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

// Patch setUint16/setUint32 on the rdram view used inside rasterizeTriangle
// by intercepting at the DataView prototype level.
const origSetU16 = DataView.prototype.setUint16;
const origSetU32 = DataView.prototype.setUint32;
let writes16 = 0, writes32 = 0;
let writes16FB = { '0x38f800': 0, '0x3b5000': 0, '0x3da800': 0, 'zbuf': 0, 'other': 0 };
DataView.prototype.setUint16 = function(off, v, le) {
    writes16++;
    if (off >= 0x400 && off < 0x25c00) writes16FB.zbuf++;
    else if (off >= 0x38f800 && off < 0x3b5000) writes16FB['0x38f800']++;
    else if (off >= 0x3b5000 && off < 0x3da800) writes16FB['0x3b5000']++;
    else if (off >= 0x3da800 && off < 0x400000) writes16FB['0x3da800']++;
    else writes16FB.other++;
    return origSetU16.call(this, off, v, le);
};
DataView.prototype.setUint32 = function(off, v, le) { writes32++; return origSetU32.call(this, off, v, le); };

const STEPS = 200000000; const t0 = Date.now();
for (let i = 0; i < STEPS; i++) { cpu.step(); if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 35000) break; if ((i & 0xFFFF) === 0 && rcp.f3dTaskCount >= 96) break; }
console.log('[w2] f3d:', rcp.f3dTaskCount, 'tri:', rcp.drawStats.triangles);
console.log('[w2] setUint16 calls:', writes16, 'setUint32 calls:', writes32);
console.log('[w2] FB region writes:', writes16FB);
