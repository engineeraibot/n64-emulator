const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
console.log=()=>{};
const STOPF3D=parseInt(process.env.STOPF3D||'3',10);
rcp.f3dTaskCount=0;
// capture tile params at the moment we first record a transparent sample
let cap=null;
const origSample=rcp.sampleTexture.bind(rcp);
rcp.sampleTexture=function(s,t,ti){const r=origSample(s,t,ti);
  if(!cap && rcp.f3dTaskCount>=1){const tile=rcp.rspState.tiles[ti];cap={ti,tile:JSON.parse(JSON.stringify(tile)),scaleS:rcp.rspState.textureScaleS,scaleT:rcp.rspState.textureScaleT};}
  return r;};
const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0x1FFFF)===0){if((rcp.f3dTaskCount|0)>=STOPF3D)break;if(Date.now()-t0>40000)break;}}
if(!cap){realLog('no capture');process.exit(0);}
realLog('tile',cap.ti,'fmt',cap.tile.format,'size',cap.tile.size,'line',cap.tile.line,'tmem',cap.tile.tmem,'maskS',cap.tile.maskS,'maskT',cap.tile.maskT);
realLog('scaleS',cap.scaleS,'scaleT',cap.scaleT);
// Dump alpha bit grid using sampleTexture directly across ts/tt
const W=80,H=20;
let rows=[];
for(let tt=0;tt<H;tt++){let line='';let opaque=0;
  for(let ts=0;ts<W;ts++){const r=rcp.sampleTexture(ts*32+1, tt*32+1, cap.ti);
    // undo textureScaleS: sampleTexture multiplies? no, it divides s/32. s passed already raw. but rasterizer multiplies by scaleS. Here pass raw texel coords*32.
    const op=r.a>=128?1:0;opaque+=op;line+=op?'#':'.';}
  rows.push(line+'  op='+opaque);}
realLog(rows.join('\n'));
