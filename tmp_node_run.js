// Headless Node.js harness for the emulator.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = __dirname;
const STEPS = parseInt(process.argv[2] || '5000000', 10);
const OUT_PNG = process.argv[3] || path.join(ROOT, 'test-results', 'sm64-node.png');
const ROM_PATH = path.join(ROOT, 'Super Mario 64 (Europe) (En,Fr,De).n64');

const files = ['memory.js', 'mmu.js', 'rcp.js', 'cpu.js'];
let combined = '';
for (const f of files) combined += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n';
combined += '\nthis.__classes = { Memory, MMU, RCP, CPU };\n';

const sandbox = {
    console,
    setTimeout: () => {},
    clearTimeout: () => {},
    performance: { now: () => Date.now() },
    Math, Number, BigInt, JSON, DataView, ArrayBuffer,
    Uint8Array, Uint16Array, Uint32Array,
    Int8Array, Int16Array, Int32Array,
    Float32Array, Float64Array, Array,
};
vm.createContext(sandbox);
vm.runInContext(combined, sandbox, { filename: 'combined-emu.js' });
const { Memory, MMU, RCP, CPU } = sandbox.__classes;

console.log('[harness] Loading ROM:', ROM_PATH);
const romBuf = fs.readFileSync(ROM_PATH);
const ab = romBuf.buffer.slice(romBuf.byteOffset, romBuf.byteOffset + romBuf.byteLength);

const FB_W = 320, FB_H = 240;
const framebuffer = new sandbox.Uint8Array(FB_W * FB_H * 4);
const ram = new Memory(8 * 1024 * 1024);
const mmu = new MMU(ram);
const rcp = new RCP(mmu, framebuffer);
const cpu = new CPU(mmu, rcp);
mmu.cpu = cpu;
mmu.rcp = rcp;
ram.loadRom(ab);

cpu.isRunning = true;
if (!cpu.isHleBootDone) cpu.performHleBoot();

const STOP_AT_F3D = parseInt(process.env.STOP_AT_F3D || '0', 10);
const STOP_AT_TRI = parseInt(process.env.STOP_AT_TRI || '0', 10);
const TIME_BUDGET_MS = parseInt(process.env.TIME_BUDGET_MS || '0', 10);

console.log('[harness] Stepping CPU for', STEPS, 'instructions');
const t0 = Date.now();
let lastReport = t0;
let steps = 0;
let bail = false;
// PC histogram collected after GFX stops
const pcHist = new Map();
let pcProfiling = false;
let lastF3d = 0;
for (steps = 0; steps < STEPS; steps++) {
    try { cpu.step(); }
    catch (e) {
        console.error('[harness] step threw at step', steps, e.message);
        bail = true;
        break;
    }
    // Enable profiling once GFX tasks stop growing
    if (!pcProfiling && (rcp.f3dTaskCount | 0) > lastF3d) {
        lastF3d = rcp.f3dTaskCount | 0;
        pcHist.clear();
    }
    if (pcProfiling || (rcp.f3dTaskCount | 0) >= 96) {
        pcProfiling = true;
        if ((steps & 15) === 0) { // Sample every 16 steps to minimize overhead
            const pc = cpu.pc >>> 0;
            pcHist.set(pc, (pcHist.get(pc) || 0) + 1);
        }
    }
    if ((steps & 0xFFFF) === 0) {
        const now = Date.now();
        if (now - lastReport > 5000) {
            console.log('[harness]', steps, 'steps in', (now - t0)/1000, 's',
                'PC=0x' + (cpu.pc >>> 0).toString(16),
                'tri=' + ((rcp.drawStats && rcp.drawStats.triangles) | 0),
                'f3d=' + (rcp.f3dTaskCount | 0));
            lastReport = now;
        }
        if (STOP_AT_F3D > 0 && (rcp.f3dTaskCount | 0) >= STOP_AT_F3D) { console.log('[harness] Early stop: F3D'); break; }
        if (STOP_AT_TRI > 0 && ((rcp.drawStats && rcp.drawStats.triangles) | 0) >= STOP_AT_TRI) { console.log('[harness] Early stop: TRI'); break; }
        if (TIME_BUDGET_MS > 0 && (now - t0) >= TIME_BUDGET_MS) { console.log('[harness] Early stop: time'); break; }
    }
}
// Disassemble hot PCs
const hotPcs = [0x802ef620, 0x802e6490, 0x802f1190, 0x802e66cc, 0x802e8da8, 0x802df70c];
console.log('[harness] Instructions at hot PCs:');
for (const vaddr of hotPcs) {
    const phys = vaddr & 0x1FFFFFFF;
    const words = [];
    for (let i = 0; i < 6; i++) {
        const w = (ram.read32 ? ram.read32((phys + i*4) & 0x7FFFFF) : 0) >>> 0;
        words.push('0x' + w.toString(16).padStart(8,'0'));
    }
    console.log('  0x' + vaddr.toString(16) + ': ' + words.join(' '));
}
// Print top 20 hottest PCs
const sorted = [...pcHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log('[harness] PC histogram (top 20 after f3d=96, size=' + pcHist.size + ', pcProfiling=' + pcProfiling + '):');
for (const [pc, count] of sorted) {
    console.log('  0x' + pc.toString(16).padStart(8, '0') + ' : ' + count);
}
const t1 = Date.now();
console.log('[harness] Done.', steps, 'steps in', (t1 - t0)/1000, 's',
    'tri=' + ((rcp.drawStats && rcp.drawStats.triangles) | 0),
    'f3d=' + (rcp.f3dTaskCount | 0));

console.log('[harness] drawStats:', JSON.stringify({
    triangles: rcp.drawStats && rcp.drawStats.triangles,
    fillRects: rcp.drawStats && rcp.drawStats.fillRects,
    minX: rcp.drawStats && rcp.drawStats.minX,
    minY: rcp.drawStats && rcp.drawStats.minY,
    maxX: rcp.drawStats && rcp.drawStats.maxX,
    maxY: rcp.drawStats && rcp.drawStats.maxY,
    texturedTriangles: rcp.drawStats && rcp.drawStats.texturedTriangles,
    untexturedTriangles: rcp.drawStats && rcp.drawStats.untexturedTriangles,
    texRects: rcp.drawStats && rcp.drawStats.texRects,
    culledTriangles: rcp.drawStats && rcp.drawStats.culledTriangles,
}, null, 2));

function decode5551(v) {
    return {
        r: ((v >> 11) & 0x1F) << 3,
        g: ((v >> 6) & 0x1F) << 3,
        b: ((v >> 1) & 0x1F) << 3,
        a: (v & 1) ? 255 : 0,
    };
}

function dumpFrame(origin, width, type) {
    const rd = new DataView(ram.rdram);
    const bpp = type === 3 ? 4 : 2;
    const drawW = Math.min(width, FB_W);
    const out = Buffer.alloc(FB_W * FB_H * 4);
    let p = 0;
    for (let y = 0; y < FB_H; y++) {
        const row = origin + y * width * bpp;
        for (let x = 0; x < FB_W; x++) {
            if (x < drawW) {
                const a = (row + x * bpp) & 0x7FFFFF;
                if (type === 2) {
                    const v = (rd.getUint8(a) << 8) | rd.getUint8((a + 1) & 0x7FFFFF);
                    const c = decode5551(v);
                    out[p++] = c.r; out[p++] = c.g; out[p++] = c.b; out[p++] = 255;
                } else {
                    out[p++] = rd.getUint8(a);
                    out[p++] = rd.getUint8((a + 1) & 0x7FFFFF);
                    out[p++] = rd.getUint8((a + 2) & 0x7FFFFF);
                    out[p++] = 255;
                }
            } else { out[p++] = 0; out[p++] = 0; out[p++] = 0; out[p++] = 255; }
        }
    }
    return out;
}

function crc32(buf) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    let crc = 0xFFFFFFFF;
    for (let n = 0; n < buf.length; n++) crc = table[(crc ^ buf[n]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writePng(rgba, width, height, outPath) {
    function chunk(type, data) {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
        const t = Buffer.from(type, 'binary');
        const body = Buffer.concat([t, data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
        return Buffer.concat([len, body, crc]);
    }
    const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 6;
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    const idat = zlib.deflateSync(raw);
    const iend = Buffer.alloc(0);
    fs.writeFileSync(outPath, Buffer.concat([
        sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', iend),
    ]));
}

// Convert a raw snapshot (16bpp RGBA5551 or 32bpp) to RGBA8888 Buffer.
function snapshotToRgba(snap) {
    const data = snap.data;
    const w = snap.width | 0;
    const h = snap.height | 0;
    const type = snap.type | 0;
    const bpp = type === 3 ? 4 : 2;
    const out = Buffer.alloc(FB_W * FB_H * 4);
    let p = 0;
    for (let y = 0; y < FB_H; y++) {
        for (let x = 0; x < FB_W; x++) {
            if (y < h && x < w) {
                const i = (y * w + x) * bpp;
                if (type === 2 && i + 1 < data.length) {
                    const v = (data[i] << 8) | data[i + 1];
                    out[p++] = ((v >> 11) & 0x1F) << 3;
                    out[p++] = ((v >> 6)  & 0x1F) << 3;
                    out[p++] = ((v >> 1)  & 0x1F) << 3;
                    out[p++] = 255;
                } else if (type === 3 && i + 2 < data.length) {
                    out[p++] = data[i];
                    out[p++] = data[i + 1];
                    out[p++] = data[i + 2];
                    out[p++] = 255;
                } else {
                    out[p++] = 0; out[p++] = 0; out[p++] = 0; out[p++] = 255;
                }
            } else {
                out[p++] = 0; out[p++] = 0; out[p++] = 0; out[p++] = 255;
            }
        }
    }
    return out;
}

function countNonBlack(rgba) {
    let n = 0;
    for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i] > 12 || rgba[i + 1] > 12 || rgba[i + 2] > 12) n++;
    }
    return n;
}

const viOrigin = mmu.viRegisters[1] & 0x7FFFFF;
const viWidth = mmu.viRegisters[2] & 0xFFF;
const viType = mmu.viRegisters[0] & 0x3;
console.log('[harness] VI origin=0x' + viOrigin.toString(16), 'width=' + viWidth, 'type=' + viType);

fs.mkdirSync(path.dirname(OUT_PNG), { recursive: true });

let frame = null;
let frameNonBlack = 0;
let frameSource = 'vi';

if (typeof rcp.getDeterministicVideoTarget === 'function') {
    const target = rcp.getDeterministicVideoTarget(viOrigin, viWidth, viType);
    if (target) {
        console.log('[harness] deterministic target', '0x' + (target.origin >>> 0).toString(16),
            'w=' + (target.width | 0), 't=' + (target.type | 0), 'src=' + target.source);
        frame = dumpFrame(target.origin & 0x7FFFFF, target.width | 0, target.type | 0);
        frameNonBlack = countNonBlack(frame);
        frameSource = 'deterministic:0x' + (target.origin >>> 0).toString(16);
        const dbgPath = OUT_PNG.replace('.png', '-det.png');
        writePng(frame, FB_W, FB_H, dbgPath);
        console.log('[harness] det frame nonBlack=' + frameNonBlack, '->', dbgPath);
    }
}
if (!frame) {
    frame = dumpFrame(viOrigin, viWidth || 320, viType || 2);
    frameNonBlack = countNonBlack(frame);
    frameSource = 'vi:0x' + viOrigin.toString(16);
}

// Prefer the best rich snapshot: it was captured at draw time with valid pixels,
// whereas the deterministic frame reads stale RDRAM at end-of-run which may be garbage.
// Always evaluate the snap and pick whichever has more non-black pixels.
const bestSnap = rcp.bestRichVideoSnapshot || rcp.lastRichVideoSnapshot;
if (bestSnap) {
    console.log('[harness] bestRichSnap origin=0x' + (bestSnap.origin >>> 0).toString(16),
        'w=' + (bestSnap.width | 0), 't=' + (bestSnap.type | 0), 'nonBlack=' + (bestSnap.nonBlack | 0));
    const snapFrame = snapshotToRgba(bestSnap);
    const snapNonBlack = countNonBlack(snapFrame);
    const snapPath = OUT_PNG.replace('.png', '-snap.png');
    writePng(snapFrame, FB_W, FB_H, snapPath);
    console.log('[harness] snap frame nonBlack=' + snapNonBlack, '->', snapPath);
    // The snap data was captured from RDRAM at draw time. The det frame reads
    // RDRAM at end-of-run which may be overwritten with garbage. Always prefer
    // the snap if it has any meaningful content (nonBlack > 200 pixels = ~0.3%).
    if (snapNonBlack > 200) {
        frame = snapFrame;
        frameNonBlack = snapNonBlack;
        frameSource = 'snapshot:0x' + (bestSnap.origin >>> 0).toString(16);
    }
}

writePng(frame, FB_W, FB_H, OUT_PNG);
console.log('[harness] Wrote', OUT_PNG, '(source=' + frameSource + ', nonBlack=' + frameNonBlack + ')');
console.log('[harness] rspTaskCount=' + (rcp.rspTaskCount|0), 'f3dTaskCount=' + (rcp.f3dTaskCount|0));
const cp0s = cpu.cp0Registers[12] >>> 0;
const cp0c = cpu.cp0Registers[13] >>> 0;
const mi2 = mmu.miRegisters[2];
const mi3 = mmu.miRegisters[3];
console.log('[harness] CP0 Status=0x' + cp0s.toString(16), 'Cause=0x' + cp0c.toString(16));
console.log('[harness] MI intr=0x' + mi2.toString(16) + ' mask=0x' + mi3.toString(16) + ' pending=0x' + (mi2&mi3).toString(16));
console.log('[harness] viNextInterrupt=' + mmu.viNextInterrupt, 'instructionCount=' + cpu.instructionCount);
console.log('[harness] taskTypeHistogram:', JSON.stringify(rcp.taskTypeHistogram || {}));

if (rcp.lastRichVideoSnapshot) {
    const s = rcp.lastRichVideoSnapshot;
    console.log('[harness] lastRichSnap origin=0x' + (s.origin >>> 0).toString(16),
        'w=' + (s.width | 0), 't=' + (s.type | 0), 'nonBlack=' + (s.nonBlack | 0));
}

process.exit(bail ? 1 : 0);
