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

// Force visible output
rcp.sampleTexture = function() { return { r: 255, g: 255, b: 255, a: 255 }; };
rcp.combineColor = function(shade, tex) { return { r: 200, g: 100, b: 50, a: 255 }; };  // bright orange

const STEPS = 200000000; const t0 = Date.now();
for (let i = 0; i < STEPS; i++) { cpu.step(); if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 35000) break; if ((i & 0xFFFF) === 0 && rcp.f3dTaskCount >= 96) break; }
console.log('[chk] f3d:', rcp.f3dTaskCount, 'tri:', rcp.drawStats.triangles);

const rd = new DataView(ram.rdram);
// Check FB 0x38f800 first 8 pixels of row 50
for (const fb of [0x38f800, 0x3b5000, 0x3da800]) {
    const base = fb + 50 * 320 * 2;
    const vals = [];
    for (let i = 0; i < 16; i++) {
        const v = (rd.getUint8(base + i*2) << 8) | rd.getUint8(base + i*2 + 1);
        vals.push('0x' + v.toString(16).padStart(4, '0'));
    }
    console.log(`FB 0x${fb.toString(16)} row 50 first 16: ${vals.join(' ')}`);
    
    // Count distinct pixel values
    const counts = new Map();
    for (let i = 0; i < 320 * 240; i++) {
        const v = (rd.getUint8(fb + i*2) << 8) | rd.getUint8(fb + i*2 + 1);
        counts.set(v, (counts.get(v) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`  Top 5 values in FB 0x${fb.toString(16)}: ${sorted.map(([v,c]) => '0x'+v.toString(16)+':'+c).join(', ')}`);
}
