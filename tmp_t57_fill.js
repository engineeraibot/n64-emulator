process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE||'state_oot_scene',ram,mmu,cpu,rcp);
const seen=new Map();
const oF=rcp.handleG_FILLRECT.bind(rcp);
rcp.handleG_FILLRECT=function(hi,lo){
  const cyc=(this.rspState.otherModeHi>>>20)&3;
  const x2=(hi>>>12)&0xFFF,y2=hi&0xFFF,x1=(lo>>>12)&0xFFF,y1=lo&0xFFF;
  if(cyc===0||cyc===1){
    const key=cyc+'|fill0x'+(this.rspState.fillColor>>>0).toString(16)+'|cm0x'+(this.rspState.combine.hi>>>0).toString(16)+','+(this.rspState.combine.lo>>>0).toString(16)+'|omLo0x'+(this.rspState.otherModeLo>>>0).toString(16)+'|rect'+(x1>>2)+','+(y1>>2)+'-'+(x2>>2)+','+(y2>>2);
    seen.set(key,(seen.get(key)||0)+1);
  }
  return oF(hi,lo);
};
const t0=Date.now();const startF=rcp.f3dex2TaskCount|0;let bs=0;
for(let s=0;s<500000000;s++){cpu.step();
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(f-startF>=250)break;if(Date.now()-t0>40000)break;}}
console.error('distinct skipped 1/2-cycle fillrects:',seen.size);
for(const[k,c]of[...seen.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20))console.error(c,k);
