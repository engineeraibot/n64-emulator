// Detect who writes the framebuffer: CPU stores vs RDP. Track CPU stores into
// the three known draw buffers and report PC histogram + stride pattern.
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const BUFS=[0x38f800,0x3b5000,0x3da800];
function inBuf(a){a&=0x7FFFFF;for(const b of BUFS)if(a>=b&&a<b+320*240*2)return b;return -1;}
const pcHist={};
let cpuWrites=0;
// hook mmu store helpers
for(const fn of ['write16','write32','write8']){
  if(typeof mmu[fn]==='function'){
    const orig=mmu[fn].bind(mmu);
    mmu[fn]=function(addr,val){
      const b=inBuf(addr);
      if(b>=0){cpuWrites++;const pc=(cpu.pc>>>0).toString(16);pcHist[pc]=(pcHist[pc]||0)+1;}
      return orig(addr,val);
    };
  }
}
rcp.f3dTaskCount=0;
const t0=Date.now();
for(let s=0;;s++){ try{cpu.step();}catch(e){break;}
  if((s&0x1FFFF)===0){ if((rcp.f3dTaskCount|0)>=3)break; if(Date.now()-t0>40000)break; } }
realLog('CPU writes into FB region:',cpuWrites);
const top=Object.entries(pcHist).sort((a,b)=>b[1]-a[1]).slice(0,12);
for(const[pc,n]of top)realLog('  pc 0x'+pc,n);
realLog('RDP triangles:',rcp.drawStats.triangles,'texRects:',rcp.drawStats.texRects);
