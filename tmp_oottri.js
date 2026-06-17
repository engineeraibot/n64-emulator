process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_title',ram,mmu,cpu,rcp);
let dt=0,dr=0,df=0;
const oD=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){
  if(dt<5){log('TRI A('+(a.x|0)+','+(a.y|0)+' s'+(a.s|0)+' t'+(a.t|0)+' rgb '+a.r+','+a.g+','+a.b+') B('+(b.x|0)+','+(b.y|0)+') C('+(c.x|0)+','+(c.y|0)+') useTex='+this.rspState.useTexture+' comb.lo=0x'+(this.rspState.combine.lo>>>0).toString(16)+' tile='+this.rspState.currentTile+' texImg=0x'+(this.rspState.textureImage>>>0).toString(16)+' fmt='+this.rspState.tiles[this.rspState.currentTile].format+' siz='+this.rspState.tiles[this.rspState.currentTile].size);dt++;}
  return oD(a,b,c);
};
const oR=rcp.handleG_TEXRECT.bind(rcp);
rcp.handleG_TEXRECT=function(hi,lo,pc,flip,o){
  if(dr<5){log('TEXRECT cimg=0x'+(this.rspState.colorImage>>>0).toString(16)+' tile='+((hi>>>8)&7)+' useTex='+this.rspState.useTexture+' comb.lo=0x'+(this.rspState.combine.lo>>>0).toString(16));dr++;}
  return oR(hi,lo,pc,flip,o);
};
const oF=rcp.handleG_FILLRECT.bind(rcp);
rcp.handleG_FILLRECT=function(hi,lo){
  if(df<5){log('FILLRECT fillColor=0x'+(this.rspState.fillColor>>>0).toString(16)+' cimg=0x'+(this.rspState.colorImage>>>0).toString(16)+' depthImg=0x'+(this.rspState.depthImage>>>0).toString(16));df++;}
  return oF(hi,lo);
};
const startF=rcp.f3dex2TaskCount|0;const t0=Date.now();
for(let s=0;s<200000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){if((rcp.f3dex2TaskCount|0)-startF>=3)break;if(Date.now()-t0>30000)break;}}
log('done');
