const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const rd=new Uint8Array(ram.rdram);
function r32(a){a&=0x1FFFFFFF;return ((rd[a]<<24)|(rd[a+1]<<16)|(rd[a+2]<<8)|rd[a+3])>>>0;}
// dispatch hook: pc==0x802f40b0, k0 = thread ptr (gpr[26])
let dispatch={}, lastThread=0, slices={};
const t0=Date.now();let s=0; let pcHist={};
for(;;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x802f40b0){ const k0=cpu.gpr[26]>>>0; const id=r32(k0+0x118-0xF8); /*guess*/ dispatch[k0]=(dispatch[k0]||0)+1; lastThread=k0;}
  // sample pc occasionally
  if((s&0x3F)===0){ const b=pc&0xFFFFF000; pcHist[b]=(pcHist[b]||0)+1; }
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0x3FFFF)===0 && Date.now()-t0>30000)break;
}
realLog('steps',s,'f3d',rcp.f3dTaskCount|0);
const disp=Object.entries(dispatch).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>'0x'+(+k).toString(16)+':'+v);
realLog('dispatch(thread ptr:count)',disp.join(' '));
const ph=Object.entries(pcHist).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>'0x'+(+k>>>0).toString(16)+':'+v);
realLog('pcHist(top)',ph.join(' '));
