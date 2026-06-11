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
let trCount = 0, firstBatch = null;
const origFlush = glr._flushBatch.bind(glr);
glr._flushBatch = function() {
  const s = glr.state, n = glr.vcount;
  if (s && n > 0 && s.kind === 1 && s.copy && !firstBatch) {
    firstBatch = { state: { ...s, texEntry: undefined }, n,
      verts: Array.from(glr.verts.subarray(0, n * 10)),
      tex: s.texEntry ? { W: s.texEntry.W, H: s.texEntry.H, hash: s.texEntry.hash } : null };
    // count opaque texels in decoded texture (first 16 rows)
    if (s.texEntry) {
      const fake = canvas._gl;
      // texEntry.tex is a FakeGL texture object with .pixels
      const px = s.texEntry.tex.pixels;
      let opaque = 0;
      for (let i = 3; i < Math.min(px.length, 16 * s.texEntry.W * 4); i += 4) if (px[i] > 0) opaque++;
      firstBatch.opaqueTexels = opaque;
    }
  }
  origFlush();
};
for (let s = 0; ; s++) {
  if ((rcp.f3dTaskCount|0) >= 20) break;
  cpu.step();
  if (s > 80000000) break;
}
glr.flush();
console.log('firstBatch:', JSON.stringify(firstBatch, (k,v) => k==='verts'?v.slice(0,20):v, 1).slice(0, 1800));
// read back the START region from each target
for (const t of glr.targets.values()) {
  const snap = glr.readTarget(t.addr);
  let nb = 0;
  for (let y = 204; y < 220; y++) for (let x = 20; x < 84; x++) {
    const o = (y * snap.width + x) * 4;
    const d = snap.data;
    if (d[o] > 40 || d[o+1] > 40 || d[o+2] > 40) nb++;
  }
  console.log('target', t.addr.toString(16), 'START-region bright px:', nb);
}
