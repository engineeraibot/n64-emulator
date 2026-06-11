const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
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

const romBuf = fs.readFileSync(path.join(ROOT, 'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab = romBuf.buffer.slice(romBuf.byteOffset, romBuf.byteOffset + romBuf.byteLength);

const FB_W=320, FB_H=240;
const framebuffer = new sandbox.Uint8Array(FB_W*FB_H*4);
const ram = new Memory(8 * 1024 * 1024);
const mmu = new MMU(ram);
const rcp = new RCP(mmu, framebuffer);
const cpu = new CPU(mmu, rcp);
mmu.cpu = cpu; mmu.rcp = rcp;
ram.loadRom(ab);
cpu.isRunning = true;
if (!cpu.isHleBootDone) cpu.performHleBoot();

// Patch read32 to trap reads of SETZIMG opcode words
const origPDL = rcp.processDisplayList.bind(rcp);
const setzImgSamples = [];
const setCImgSamples = [];
const origRead32 = mmu.read32.bind(mmu);
let lastHi = 0, lastLoAddr = 0;
rcp.processDisplayList = function(addr, dataSize) {
    // Patch the DL processing to capture SETZIMG/SETCIMG
    if (!this.rspState) this.initRspState();
    let pc = addr, depth = 0, stack = [];
    let cnt = 0;
    while (pc !== 0 && cnt < 100000) {
        cnt++;
        const hi = mmu.read32(Number(pc));
        const lo = mmu.read32(Number(pc + 4));
        const cmd = (hi >>> 24) & 0xFF;
        if (cmd === 0xFE && setzImgSamples.length < 10) {
            setzImgSamples.push({ pc: '0x'+pc.toString(16), hi: '0x'+(hi>>>0).toString(16), lo: '0x'+(lo>>>0).toString(16), segs: Array.from(this.rspState.segments).map(s=>'0x'+(s>>>0).toString(16)) });
        }
        if (cmd === 0xFF && setCImgSamples.length < 10) {
            setCImgSamples.push({ pc: '0x'+pc.toString(16), hi: '0x'+(hi>>>0).toString(16), lo: '0x'+(lo>>>0).toString(16) });
        }
        pc += 8;
        // Forward to real handler by reseating pc
        // Easiest: just call origPDL once for the whole thing — but that consumes everything
        if (cnt > 50000) break;
        // Simulate normal processing by terminating on ENDDL
        if (cmd === 0xDF) {
            if (depth > 0) { depth--; pc = stack.pop(); }
            else return;
        }
        if (cmd === 0x06) {
            const next = this.resolveAddress(lo);
            const push = (((hi >>> 16) & 0xFF) === 0);
            if (push) { if (depth < 16) { stack.push(pc); depth++; } }
            pc = next;
        }
    }
};

const STEPS = 25000000;
const t0 = Date.now();
for (let i = 0; i < STEPS; i++) { cpu.step(); if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 25000) break; }
console.log('[raw] SETZIMG samples:', setzImgSamples.length);
for (const s of setzImgSamples) console.log(' ', s);
console.log('[raw] SETCIMG samples:', setCImgSamples.length);
for (const s of setCImgSamples) console.log(' ', s);
console.log('[raw] f3d tasks:', rcp.f3dTaskCount);
