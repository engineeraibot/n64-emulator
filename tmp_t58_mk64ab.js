process.env.ROM='Mario Kart 64 (Europe) (Rev A).n64';
const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE||'state_mk64_race',ram,mmu,cpu,rcp);
const rd=new Uint8Array(mmu.memory.rdram);
const FORCE=process.env.FORCE==='1';
let comp=0;
const oF=rcp.handleG_FILLRECT.bind(rcp);
rcp.handleG_FILLRECT=function(hi,lo){
  const rs=this.rspState;const cyc=(rs.otherModeHi>>>20)&3;
  if(FORCE && (cyc===0||cyc===1)){comp++;return this._compositeOverlayFillRect(hi,lo);}
  return oF(hi,lo);
};
const perCi=new Map();let curTris=0,curCi=0;
const oD=rcp.drawTriangle.bind(rcp);rcp.drawTriangle=function(a,b,c){curTris++;curCi=(this.rspState.colorImage>>>0)&0x7FFFFF;return oD(a,b,c);};
const oP=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(a,d){const before=curTris;const r=oP(a,d);const drew=curTris-before;if(drew>0){const ci=curCi;const prev=perCi.get(ci)||{tris:0};if(drew>prev.tris)perCi.set(ci,{tris:drew,buf:Buffer.from(Buffer.from(rd.buffer,ci,320*240*2))});}return r;};
const ADV=parseInt(process.env.ADV||'20');const startF=(rcp.f3dex2TaskCount|0)+(rcp.f3dTaskCount|0);
const t0=Date.now();let bs=0;
for(let s=0;s<200000000;s++){cpu.step();if((s&0x3FFF)===0){const f=(rcp.f3dex2TaskCount|0)+(rcp.f3dTaskCount|0);if(f-startF>=ADV)break;if(Date.now()-t0>30000)break;}}
function nbScan(buf){let nb=0;for(let i=0;i<320*240;i++){const v=(buf[i*2]<<8)|buf[i*2+1];if(((v>>11)&31)>1||((v>>6)&31)>1||((v>>1)&31)>1)nb++;}return nb;}
let best=null,bestNb=0;for(const [ci,e] of perCi){const nb=nbScan(e.buf);if(nb>bestNb){bestNb=nb;best=e.buf;}}
console.error('FORCE',FORCE,'composites',comp,'bestNb',bestNb);
