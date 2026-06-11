// tmp_glrender.js — Task #40: render a saved state through the REAL N64GLRenderer
// driven by the FakeGL software stub (tmp_glsim.js), and write the GL target the
// VI is scanning out as a PNG. Usage:
//   STATE=state_playable STOPF3D=3 OUT_PNG=test-results/gl-playable.png node tmp_glrender.js
const fs = require('fs'), zlib = require('zlib');
const { buildMachine } = require('./tmp_boot');
const { loadState } = require('./tmp_state');
const { makeFakeCanvas } = require('./tmp_glsim');
const { N64GLRenderer } = require('./gl-renderer');

const { ram, mmu, rcp, cpu } = buildMachine();
loadState(process.env.STATE || 'state_playable', ram, mmu, cpu, rcp);
const realLog = console.log.bind(console);
rcp.f3dTaskCount = 0;

const canvas = makeFakeCanvas(640, 480);
const glr = new N64GLRenderer(canvas);
glr.attach(rcp);

const STOPF3D = parseInt(process.env.STOPF3D || '3', 10);
const OUT = process.env.OUT_PNG || 'test-results/gl-render.png';
const t0 = Date.now();
let steps = 0;
for (let s = 0; ; s++) {
  try { cpu.step(); } catch (e) { realLog('THREW', s, e.message); break; }
  steps = s;
  // check the task count EVERY step: stopping mid-frame tears the GL targets
  // (the browser presents at VBlank, so only task boundaries are meaningful)
  if ((rcp.f3dTaskCount | 0) >= STOPF3D) { realLog('reached f3d', rcp.f3dTaskCount | 0, 'steps', s); break; }
  if ((s & 0x1FFFF) === 0 && Date.now() - t0 > 90000) { realLog('[budget] steps', s, 'f3d', rcp.f3dTaskCount | 0); break; }
}
glr.flush();
realLog('glr stats', JSON.stringify(glr.stats), 'fakegl draws', canvas._gl.stats.draws, 'pixels', canvas._gl.stats.pixels);
realLog('targets:', Array.from(glr.targets.values()).map(t => `0x${t.addr.toString(16)} w${t.width} z0x${t.zAddr.toString(16)} use${t.lastUse}`).join(' | '));

// Pick the target the VI is scanning out (same rule as present()).
const viOrigin = mmu.viRegisters[1] & 0x7FFFFF;
let best = null;
for (const t of glr.targets.values()) {
  const d = (viOrigin - t.addr) & 0x7FFFFF;
  if (d < t.width * 4 * 8 && (!best || t.lastUse > best.lastUse)) best = t;
}
if (!best) { for (const t of glr.targets.values()) if (!best || t.lastUse > best.lastUse) best = t; }
if (!best) { realLog('NO GL TARGETS'); process.exit(1); }
realLog('chosen target', '0x' + best.addr.toString(16), 'viOrigin', '0x' + viOrigin.toString(16));

const snap = glr.readTarget(best.addr);
const W = snap.width, H = snap.height;
let nonBlack = 0;
for (let i = 0; i < snap.data.length; i += 4) {
  if (snap.data[i] > 12 || snap.data[i+1] > 12 || snap.data[i+2] > 12) nonBlack++;
}
realLog('GL nonBlack', nonBlack, 'of', W * H);

function crc32(buf){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<buf.length;n++)crc=t[(crc^buf[n])&0xFF]^(crc>>>8);return (crc^0xFFFFFFFF)>>>0;}
function writePng(rgba,w,h,out){
  function chunk(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty,'binary'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
  const raw=Buffer.alloc((w*4+1)*h);
  for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;rgba.copy?rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4):raw.set(rgba.subarray(y*w*4,(y+1)*w*4),y*(w*4+1)+1);}
  const png=Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
  fs.writeFileSync(out,png);
}
// force alpha opaque for viewing
const rgba = Buffer.from(snap.data);
for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
writePng(rgba, W, H, OUT);
realLog('wrote', OUT);
