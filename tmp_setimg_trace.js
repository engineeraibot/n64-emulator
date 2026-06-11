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

// Patch executeRdpCommand to log SETZIMG/SETCIMG values
const origExec = rcp.executeRdpCommand.bind(rcp);
const seen = [];
rcp.executeRdpCommand = function(hi, lo, addr) {
    const cmd = (hi >>> 24) & 0x3F;
    if (cmd === 0x3E || cmd === 0x3F) {
        const segs = Array.from(this.rspState.segments).map(x => '0x' + (x>>>0).toString(16));
        if (seen.length < 40) seen.push({ cmd: cmd === 0x3E ? 'SETZIMG' : 'SETCIMG', hi: '0x'+(hi>>>0).toString(16), lo: '0x'+(lo>>>0).toString(16), resolved: '0x' + (this.resolvePhysicalAddress(lo) & 0x7FFFFF).toString(16) });
    }
    return origExec(hi, lo, addr);
};

const STEPS = 25000000;
const t0 = Date.now();
for (let i = 0; i < STEPS; i++) { cpu.step(); if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 25000) break; }
console.log('[setimg] seen', seen.length);
for (const s of seen) console.log(' ', s.cmd, 'hi='+s.hi, 'lo='+s.lo, '→resolved='+s.resolved);
console.log('[setimg] f3d:', rcp.f3dTaskCount, 'tri:', rcp.drawStats.triangles);
console.log('[setimg] segments:', Array.from(rcp.rspState.segments).map(x => '0x'+(x>>>0).toString(16)));
