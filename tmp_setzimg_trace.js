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

// Use a Proxy on rspState to trap depthImage writes
let depthSetLog = [];
// Easier: patch the property setter
const realState = rcp.initRspState.bind(rcp);
rcp.initRspState = function() {
    realState();
    const orig = this.rspState;
    let depth = 0;
    Object.defineProperty(orig, 'depthImage', {
        get() { return depth; },
        set(v) {
            if (depthSetLog.length < 30) depthSetLog.push({ val: '0x' + (v>>>0).toString(16), tri: rcp.drawStats.triangles, fr: rcp.drawStats.fillRects });
            depth = v;
        },
        configurable: true,
    });
};
rcp.initRspState();

const STEPS = 25000000;
const t0 = Date.now();
for (let i = 0; i < STEPS; i++) { cpu.step(); if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 25000) break; }
console.log('[setzimg] writes seen:', depthSetLog.length);
for (const d of depthSetLog) console.log('  →', d);
console.log('[setzimg] f3d:', rcp.f3dTaskCount, 'tri:', rcp.drawStats.triangles, 'fillRects:', rcp.drawStats.fillRects);
console.log('[setzimg] segments:', Array.from(rcp.rspState.segments).map(x => '0x'+(x>>>0).toString(16)));
