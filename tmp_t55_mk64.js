process.env.ROM='Mario Kart 64 (Europe) (Rev A).n64';
const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState(process.env.INSTATE,ram,mmu,cpu,rcp);
const rd=new Uint8Array(mmu.memory.rdram);
let best=null,bestNb=0;
function nbScan(ci){let nb=0;for(let i=0;i<320*240;i++){const v=(rd[ci+i*2]<<8)|rd[ci+i*2+1];if(((v>>11)&31)>1||((v>>6)&31)>1||((v>>1)&31)>1)nb++;}return nb;}
const oP=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(a,d){const r=oP(a,d);const ci=(this.rspState.colorImage>>>0)&0x7FFFFF;const nb=nbScan(ci);if(nb>bestNb){bestNb=nb;best=Buffer.from(Buffer.from(rd.buffer,ci,320*240*2));}return r;};
const t0=Date.now();const startF=rcp.f3dex2TaskCount|0,startG=rcp.f3dTaskCount|0;
for(let s=0;s<200000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){if(((rcp.f3dex2TaskCount|0)+(rcp.f3dTaskCount|0))-(startF+startG)>=parseInt(process.env.ADV||'30'))break;if(Date.now()-t0>30000)break;}}
function crc32(b){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<b.length;n++)crc=t[(crc^b[n])&0xFF]^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;}
function wpng(rgba,w,h,out){function ch(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;const st=w*4;const raw=Buffer.alloc((st+1)*h);for(let y=0;y<h;y++){raw[y*(st+1)]=0;rgba.copy(raw,y*(st+1)+1,y*st,(y+1)*st);}fs.writeFileSync(out,Buffer.concat([sig,ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));}
if(best){const W=320,H=240,o2=Buffer.alloc(W*H*4);let p=0;for(let i=0;i<W*H;i++){const v=(best[i*2]<<8)|best[i*2+1];o2[p++]=((v>>11)&31)<<3;o2[p++]=((v>>6)&31)<<3;o2[p++]=((v>>1)&31)<<3;o2[p++]=255;}wpng(o2,W,H,process.env.OUT_PNG);}
log(process.env.INSTATE,'bestNb',bestNb);
