process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_title',ram,mmu,cpu,rcp);
let seq=[],cap=false,fr=0;
const oF=rcp.handleG_FILLRECT.bind(rcp);
rcp.handleG_FILLRECT=function(hi,lo){const ci=this.rspState.colorImage>>>0&0x7FFFFF;if(cap)seq.push('FILLRECT ci=0x'+ci.toString(16)+' fill=0x'+(this.rspState.fillColor>>>0).toString(16));return oF(hi,lo);};
const oD=rcp.drawTriangle.bind(rcp);let td=0;
rcp.drawTriangle=function(a,b,c){if(cap){if(seq.length&&seq[seq.length-1].startsWith('TRIS'))seq[seq.length-1]='TRIS x'+(++td)+' ci=0x'+(this.rspState.colorImage>>>0&0x7FFFFF).toString(16);else{td=1;seq.push('TRIS x1 ci=0x'+(this.rspState.colorImage>>>0&0x7FFFFF).toString(16));}}return oD(a,b,c);};
const oR=rcp.handleG_TEXRECT.bind(rcp);let tr=0;
rcp.handleG_TEXRECT=function(...a){if(cap){if(seq.length&&seq[seq.length-1].startsWith('TEXR'))seq[seq.length-1]='TEXR x'+(++tr)+' ci=0x'+(this.rspState.colorImage>>>0&0x7FFFFF).toString(16);else{tr=1;seq.push('TEXR x1 ci=0x'+(this.rspState.colorImage>>>0&0x7FFFFF).toString(16));}}return oR(...a);};
const oS=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(addr,ds){const startF=rcp.f3dex2TaskCount|0;
  if(startF>= (rcp._target||99999) && !cap){cap=true;seq=[];td=tr=0;}
  const r=oS(addr,ds);
  if(cap){log('=== FRAME SEQUENCE ===');seq.forEach(x=>log('  '+x));cap=false;rcp._target=99999;}
  return r;};
const startF=rcp.f3dex2TaskCount|0;rcp._target=startF+3;const t0=Date.now();
for(let s=0;s<200000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){if((rcp.f3dex2TaskCount|0)-startF>=5)break;if(Date.now()-t0>30000)break;}}
