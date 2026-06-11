const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

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

// Pre-fill RDRAM Z-buffer area with 0xFFFF and patch geometry mode to never set bit 0.
// Easier: monkey-patch rasterizeTriangle to skip the depth test.
const origRast = rcp.rasterizeTriangle.bind(rcp);
rcp.rasterizeTriangle = function(v1, v2, v3, addr) {
    const savedGm = this.rspState.geometryMode;
    this.rspState.geometryMode = savedGm & ~1;  // clear G_ZBUFFER
    try { return origRast(v1, v2, v3, addr); }
    finally { this.rspState.geometryMode = savedGm; }
};

const STEPS = 50000000;
const t0 = Date.now();
for (let i = 0; i < STEPS; i++) {
    cpu.step();
    if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 30000) break;
}
console.log('[nodepth] triangles drawn:', rcp.drawStats && rcp.drawStats.triangles);
console.log('[nodepth] f3d tasks:', rcp.f3dTaskCount);

function decode5551(v) { return { r: ((v>>11)&0x1F)<<3, g: ((v>>6)&0x1F)<<3, b: ((v>>1)&0x1F)<<3, a: (v&1)?255:0 }; }
function dumpFrame(origin, width, type) {
    const rd = new DataView(ram.rdram);
    const bpp = type===3 ? 4 : 2;
    const out = Buffer.alloc(FB_W*FB_H*4); let p=0;
    for (let y=0; y<FB_H; y++) { const row = origin + y*width*bpp;
        for (let x=0; x<FB_W; x++) { const a = (row+x*bpp)&0x7FFFFF;
            if (type===2) { const v=(rd.getUint8(a)<<8)|rd.getUint8((a+1)&0x7FFFFF); const c=decode5551(v); out[p++]=c.r;out[p++]=c.g;out[p++]=c.b;out[p++]=255; }
            else { out[p++]=rd.getUint8(a); out[p++]=rd.getUint8((a+1)&0x7FFFFF); out[p++]=rd.getUint8((a+2)&0x7FFFFF); out[p++]=255; }
        }
    }
    return out;
}
function crc32(buf) {
    const T=new Uint32Array(256);
    for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);T[n]=c;}
    let c=0xFFFFFFFF; for(let n=0;n<buf.length;n++)c=T[(c^buf[n])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0;
}
function writePng(rgba, w, h, p) {
    const chunk=(t,d)=>{const len=Buffer.alloc(4);len.writeUInt32BE(d.length,0);const T=Buffer.from(t,'binary');const body=Buffer.concat([T,d]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body),0);return Buffer.concat([len,body,crc]);};
    const sig=Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
    const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4); ihdr[8]=8; ihdr[9]=6;
    const stride=w*4; const raw=Buffer.alloc((stride+1)*h);
    for (let y=0;y<h;y++){raw[y*(stride+1)]=0; rgba.copy(raw, y*(stride+1)+1, y*stride, (y+1)*stride);}
    const idat=zlib.deflateSync(raw); const iend=Buffer.alloc(0);
    fs.writeFileSync(p, Buffer.concat([sig, chunk('IHDR',ihdr), chunk('IDAT',idat), chunk('IEND',iend)]));
}

const viOrigin = mmu.viRegisters[1] & 0x7FFFFF;
const viWidth = mmu.viRegisters[2] & 0xFFF;
const viType = mmu.viRegisters[0] & 0x3;
let frame = null;
if (typeof rcp.getDeterministicVideoTarget === 'function') {
    const target = rcp.getDeterministicVideoTarget(viOrigin, viWidth, viType);
    if (target) frame = dumpFrame(target.origin & 0x7FFFFF, target.width|0, target.type|0);
}
if (!frame) frame = dumpFrame(viOrigin, viWidth||320, viType||2);
writePng(frame, FB_W, FB_H, path.join(ROOT, 'test-results', 'sm64-nodepth.png'));
console.log('[nodepth] Wrote test-results/sm64-nodepth.png');
