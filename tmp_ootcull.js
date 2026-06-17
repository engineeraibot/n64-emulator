process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_title',ram,mmu,cpu,rcp);
const rd=new Uint8Array(mmu.memory.rdram);
function scan(o){let nb=0;o&=0x7FFFFF;for(let i=0;i<320*240;i++){const p=o+i*2;const v=(rd[p]<<8)|rd[p+1];if(((v>>11)&31)>1||((v>>6)&31)>1||((v>>1)&31)>1)nb++;}return nb;}
// Count area signs of OoT tris and cull outcomes
let areaPos=0,areaNeg=0;
const oD=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){
  const area=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);
  if(area>0)areaPos++;else areaNeg++;
  return oD(a,b,c);
};
const DISABLE=process.env.NOCULL==='1';
if(DISABLE){
  // neutralize cull bits in geometryMode read by forcing area test off via patch
  // easier: wrap and clear cull bits each draw
}
let nf=0;
const oP=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(addr,ds){const r=oP(addr,ds);const ci=this.rspState.colorImage>>>0;if(ci&&nf<6){log('frame nb=0x'+ci.toString(16)+' nb='+scan(ci)+' culled='+(this.drawStats.culledTriangles|0)+' tris='+(this.drawStats.triangles|0)+' areaPos='+areaPos+' areaNeg='+areaNeg);nf++;}return r;};
const startF=rcp.f3dex2TaskCount|0;const t0=Date.now();
for(let s=0;s<200000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){if((rcp.f3dex2TaskCount|0)-startF>=8)break;if(Date.now()-t0>30000)break;}}
