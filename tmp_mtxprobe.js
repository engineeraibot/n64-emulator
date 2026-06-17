const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_bobpaint', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
const STOPF3D=parseInt(process.env.STOPF3D||'3',10);
let on=false;
const fmt=m=>'[t='+[12,13,14].map(i=>(+m[i]).toFixed(1)).join(',')+' r0='+[0,1,2].map(i=>(+m[i]).toFixed(3)).join(',')+' r1='+[4,5,6].map(i=>(+m[i]).toFixed(3)).join(',')+' r2='+[8,9,10].map(i=>(+m[i]).toFixed(3)).join(',')+']';
const origMtx=rcp.handleG_MTX.bind(rcp);
rcp.handleG_MTX=function(hi,lo){
  const f=(hi>>>16)&0xFF;
  const before=this.rspState.modelviewStack.length;
  origMtx(hi,lo);
  if(on){
    const m=this.readMatrix(this.resolveAddress(lo));
    const top=this.rspState.modelviewStack[this.rspState.modelviewStack.length-1];
    realLog(`MTX f=0x${f.toString(16)} depth ${before}->${this.rspState.modelviewStack.length} m=${fmt(m)}`);
    realLog(`    top=${fmt(top)}`);
  }
};
const origLB=rcp.handleG_LOADBLOCK.bind(rcp);
rcp.handleG_LOADBLOCK=function(hi,lo){
  if(on){realLog(`LOADBLOCK img=0x${(this.rspState.textureImage>>>0).toString(16)} lrs=${(lo>>>12)&0xFFF}`);}
  return origLB(hi,lo);
};
let tri=0;
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  if(on){tri++;
    realLog(`tri#${tri} bbox=(${Math.min(v1.x,v2.x,v3.x).toFixed(0)},${Math.min(v1.y,v2.y,v3.y).toFixed(0)})-(${Math.max(v1.x,v2.x,v3.x).toFixed(0)},${Math.max(v1.y,v2.y,v3.y).toFixed(0)})`);}
  return origDraw(v1,v2,v3);
};
// also log POPMTX
const t0=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0xFFF)===0){
    const f=rcp.f3dTaskCount|0;
    on=f>=STOPF3D-1;
    if(f>=STOPF3D){realLog('reached f3d',f);break;}
    if(Date.now()-t0>40000){realLog('[budget]',f);break;}
  }
}
