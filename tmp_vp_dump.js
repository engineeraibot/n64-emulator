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

// Capture viewport changes and first-triangle viewport state
const vpChanges = [];
const origMovemem = rcp.handleG_MOVEMEM.bind(rcp);
rcp.handleG_MOVEMEM = function(hi, lo) {
    const idx = (hi >>> 16) & 0xFF;
    const out = origMovemem(hi, lo);
    if (idx === 0x01 || idx === 0x08 || idx === 0x80) {
        const vp = this.rspState.viewport;
        if (vpChanges.length < 6) {
            vpChanges.push({ idx, scale: [...vp.scale], trans: [...vp.trans] });
        }
    }
    return out;
};

let firstTriVp = null;
let firstTri10 = [];
const origDraw = rcp.drawTriangle.bind(rcp);
rcp.drawTriangle = function(v1, v2, v3) {
    if (firstTriVp === null) {
        firstTriVp = this.rspState.viewport ? { scale: [...this.rspState.viewport.scale], trans: [...this.rspState.viewport.trans] } : null;
    }
    if (firstTri10.length < 10) {
        firstTri10.push({
            cw: [v1.cw, v2.cw, v3.cw],
            cx: [v1.cx, v2.cx, v3.cx],
            cy: [v1.cy, v2.cy, v3.cy],
            sx: [v1.x, v2.x, v3.x],
            sy: [v1.y, v2.y, v3.y],
            ciW: this.rspState.colorImageWidth,
        });
    }
    return origDraw(v1, v2, v3);
};

const STEPS = 25000000;
const t0 = Date.now();
for (let i = 0; i < STEPS; i++) {
    cpu.step();
    if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 30000) break;
    if ((i & 0xFFFF) === 0 && (rcp.drawStats && rcp.drawStats.triangles | 0) >= 10) {
        // give the harness a bit more time after first triangles
        if ((Date.now() - t0) > 3000) break;
    }
}

console.log('[vp] viewport changes recorded:', vpChanges.length);
for (const c of vpChanges) console.log('  idx=0x' + c.idx.toString(16), 'scale=', c.scale, 'trans=', c.trans);
console.log('[vp] viewport at first triangle:', firstTriVp);
console.log('[vp] first', firstTri10.length, 'triangles colorImageWidth =', firstTri10[0] && firstTri10[0].ciW);
for (let i = 0; i < firstTri10.length; i++) {
    const t = firstTri10[i];
    console.log(`  #${i} cw=${t.cw.map(x=>x.toFixed(2))} cx=${t.cx.map(x=>x.toFixed(1))} cy=${t.cy.map(x=>x.toFixed(1))}  sx=${t.sx.map(x=>x.toFixed(1))} sy=${t.sy.map(x=>x.toFixed(1))}`);
}
console.log('[vp] triangles drawn:', rcp.drawStats && rcp.drawStats.triangles);
console.log('[vp] f3d tasks:', rcp.f3dTaskCount);
console.log('[vp] colorImage:', '0x' + (rcp.rspState.colorImage>>>0).toString(16),
    'depthImage:', '0x' + (rcp.rspState.depthImage>>>0).toString(16),
    'width:', rcp.rspState.colorImageWidth);
