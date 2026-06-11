const {buildMachine}=require('./tmp_boot.js');
const {loadState}=require('./tmp_state.js');
const M=buildMachine();
loadState(process.env.STATE||'state_title_full',M.ram,M.mmu,M.cpu,M.rcp);
const c=M.cpu,r=M.rcp,mmu=M.mmu;
const N=parseInt(process.env.N||'120000000');
const BTN=parseInt(process.env.BTN||'1000',16);
const HOLD=1500000, CYCLE=3000000;
function crc(d){let h=2166136261;for(let i=0;i<d.length;i+=129){h=(h^d[i])*16777619>>>0;}return h>>>0;}
let edges=0,lastBtn=0;
const STEP=8000000;
for(let i=0;i<N;i++){
  const want=(i%CYCLE)<HOLD?BTN:0;
  if(want&&!lastBtn)edges++; lastBtn=want;
  mmu.updateController(want,0,0);
  c.step();
  if(i>0 && i%STEP===0){
    const s=r.bestRichVideoSnapshot;
    const sig=s?crc(s.data):0;
    process.stderr.write(`i=${(i/1e6).toFixed(0)}M edges=${edges} btnRd=${mmu.controllerDebug.buttonReads} origin=0x${s?(s.origin>>>0).toString(16):'-'} nb=${s?s.nonBlack:'-'} crc=${sig.toString(16)}\n`);
    r.bestRichVideoSnapshot=null;
  }
}
