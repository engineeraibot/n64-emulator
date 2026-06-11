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

const seq = [];
let triCount = 0;
const origDraw = rcp.drawTriangle.bind(rcp);
rcp.drawTriangle = function(v1, v2, v3) {
    triCount++;
    if (seq.length < 50 && (triCount % 200) === 1)
        seq.push({ kind: 'tri', n: triCount, ci: '0x'+(this.rspState.colorImage>>>0).toString(16) });
    return origDraw(v1, v2, v3);
};
const origFill = rcp.handleG_FILLRECT.bind(rcp);
rcp.handleG_FILLRECT = function(hi, lo) {
    if (seq.length < 50) seq.push({ kind: 'fill', tri: triCount, ci: '0x'+(this.rspState.colorImage>>>0).toString(16), fc: '0x'+(this.rspState.fillColor>>>0).toString(16) });
    return origFill(hi, lo);
};

const STEPS = 200000000; const t0 = Date.now();
for (let i = 0; i < STEPS; i++) { cpu.step(); if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 30000) break; if (seq.length >= 50) break; }
for (const s of seq) console.log(JSON.stringify(s));
