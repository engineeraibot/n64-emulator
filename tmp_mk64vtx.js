process.env.ROM='Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_mk64_race', ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const startF=rcp.f3dTaskCount|0;
const STOP=startF+2;
let auditOn=false,shown=0;
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  if(auditOn && shown<14){
    const xs=[v1.x,v2.x,v3.x],ys=[v1.y,v2.y,v3.y];
    const xspan=Math.max(...xs)-Math.min(...xs), yspan=Math.max(...ys)-Math.min(...ys);
    if(Math.max(...ys)<120 && xspan>180 && yspan<50){
      shown++;
      const f=(v)=>`(x${v.x.toFixed(0)} y${v.y.toFixed(0)} z${(v.z||0).toFixed(2)} w${(v.w||v.cw||0).toFixed(1)} s${(v.s||0).toFixed(0)} t${(v.t||0).toFixed(0)})`;
      log('STREAK',f(v1),f(v2),f(v3),'tile'+(this.rspState.currentTile|0),'comb0x'+((this.rspState.combine&&this.rspState.combine.hi)>>>0).toString(16));
    }
  }
  return origDraw(v1,v2,v3);
};
for(let s=0;s<400000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0;auditOn=(f>=STOP-1);if(f>=STOP)break;}}
log('done shown',shown);
