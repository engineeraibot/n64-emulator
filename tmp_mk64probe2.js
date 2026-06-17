process.env.ROM = process.env.ROM || 'Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);

let sampled=0, vtxDump=0, pixWrites=0;
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){
  if(sampled<6 && (rcp.f3dTaskCount|0)>=80){
    log(`tri: A(${a.x|0},${a.y|0},s${a.s},t${a.t}) B(${b.x|0},${b.y|0},s${b.s},t${b.t}) C(${c.x|0},${c.y|0},s${c.s},t${c.t}) useTex=${this.rspState.useTexture} texEn=${this.rspState.textureEnabled} scaleS=${this.rspState.textureScaleS} cimg=0x${(this.rspState.colorImage>>>0).toString(16)}`);
    sampled++;
  }
  return origDraw(a,b,c);
};
// Hook G_VTX to dump raw vertex bytes once
const origVtx=rcp.handleG_VTX.bind(rcp);
rcp.handleG_VTX=function(hi,lo){
  if(vtxDump<3 && (rcp.f3dTaskCount|0)>=80){
    const num=((hi&0xFFFF)>>>4)&0x3F, dest=(hi>>>16)&0xF;
    const addr=this.resolveAddress(lo);
    log(`G_VTX hi=0x${(hi>>>0).toString(16)} lo=0x${(lo>>>0).toString(16)} num=${num} dest=${dest} addr=0x${addr.toString(16)}`);
    for(let i=0;i<Math.min(num,2);i++){
      const v=addr+i*16;const b=[];for(let k=0;k<16;k++)b.push(this.mmu.read8(v+k).toString(16).padStart(2,'0'));
      log('  vtx'+i+': '+b.join(' '));
    }
    vtxDump++;
  }
  return origVtx(hi,lo);
};

const STOP=parseInt(process.env.STOPF3D||'90',10);
const t0=Date.now();
for(let s=0;s<200000000;s++){
  try{cpu.step();}catch(e){log('THREW',s,e.message);break;}
  if((s&0x3FFF)===0){
    if((rcp.f3dTaskCount|0)>=STOP){log('reached f3d',rcp.f3dTaskCount,'step',s);break;}
    if(Date.now()-t0>40000){log('[budget]',s,'f3d',rcp.f3dTaskCount|0);break;}
  }
}
log('useTexture flag now:',rcp.rspState.useTexture,'tile',rcp.rspState.currentTile);
log('viewport:',JSON.stringify(rcp.rspState.viewport));
