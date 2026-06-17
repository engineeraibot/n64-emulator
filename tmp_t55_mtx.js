process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_c3',ram,mmu,cpu,rcp);
let frame=0,curTris=0,firstGeoFrame=-1,dumped=0;
const oP=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(a,d){curTris=0;const r=oP(a,d);frame++;return r;};
const oV=rcp.handleG_VTX.bind(rcp);
rcp.handleG_VTX=function(hi,lo){
  if(frame===firstGeoFrame&&dumped<3){
    const mv=this.rspState.modelviewStack[this.rspState.modelviewStack.length-1];
    const p=this.rspState.projectionMatrix;
    const mvp=this.multiplyMatrices(mv,p);
    const addr=this.resolveAddress(lo);
    const x=(this.mmu.read16(addr)<<16)>>16,y=(this.mmu.read16(addr+2)<<16)>>16,z=(this.mmu.read16(addr+4)<<16)>>16;
    log('--- G_VTX dump '+dumped+' addr=0x'+(addr>>>0).toString(16)+' stackDepth='+this.rspState.modelviewStack.length);
    log('  raw v0 xyz=('+x+','+y+','+z+')');
    log('  MV ='+mv.map(n=>n.toFixed(2)).join(','));
    log('  P  ='+p.map(n=>n.toFixed(2)).join(','));
    log('  MVP='+mvp.map(n=>n.toFixed(3)).join(','));
    const tx=x*mvp[0]+y*mvp[4]+z*mvp[8]+mvp[12],ty=x*mvp[1]+y*mvp[5]+z*mvp[9]+mvp[13],tz=x*mvp[2]+y*mvp[6]+z*mvp[10]+mvp[14],tw=x*mvp[3]+y*mvp[7]+z*mvp[11]+mvp[15];
    log('  transformed tx,ty,tz,tw=('+tx.toFixed(2)+','+ty.toFixed(2)+','+tz.toFixed(2)+','+tw.toFixed(2)+')');
    dumped++;
  }
  return oV(hi,lo);
};
const oD=rcp.drawTriangle.bind(rcp);rcp.drawTriangle=function(a,b,c){curTris++;return oD(a,b,c);};
const t0=Date.now();const startF=rcp.f3dex2TaskCount|0;let bs=0;
for(let s=0;s<500000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if(firstGeoFrame<0&&curTris>50)firstGeoFrame=frame;
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(dumped>=3)break;if(f-startF>=250)break;if(Date.now()-t0>40000)break;}}
log('firstGeoFrame',firstGeoFrame);
