// Dump texrect rects + color image config from a saved state's next frames.
const {buildMachine}=require('./tmp_boot.js');
const {loadState}=require('./tmp_state.js');
const STATE=process.env.STATE||'state_adv2';
const m=buildMachine();
loadState(STATE, m.ram, m.mmu, m.cpu, m.rcp);
const rcp=m.rcp, cpu=m.cpu;
const realLog=console.log.bind(console);
let logs=[];
const orig=rcp.handleG_TEXRECT.bind(rcp);
rcp.handleG_TEXRECT=function(hi,lo,addr,flip,isRdpFifo){
  const xh=(hi>>12)&0xFFF, yh=hi&0xFFF, tile=(lo>>24)&0x7, xl=(lo>>12)&0xFFF, yl=lo&0xFFF;
  if(logs.length<40) logs.push({xl:xl>>2,yl:yl>>2,xh:xh>>2,yh:yh>>2,tile,
    cw:rcp.rspState.colorImageWidth, cAddr:(rcp.rspState.colorImage>>>0).toString(16),
    cSz:rcp.rspState.colorImageSize, fifo:isRdpFifo});
  return orig(hi,lo,addr,flip,isRdpFifo);
};
// also log color image set
const f3dStart=rcp.f3dTaskCount;
let steps=0;
while(rcp.f3dTaskCount < f3dStart+2 && steps<8_000_000){ cpu.step(); steps++; }
realLog('STATE',STATE,'f3dStart',f3dStart,'f3dNow',rcp.f3dTaskCount,'steps',steps);
realLog('colorImageWidth',rcp.rspState.colorImageWidth,'colorImage',(rcp.rspState.colorImage>>>0).toString(16),'cSz',rcp.rspState.colorImageSize);
realLog('VI origin',(m.mmu.viRegisters[1]>>>0).toString(16),'VI width',m.mmu.viRegisters[2]>>>0);
realLog('texrects:',logs.length);
for(const l of logs) realLog(JSON.stringify(l));
