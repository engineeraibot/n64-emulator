const fs = require('fs');
const { buildMachine } = require('/sessions/loving-quirky-pasteur/mnt/n64-emulator-main/tmp_boot');
const { loadState } = require('/sessions/loving-quirky-pasteur/mnt/n64-emulator-main/tmp_state');
const { makeFakeCanvas } = require('/sessions/loving-quirky-pasteur/mnt/n64-emulator-main/tmp_glsim');
const { N64GLRenderer } = require('/sessions/loving-quirky-pasteur/mnt/n64-emulator-main/gl-renderer');
const { ram, mmu, rcp, cpu } = buildMachine();
loadState('state_title_full', ram, mmu, cpu, rcp);
rcp.f3dTaskCount = 0;
const canvas = makeFakeCanvas(640, 480);
const glr = new N64GLRenderer(canvas);
glr.attach(rcp);
const origTexRect = glr.texRect.bind(glr);
let logs = [];
glr.texRect = (rcpp, tile, l, t, r, b, s0, t0, ss, dt, flip) => {
  const rs = rcpp.rspState;
  const cyc = (rs.otherModeHi >>> 20) & 3;
  logs.push(`TR tile${tile} [${l},${t})-(${r},${b}) s0=${s0} t0=${t0} ss=${ss} dt=${dt} flip=${flip} cyc=${cyc} cmb=${rs.combine.hi.toString(16)}/${rs.combine.lo.toString(16)} omL=${rs.otherModeLo.toString(16)} texImg=${rs.textureImage.toString(16)} fmt=${rs.tiles[tile].format}/${rs.tiles[tile].size} line=${rs.tiles[tile].line} tmem=${rs.tiles[tile].tmem} target=${rs.colorImage.toString(16)}`);
  origTexRect(rcpp, tile, l, t, r, b, s0, t0, ss, dt, flip);
};
for (let s = 0; ; s++) {
  if ((rcp.f3dTaskCount|0) >= 20) break;
  cpu.step();
  if ((s & 0x1FFFF) === 0 && (rcp.f3dTaskCount|0) >= 20) break;
  if (s > 80000000) break;
}
glr.flush();
// print texrects from the LAST task only (roughly the tail)
console.log('total texrects', logs.length);
for (const l of logs.slice(-40)) console.log(l);
