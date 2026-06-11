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

const fillTraces = [];
const setzTraces = [];
const setcTraces = [];
const origFill = rcp.handleG_FILLRECT.bind(rcp);
rcp.handleG_FILLRECT = function(hi, lo) {
    if (fillTraces.length < 40) {
        fillTraces.push({
            colorImage: '0x' + (this.rspState.colorImage >>> 0).toString(16),
            depthImage: '0x' + ((this.rspState.depthImage >>> 0) || 0).toString(16),
            fillColor: '0x' + (this.rspState.fillColor >>> 0).toString(16),
            colorSize: this.rspState.colorImageSize,
            colorWidth: this.rspState.colorImageWidth,
            x1: (lo >>> 12) & 0xFFF, y1: lo & 0xFFF,
            x2: (hi >>> 12) & 0xFFF, y2: hi & 0xFFF,
            tri: rcp.drawStats.triangles,
        });
    }
    return origFill(hi, lo);
};

// Trace handleRdpCommand 0x3E (SETZIMG) and 0x3F (SETCIMG)
const origRdp = rcp.handleRdpCommand && rcp.handleRdpCommand.bind(rcp);

const STEPS = 25000000;
const t0 = Date.now();
for (let i = 0; i < STEPS; i++) {
    cpu.step();
    if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 25000) break;
}
console.log('[fill] triangles:', rcp.drawStats.triangles, 'fillRects:', rcp.drawStats.fillRects);
console.log('[fill] f3d tasks:', rcp.f3dTaskCount);
console.log('[fill] traced fills (first', fillTraces.length, '):');
for (let i = 0; i < fillTraces.length; i++) {
    const f = fillTraces[i];
    console.log(`#${i} CI=${f.colorImage} Z=${f.depthImage} fc=${f.fillColor} sz=${f.colorSize} w=${f.colorWidth} rect=(${f.x1/4},${f.y1/4})-(${f.x2/4},${f.y2/4}) triBefore=${f.tri}`);
}
