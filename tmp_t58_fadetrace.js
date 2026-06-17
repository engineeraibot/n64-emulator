process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE||'state_oot_n64logo',ram,mmu,cpu,rcp);
const seen=new Map();
const oF=rcp.handleG_FILLRECT.bind(rcp);
rcp.handleG_FILLRECT=function(hi,lo){
  const rs=this.rspState;const cyc=(rs.otherModeHi>>>20)&3;
  if(cyc===0||cyc===1){
    const x2=(hi>>>12)&0xFFF,y2=hi&0xFFF,x1=(lo>>>12)&0xFFF,y1=lo&0xFFF;
    const key=cyc+'|'+(rs.combine.hi>>>0).toString(16)+'/'+(rs.combine.lo>>>0).toString(16)+'|om'+(rs.otherModeLo>>>0).toString(16)+'|prim'+(rs.primColor>>>0).toString(16)+'|env'+(rs.envColor>>>0).toString(16)+'|blend'+(rs.blendColor>>>0).toString(16)+'|fog'+(rs.fogColor>>>0).toString(16);
    if(!seen.has(key)){
      // compute SW base color
      const shade={r:255,g:255,b:255,a:255},tex={r:255,g:255,b:255,a:255};
      const ca=!!(rs.combine.hi||rs.combine.lo);if(ca)this._setupCombine();
      const base=ca?this.combineColor(shade,tex):shade;
      const blA=this.blenderActive();
      seen.set(key,{rect:[x1>>2,y1>>2,x2>>2,y2>>2],base:[base.r,base.g,base.b,base.a],blActive:blA});
    }
  }
  return oF(hi,lo);
};
const ADV=parseInt(process.env.ADV||'60');const startF=rcp.f3dex2TaskCount|0;
const t0=Date.now();let bs=0;
for(let s=0;s<500000000;s++){cpu.step();
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(f-startF>=ADV)break;if(Date.now()-t0>34000)break;}}
console.error('distinct 1/2-cyc fillrects:',seen.size);
for(const [k,v] of seen)console.error(k,'\n   ',JSON.stringify(v));
