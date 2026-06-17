process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_title',ram,mmu,cpu,rcp);
const rd=new Uint8Array(mmu.memory.rdram);
let n=0;
const oD=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){
  if(n<3){const rs=this.rspState;
    const zAddr=rs.depthImage&0x7FFFFF;const w=rs.colorImageWidth;
    const px=a.x|0,py=a.y|0;const zp=(zAddr+(py*w+px)*2)&0x7FFFFF;
    const curZ=(rd[zp]<<8)|rd[zp+1];
    log('gm=0x'+(rs.geometryMode>>>0).toString(16)+' ZBUF(bit0)='+(rs.geometryMode&1)+' depthImg=0x'+zAddr.toString(16)+' colorImg=0x'+(rs.colorImage>>>0).toString(16));
    log('  tri z='+a.z.toFixed(4)+' zFixed='+Math.floor(a.z*0xFFFF)+' curZ@pixel='+curZ+' depthReject='+(Math.floor(a.z*0xFFFF)>curZ));
    log('  colorImageWidth='+w+' scissor? otherModeLo=0x'+(rs.otherModeLo>>>0).toString(16));
    n++;}
  return oD(a,b,c);
};
const startF=rcp.f3dex2TaskCount|0;const t0=Date.now();
for(let s=0;s<200000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){if((rcp.f3dex2TaskCount|0)-startF>=2)break;if(Date.now()-t0>30000)break;}}
