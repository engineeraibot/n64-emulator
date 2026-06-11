const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
console.log=()=>{};
rcp.f3dTaskCount=0;
let tileObj=null,tileIdx=0;
const origSample=rcp.sampleTexture.bind(rcp);
rcp.sampleTexture=function(s,t,ti){const r=origSample(s,t,ti);if(!tileObj&&rcp.f3dTaskCount>=1){tileObj=rcp.rspState.tiles[ti];tileIdx=ti;}return r;};
const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){break;}if((s&0x1FFFF)===0){if(rcp.f3dTaskCount>=3)break;if(Date.now()-t0>40000)break;}}
const tile=tileObj, tmem=rcp.tmem;
const W=80,H=20;
function sampleSwz(ts,tt,mode){
  const wordGroup=ts>>2, texelInWord=ts&3;
  let wi=tile.tmem+tt*tile.line+wordGroup;
  if(mode===1 && (tt&1)) wi^=1;          // current
  if(mode===2){/* none */}
  if(mode===3 && (tt&1)) wi^=2;          // swap pairs of 2
  const p=wi*8+texelInWord*2; if(p+1>=4096)return 0;
  const v=(tmem[p]<<8)|tmem[p+1]; return (v&1);
}
for(const mode of [2,1,3]){
  realLog('=== mode '+(mode===2?'none':mode===1?'^1':'^2')+' ===');
  let out=[];
  for(let tt=0;tt<H;tt++){let line='';for(let ts=0;ts<W;ts++)line+=sampleSwz(ts,tt,mode)?'#':'.';out.push(line);}
  realLog(out.join('\n'));
}
