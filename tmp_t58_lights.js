process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE||'state_oot_scene',ram,mmu,cpu,rcp);

let mmCalls=[];   // G_MOVEMEM_EX2 light decode log
let numlightSet=[];
let litTris=0, unlitTris=0;
let shadeSamples=[];

const oMM=rcp.handleG_MOVEMEM_EX2.bind(rcp);
rcp.handleG_MOVEMEM_EX2=function(hi,lo){
  const idx=hi&0xFF; const ofs=((hi>>>8)&0xFF)*8;
  const addr=this.resolveAddress(lo);
  if(idx===0x0A){
    const r=this.mmu.read8(addr),g=this.mmu.read8(addr+1),b=this.mmu.read8(addr+2);
    const c2r=this.mmu.read8(addr+4),c2g=this.mmu.read8(addr+5),c2b=this.mmu.read8(addr+6);
    const dx=(this.mmu.read8(addr+8)<<24)>>24,dy=(this.mmu.read8(addr+9)<<24)>>24,dz=(this.mmu.read8(addr+10)<<24)>>24;
    if(mmCalls.length<40)mmCalls.push({ofs,slot:((ofs/24)|0)-1,rgb:[r,g,b],col2:[c2r,c2g,c2b],dir:[dx,dy,dz]});
  }
  return oMM(hi,lo);
};

const oLit=rcp.computeLitShade.bind(rcp);
rcp.computeLitShade=function(nx,ny,nz){
  const s=oLit(nx,ny,nz);
  if(shadeSamples.length<20)shadeSamples.push({n:[+nx.toFixed(2),+ny.toFixed(2),+nz.toFixed(2)],rgb:[s.r,s.g,s.b]});
  return s;
};

const oD=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){
  if((this.rspState.geometryMode&0x00020000)!==0)litTris++;else unlitTris++;
  return oD(a,b,c);
};

const t0=Date.now();const startF=rcp.f3dex2TaskCount|0;let bs=0;
for(let s=0;s<500000000;s++){cpu.step();
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(f-startF>=250)break;if(Date.now()-t0>40000)break;}}

console.error('=== G_MV_LIGHT decode log (idx 0x0A) ===');
mmCalls.forEach(c=>console.error(JSON.stringify(c)));
console.error('numLights now',rcp.rspState.numLights,'geometryMode',('00000000'+(rcp.rspState.geometryMode>>>0).toString(16)).slice(-8));
console.error('G_LIGHTING set?',((rcp.rspState.geometryMode&0x00020000)!==0));
console.error('lit tris',litTris,'unlit tris',unlitTris);
console.error('lights array:');
(rcp.rspState.lights||[]).forEach((L,i)=>{if(L)console.error(' slot',i,JSON.stringify(L));});
console.error('=== computeLitShade samples ===');
shadeSamples.forEach(s=>console.error(JSON.stringify(s)));
