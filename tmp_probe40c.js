const { buildMachine } = require('./tmp_boot');
const { loadState } = require('./tmp_state');
const { makeFakeCanvas } = require('./tmp_glsim');
const { N64GLRenderer } = require('./gl-renderer');
const { ram, mmu, rcp, cpu } = buildMachine();
loadState('state_title_full', ram, mmu, cpu, rcp);
rcp.f3dTaskCount = 0;
const canvas = makeFakeCanvas(640, 480);
const glr = new N64GLRenderer(canvas);
glr.attach(rcp);
const fake = canvas._gl;
let copyFlushes = 0;
const origFlush = glr._flushBatch.bind(glr);
glr._flushBatch = function() {
  const s = glr.state, n = glr.vcount;
  const isCopy = s && n > 0 && s.copy;
  const before = isCopy ? fake.stats.pixels : 0;
  origFlush();
  if (isCopy && copyFlushes < 3) {
    copyFlushes++;
    console.log('COPY batch flushed: verts', n, 'pixelsWritten', fake.stats.pixels - before,
      'mode', s.mode, 'useTex', s.useTex, 'copyGate', s.copyGate,
      'mask', s.maskS, s.maskT, 'cm', s.cmS, s.cmT, 'size', s.sizeS, s.sizeT,
      'target', s.target.toString(16));
    // sample decoded texture alpha pattern row 8
    const px = s.texEntry.tex.pixels, W = s.texEntry.W;
    let row = '';
    for (let x = 0; x < Math.min(W,16); x++) row += px[(8*W+x)*4+3] > 0 ? '#' : '.';
    console.log('tex row8 alpha:', row);
  }
};
for (let s = 0; ; s++) {
  if ((rcp.f3dTaskCount|0) >= 20) break;
  cpu.step();
  if (s > 80000000) break;
}
glr.flush();
// strict star-color check (yellow/red/green—not the blue wallpaper)
for (const t of glr.targets.values()) {
  const snap = glr.readTarget(t.addr);
  let nb = 0;
  for (let y = 200; y < 224; y++) for (let x = 16; x < 90; x++) {
    const o = (y * snap.width + x) * 4, d = snap.data;
    if (d[o] > 100 || d[o+1] > 100) nb++;
  }
  console.log('target', t.addr.toString(16), 'START warm px:', nb);
}
