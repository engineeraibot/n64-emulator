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

// Trace combiner outputs for first 20 pixels of first 5 triangles
const samples = [];
const origRast = rcp.rasterizeTriangle.bind(rcp);
let triCount = 0;
rcp.rasterizeTriangle = function(v1, v2, v3, addr) {
    triCount++;
    if (samples.length < 5 && triCount > 50) {
        // Sample center of triangle
        const cx = (v1.x + v2.x + v3.x) / 3;
        const cy = (v1.y + v2.y + v3.y) / 3;
        if (cx >= 0 && cx < 320 && cy >= 0 && cy < 240) {
            const we = this.getBarycentricWeights(Math.round(cx), Math.round(cy), v1.x, v1.y, v2.x, v2.y, v3.x, v3.y);
            if (we) {
                const shade = { r: v1.r*we.s+v2.r*we.t+v3.r*we.u, g: v1.g*we.s+v2.g*we.t+v3.g*we.u, b: v1.b*we.s+v2.b*we.t+v3.b*we.u, a: v1.a*we.s+v2.a*we.t+v3.a*we.u };
                const tex = { r: 255, g: 255, b: 255, a: 255 };
                const out = this.combineColor(shade, tex);
                samples.push({
                    tri: triCount,
                    cmbHi: '0x' + (this.rspState.combine.hi >>> 0).toString(16),
                    cmbLo: '0x' + (this.rspState.combine.lo >>> 0).toString(16),
                    useTex: this.rspState.useTexture,
                    shade: { r: shade.r|0, g: shade.g|0, b: shade.b|0, a: shade.a|0 },
                    out: { r: out.r, g: out.g, b: out.b, a: out.a },
                    omLo: '0x' + (this.rspState.otherModeLo >>> 0).toString(16),
                });
            }
        }
    }
    return origRast(v1, v2, v3, addr);
};

const STEPS = 200000000; const t0 = Date.now();
for (let i = 0; i < STEPS; i++) { cpu.step(); if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 25000) break; if (samples.length >= 5) break; }
console.log('[cmb] tri:', rcp.drawStats.triangles, 'samples:', samples.length);
for (const s of samples) console.log('  ', JSON.stringify(s));
