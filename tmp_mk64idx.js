// Capture vertex-buffer INDICES used by upper-band streak tris, and cross-ref
// against the most recent G_VTX load range (dest..dest+num). Tests whether the
// shared far apex is a STALE vertex-buffer slot (wrong index/decode) or real.
process.env.ROM = process.env.ROM || 'Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_mk64_race', ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const startF=rcp.f3dTaskCount|0;
const STOP=startF+parseInt(process.env.ADV||'2',10);
let auditOn=false, shown=0;

// Track G_VTX loads: per slot, which load # wrote it (and that load's dest/num).
const slotLoad=new Int32Array(64).fill(-1);
let loadSeq=0, lastDest=-1,lastNum=-1;
const origVtx=rcp.handleG_VTX.bind(rcp);
rcp.handleG_VTX=function(hi,lo){
  // replicate decode to know dest/num
  let num,dest;
  if(this.rspState.isF3DEX2){num=(hi>>12)&0xFF;dest=((hi>>1)&0x7F)-num;}
  else{num=((hi&0xFFFF)>>>4)&0x3F;dest=(hi>>>16)&0xF;}
  if(dest<0)dest=0;
  if(auditOn&&num>0){loadSeq++;lastDest=dest;lastNum=num;for(let i=0;i<num&&dest+i<64;i++)slotLoad[dest+i]=loadSeq;}
  return origVtx(hi,lo);
};

function idxOf(byte,s){return (byte/s)|0;}
const origT1=rcp.handleG_TRI1.bind(rcp);
const origT2=rcp.handleG_TRI2.bind(rcp);
function reportTri(tag,ix,iy,iz){
  const rs=rcp.rspState, s=rs.triIndexScale||2;
  const a=idxOf(ix,s),b=idxOf(iy,s),c=idxOf(iz,s);
  const va=rs.vertices[a],vb=rs.vertices[b],vc=rs.vertices[c];
  if(!va||!vb||!vc)return;
  const ys=[va.y,vb.y,vc.y],xs=[va.x,vb.x,vc.x];
  const xspan=Math.max(...xs)-Math.min(...xs);
  if(Math.max(...ys)<120 && xspan>180 && (Math.max(...ys)-Math.min(...ys))<50 && shown<20){
    shown++;
    const f=(idx,v)=>`i${idx}(load${slotLoad[idx]} x${v.x.toFixed(0)} y${v.y.toFixed(0)} w${(v.w||0).toFixed(1)} s${(v.s||0).toFixed(0)} t${(v.t||0).toFixed(0)})`;
    log(tag,f(a,va),f(b,vb),f(c,vc),`| lastLoad#${loadSeq} dest${lastDest} num${lastNum}`);
  }
}
rcp.handleG_TRI1=function(hi,lo,isEX2){
  if(auditOn){const ix=isEX2?(hi>>16)&0xFF:(lo>>16)&0xFF;const iy=isEX2?(hi>>8)&0xFF:(lo>>8)&0xFF;const iz=isEX2?hi&0xFF:lo&0xFF;reportTri('TRI1',ix,iy,iz);}
  return origT1(hi,lo,isEX2);
};
rcp.handleG_TRI2=function(hi,lo,isEX2){
  if(auditOn){reportTri('TRI2a',(hi>>16)&0xFF,(hi>>8)&0xFF,hi&0xFF);reportTri('TRI2b',(lo>>16)&0xFF,(lo>>8)&0xFF,lo&0xFF);}
  return origT2(hi,lo,isEX2);
};
for(let s=0;s<400000000;s++){
  try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0; auditOn=(f>=STOP-1); if(f>=STOP)break;}
}
log('done shown',shown);
