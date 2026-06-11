const fs = require('fs'); const path = require('path'); const vm = require('vm'); const zlib=require('zlib');
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

// Disable triangles entirely
rcp.drawTriangle = function() {};

const STEPS = 200000000; const t0 = Date.now();
for (let i = 0; i < STEPS; i++) {
    cpu.step();
    if ((i & 0xFFFF) === 0 && (Date.now() - t0) > 35000) break;
    if ((i & 0xFFFF) === 0 && rcp.f3dTaskCount >= 96) break;
}
console.log('[notri] f3d:', rcp.f3dTaskCount, 'tri:', rcp.drawStats.triangles, 'fr:', rcp.drawStats.fillRects);
function decode5551(v){return{r:((v>>11)&0x1F)<<3,g:((v>>6)&0x1F)<<3,b:((v>>1)&0x1F)<<3,a:(v&1)?255:0};}
function countNB(origin){const rd=new DataView(ram.rdram);let nb=0;
  for(let y=0;y<240;y++)for(let x=0;x<320;x++){const a=(origin+(y*320+x)*2)&0x7FFFFF;const v=(rd.getUint8(a)<<8)|rd.getUint8((a+1)&0x7FFFFF);const c=decode5551(v);if(c.r||c.g||c.b)nb++;}return nb;}
function dumpFB(origin,p){const rd=new DataView(ram.rdram);const out=Buffer.alloc(FB_W*FB_H*4);let q=0;
  for(let y=0;y<240;y++)for(let x=0;x<320;x++){const a=(origin+(y*320+x)*2)&0x7FFFFF;const v=(rd.getUint8(a)<<8)|rd.getUint8((a+1)&0x7FFFFF);const c=decode5551(v);out[q++]=c.r;out[q++]=c.g;out[q++]=c.b;out[q++]=255;}
  function crc32(b){const T=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);T[n]=c;}let c=0xFFFFFFFF;for(let n=0;n<b.length;n++)c=T[(c^b[n])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
  function chunk(t,d){const len=Buffer.alloc(4);len.writeUInt32BE(d.length,0);const T=Buffer.from(t,'binary');const body=Buffer.concat([T,d]);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc32(body),0);return Buffer.concat([len,body,cr]);}
  const sig=Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(FB_W,0);ihdr.writeUInt32BE(FB_H,4);ihdr[8]=8;ihdr[9]=6;
  const stride=FB_W*4;const raw=Buffer.alloc((stride+1)*FB_H);
  for(let y=0;y<FB_H;y++){raw[y*(stride+1)]=0;out.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride);}
  fs.writeFileSync(p,Buffer.concat([sig,chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
for (const fb of [0x38f800, 0x3b5000, 0x3da800]) {
    console.log(`[notri] FB 0x${fb.toString(16)}: ${countNB(fb)} non-black`);
    dumpFB(fb, path.join(ROOT, 'test-results', `sm64-notri-${fb.toString(16)}.png`));
}
