const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_adv2', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
const t0=Date.now();
// capture VI origin writes + scene video targets
const origins=new Map();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0xFFFF)===0){
    const vo=(mmu.viRegisters[1]&0x7FFFFF)>>>0;origins.set(vo,(origins.get(vo)||0)+1);
    if((rcp.f3dTaskCount|0)>=25)break;
    if(Date.now()-t0>38000)break;
  }
}
realLog('VI reg[0](ctrl/type)=0x'+(mmu.viRegisters[0]>>>0).toString(16));
realLog('VI origin=0x'+((mmu.viRegisters[1]&0x7FFFFF)>>>0).toString(16));
realLog('VI width(reg2)=',mmu.viRegisters[2]&0xFFF);
realLog('VI xscale(reg12)=0x'+(mmu.viRegisters[12]>>>0).toString(16),'yscale(reg13)=0x'+(mmu.viRegisters[13]>>>0).toString(16));
realLog('VI hstart(reg9)=0x'+(mmu.viRegisters[9]>>>0).toString(16),'vstart(reg10)=0x'+(mmu.viRegisters[10]>>>0).toString(16));
realLog('distinct VI origins seen:');
for(const[o,n]of [...origins.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8))realLog('  0x'+o.toString(16),n);
realLog('--- rcp videoTargetHistory (recent) ---');
const h=rcp.videoTargetHistory||[];
for(const c of h.slice(-8))realLog('  origin=0x'+(c.origin>>>0).toString(16),'w='+c.width,'t='+c.type,'tri='+(c.triangles|0),'texRects='+(c.texRects|0));
