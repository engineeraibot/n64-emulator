// Throughput of the emulator with GL capture (drawArrays no-op'd = the CPU-side
// cost the browser would bear, GPU work excluded).
const { buildMachine } = require('./tmp_boot');
const { loadState } = require('./tmp_state');
const { makeFakeCanvas } = require('./tmp_glsim');
const { N64GLRenderer } = require('./gl-renderer');
const { ram, mmu, rcp, cpu } = buildMachine();
loadState(process.env.STATE || 'state_playable', ram, mmu, cpu, rcp);
const canvas = makeFakeCanvas(640, 480);
const glr = new N64GLRenderer(canvas);
if (process.env.GL === '1') {
  glr.attach(rcp);
  canvas._gl.drawArrays = () => {}; // GPU cost not modeled; measure capture overhead
}
const N = parseInt(process.env.N || '8000000', 10);
const f0 = rcp.f3dTaskCount | 0;
const t0 = Date.now();
for (let s = 0; s < N; s++) cpu.step();
const dt = (Date.now() - t0) / 1000;
console.log((process.env.GL === '1' ? 'GL-capture' : 'SW-raster '),
  (N / dt / 1e6).toFixed(2) + 'M steps/s',
  'frames', (rcp.f3dTaskCount | 0) - f0, 'in', dt.toFixed(1) + 's',
  '=> fps', (((rcp.f3dTaskCount | 0) - f0) / dt).toFixed(1));
