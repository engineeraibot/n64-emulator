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
const seq = [];
const oTR = glr.texRect.bind(glr), oTF = glr.triFan.bind(glr), oFR = glr.fillRect.bind(glr);
glr.texRect = (r,tile,l,t,rr,b,...a) => { seq.push(`f${rcp.f3dTaskCount} TR  ${r.rspState.colorImage.toString(16)}/w${r.rspState.colorImageWidth} [${l},${t},${rr},${b}] cyc${(r.rspState.otherModeHi>>>20)&3}`); oTR(r,tile,l,t,rr,b,...a); };
glr.triFan  = (p,r) => { seq.push(`f${rcp.f3dTaskCount} TRI ${r.rspState.colorImage.toString(16)}/w${r.rspState.colorImageWidth} n${p.length}`); oTF(p,r); };
glr.fillRect= (r,x0,y0,x1,y1) => { seq.push(`f${rcp.f3dTaskCount} FIL ${r.rspState.colorImage.toString(16)}/w${r.rspState.colorImageWidth} [${x0},${y0},${x1},${y1}] fc=${r.rspState.fillColor.toString(16)}`); oFR(r,x0,y0,x1,y1); };
for (let s = 0; ; s++) {
  if ((rcp.f3dTaskCount|0) >= 19) break;
  cpu.step();
  if (s > 80000000) break;
}
// print everything from task 17 to 18 (one full frame), compressed runs
let out = [], last = '', count = 0;
for (const l of seq) {
  const key = l.replace(/\[.*?\]|n\d+/g, '');
  if (key === last) { count++; continue; }
  if (count > 0) out.push(`   (x${count+1} similar)`);
  out.push(l); last = key; count = 0;
}
if (count > 0) out.push(`   (x${count+1} similar)`);
console.log(out.slice(-50).join('\n'));
