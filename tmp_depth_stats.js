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

let totalConsidered = 0, depthRejected = 0, depthAccepted = 0;
let alphaRejected = 0;
let firstZSamples = [];
const origRast = rcp.rasterizeTriangle.bind(rcp);
rcp.rasterizeTriangle = function(v1, v2, v3, addr) {
    // Replicate the body to count
    const x1 = v1.x, y1 = v1.y, x2 = v2.x, y2 = v2.y, x3 = v3.x, y3 = v3.y;
    const minX = Math.floor(Math.min(x1, x2, x3)), maxX = Math.ceil(Math.max(x1, x2, x3));
    const minY = Math.floor(Math.min(y1, y2, y3)), maxY = Math.ceil(Math.max(y1, y2, y3));
    const rd = new DataView(this.mmu.memory.rdram), w = this.rspState.colorImageWidth, zAddr = this.rspState.depthImage;
    const depthEnabled = !!zAddr && ((this.rspState.geometryMode & 1) !== 0);
    if (depthEnabled) {
        for (let y = minY; y <= maxY; y++) {
            if (y < 0 || y >= 240) continue;
            for (let x = minX; x <= maxX; x++) {
                if (x < 0 || x >= w) continue;
                const we = this.getBarycentricWeights(x, y, x1, y1, x2, y2, x3, y3);
                if (!we) continue;
                totalConsidered++;
                const z = v1.z * we.s + v2.z * we.t + v3.z * we.u;
                const zFixed = Math.max(0, Math.min(0xFFFF, Math.floor(z * 16384.0)));
                const zp = (zAddr + (y * w + x) * 2) & 0x7FFFFF;
                const cz = rd.getUint16(zp, false);
                if (firstZSamples.length < 12) {
                    firstZSamples.push({ x, y, ourZ: zFixed, stored: cz, pass: zFixed <= cz });
                }
                if (zFixed > cz) depthRejected++; else depthAccepted++;
            }
        }
    }
    return origRast(v1, v2, v3, addr);
};

const STEPS = 25000000;
const t0 = Date.now();
for (let i = 0; i < STEPS; i++) { cpu.step(); if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 25000) break; }
console.log('[depthstats] tri:', rcp.drawStats.triangles, 'f3d:', rcp.f3dTaskCount);
console.log('[depthstats] considered:', totalConsidered, 'depthAccepted:', depthAccepted, 'depthRejected:', depthRejected);
console.log('[depthstats] first samples:');
for (const s of firstZSamples) console.log(' ', s);
