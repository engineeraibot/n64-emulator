const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_title_full', ram, mmu, cpu, rcp);
const realLog=console.log; global.console={log:()=>{},warn:()=>{},error:()=>{}};
const src=new Uint8Array(mmu.memory.rdram);
function nb(o){let n=0;for(let i=0;i<320*240;i++){const a=(o+i*2)&0x7FFFFF;const v=(src[a]<<8)|src[a+1];if(((v>>11)&31)>1||((v>>6)&31)>1||((v>>1)&31)>1)n++;}return n;}
// Step until we're shortly after a VI flip (back buffer freshly cleared, mid-draw)
let prevVO=mmu.viRegisters[1]&0x7FFFFF, found=false, samples=0;
for(let i=0;i<30000000 && samples<4;i++){
  cpu.step();
  const vo=mmu.viRegisters[1]&0x7FFFFF;
  if(vo!==prevVO){
    // just flipped; run a small slice so the new back buffer is only partially drawn
    for(let j=0;j<60000;j++) cpu.step();
    const v2=mmu.viRegisters[1]&0x7FFFFF;
    const sel=rcp.getDeterministicVideoTarget(v2,mmu.viRegisters[2]&0xFFF,mmu.viRegisters[0]&0x3);
    const front=(v2-0x280)&0x7FFFFF;
    const hist=rcp.videoTargetHistory; const back=hist[hist.length-1].origin;
    realLog('flip: VI front=0x'+front.toString(16)+' nb='+nb(front)+'  back(latest drawn)=0x'+back.toString(16)+' nb='+nb(back)+'  PICK=0x'+sel.origin.toString(16)+' src='+sel.source);
    prevVO=v2; samples++;
  } else prevVO=vo;
}
