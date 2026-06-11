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

// Hook FILLRECT to record rects
const fillRects = [];
const origFill = rcp.handleG_FILLRECT.bind(rcp);
rcp.handleG_FILLRECT = function(hi, lo) {
    const x1 = ((lo >>> 12) & 0xFFF) / 4, y1 = (lo & 0xFFF) / 4;
    const x2 = ((hi >>> 12) & 0xFFF) / 4, y2 = (hi & 0xFFF) / 4;
    fillRects.push({
        ci: '0x' + (this.rspState.colorImage>>>0).toString(16),
        fc: '0x' + (this.rspState.fillColor>>>0).toString(16),
        cs: this.rspState.colorImageSize,
        cw: this.rspState.colorImageWidth,
        x1, y1, x2, y2,
    });
    return origFill(hi, lo);
};

// Track unusual rectangle sizes
const STEPS = 200000000; const t0 = Date.now();
for (let i = 0; i < STEPS; i++) {
    cpu.step();
    if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 35000) break;
    if ((i & 0xFFFF) === 0 && rcp.f3dTaskCount >= 96) break;
}
// Show only suspicious / large fills targeting framebuffers
const fbRange = (s) => s === '0x38f800' || s === '0x3b5000' || s === '0x3da800';
console.log('[stripe] f3d:', rcp.f3dTaskCount, 'tri:', rcp.drawStats.triangles, 'fr:', fillRects.length);
let shown = 0;
for (const r of fillRects) {
    if (!fbRange(r.ci)) continue;
    const w = r.x2 - r.x1, h = r.y2 - r.y1;
    if (w > 100 || h > 100) {
        if (shown++ < 20) console.log(' ', r);
    }
}
console.log('total FB fillrects (incl. small):', fillRects.filter(r => fbRange(r.ci)).length);
