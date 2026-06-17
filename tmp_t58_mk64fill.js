process.env.ROM='Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE||'state_mk64_race',ram,mmu,cpu,rcp);
const seen=new Map();let perFrame=0,frames=0;
const oF=rcp.handleG_FILLRECT.bind(rcp);
rcp.handleG_FILLRECT=function(hi,lo){
  const rs=this.rspState;const cyc=(rs.otherModeHi>>>20)&3;
  if(cyc===0||cyc===1){
    perFrame++;
    const x2=(hi>>>12)&0xFFF,y2=hi&0xFFF,x1=(lo>>>12)&0xFFF,y1=lo&0xFFF;
    const shade={r:255,g:255,b:255,a:255},tex={r:255,g:255,b:255,a:255};
    const ca=!!(rs.combine.hi||rs.combine.lo);if(ca)this._setupCombine();
    const base=ca?this.combineColor(shade,tex):shade;
    const blA=this.blenderActive();
    const key=cyc+'|com'+(rs.combine.hi>>>0).toString(16)+'/'+(rs.combine.lo>>>0).toString(16)+'|om'+(rs.otherModeLo>>>0).toString(16);
    if(!seen.has(key))seen.set(key,{rect:[x1>>2,y1>>2,x2>>2,y2>>2],base:[base.r,base.g,base.b,base.a],blActive:blA,fill:(rs.fillColor>>>0).toString(16),count:0});
    seen.get(key).count++;
  }
  return oF(hi,lo);
};
const ADV=parseInt(process.env.ADV||'30');const startF=(rcp.f3dex2TaskCount|0)+(rcp.f3dTaskCount|0);
const t0=Date.now();let bs=0;
for(let s=0;s<200000000;s++){cpu.step();
  if((s&0x3FFF)===0){const f=(rcp.f3dex2TaskCount|0)+(rcp.f3dTaskCount|0);if(f-startF>=ADV)break;if(Date.now()-t0>30000)break;}}
console.error('total 1/2-cyc fillrects',perFrame,'distinct',seen.size);
for(const [k,v] of seen)console.error('x'+v.count,k,'\n   ',JSON.stringify(v));
