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

// Track FB targets used by tris and by fillrects
const triTargets = new Map();
const fillTargets = new Map();
const setcimgValues = [];
let badSetcImg = 0;

const origDraw = rcp.drawTriangle.bind(rcp);
rcp.drawTriangle = function(v1, v2, v3) {
    const k = '0x' + (this.rspState.colorImage>>>0).toString(16);
    triTargets.set(k, (triTargets.get(k) || 0) + 1);
    return origDraw(v1, v2, v3);
};
const origFill = rcp.handleG_FILLRECT.bind(rcp);
rcp.handleG_FILLRECT = function(hi, lo) {
    const k = '0x' + (this.rspState.colorImage>>>0).toString(16);
    fillTargets.set(k, (fillTargets.get(k) || 0) + 1);
    return origFill(hi, lo);
};

const origPDL = rcp.processDisplayList.bind(rcp);
const cnt = { setcimg: 0, ok: 0, bad: 0 };
const origRead32 = mmu.read32.bind(mmu);
// Patch to track SETCIMG width values
// Just intercept by wrapping
const origInit = rcp.initRspState.bind(rcp);
rcp.initRspState = function() {
    origInit();
    let cw = this.rspState.colorImageWidth;
    Object.defineProperty(this.rspState, 'colorImageWidth', {
        get() { return cw; },
        set(v) {
            if (v <= 0 || v > 1024) {
                if (badSetcImg < 8) {
                    setcimgValues.push({ kind: 'bad', val: v, tri: rcp.drawStats.triangles });
                }
                badSetcImg++;
            }
            cw = v;
        },
        configurable: true
    });
};
rcp.initRspState();

const STEPS = 25000000;
const t0 = Date.now();
for (let i = 0; i < STEPS; i++) { cpu.step(); if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 25000) break; }
console.log('[overdraw] f3d:', rcp.f3dTaskCount, 'tri:', rcp.drawStats.triangles);
console.log('[overdraw] triangle target FBs:');
for (const [k, n] of triTargets) console.log('  ', k, '→', n, 'triangles');
console.log('[overdraw] fillrect target FBs:');
for (const [k, n] of fillTargets) console.log('  ', k, '→', n, 'fillrects');
console.log('[overdraw] bad colorImageWidth assignments:', badSetcImg);
for (const s of setcimgValues) console.log('  ', s);
