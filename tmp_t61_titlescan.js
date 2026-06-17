// Task #61: scan for an OoT title/Triforce frame out of state_oot_drive4
// Drives forward with the controller connected (START pulsed), captures each
// rendered frame, and saves a PNG whenever the displayed content changes a lot.
process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState,saveState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
const IN=process.env.INSTATE||'state_oot_drive4';
loadState(IN,ram,mmu,cpu,rcp);
const rd=new Uint8Array(mmu.memory.rdram);
const ADV=parseInt(process.env.ADV||'400');     // f3dex2 tasks to advance
const HOLD_START=process.env.NOSTART!=='1';
const MAXSAVE=parseInt(process.env.MAXSAVE||'24');

// per-frame capture: snapshot the colorImage the frame drew the most tris into
let curTris=0, curCi=0;
const oD=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){curTris++;curCi=(this.rspState.colorImage>>>0)&0x7FFFFF;return oD(a,b,c);};

function nbScan(buf){let nb=0;for(let i=0;i<320*240;i++){const v=(buf[i*2]<<8)|buf[i*2+1];if(((v>>11)&31)>1||((v>>6)&31)>1||((v>>1)&31)>1)nb++;}return nb;}
// coarse fingerprint: downsample to 16x12 average-luma grid
function fingerprint(buf){const fp=new Array(16*12).fill(0);for(let gy=0;gy<12;gy++)for(let gx=0;gx<16;gx++){let s=0,n=0;for(let y=gy*20;y<gy*20+20;y+=4)for(let x=gx*20;x<gx*20+20;x+=4){const i=y*320+x;const v=(buf[i*2]<<8)|buf[i*2+1];s+=((v>>11)&31)+((v>>6)&31)+((v>>1)&31);n++;}fp[gy*16+gx]=s/n;}return fp;}
function fpDist(a,b){let d=0;for(let i=0;i<a.length;i++)d+=Math.abs(a[i]-b[i]);return d;}

function crc32(b){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<b.length;n++)crc=t[(crc^b[n])&0xFF]^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;}
function wpng(rgba,w,h,out){function ch(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;const st=w*4;const raw=Buffer.alloc((st+1)*h);for(let y=0;y<h;y++){raw[y*(st+1)]=0;rgba.copy(raw,y*(st+1)+1,y*st,(y+1)*st);}fs.writeFileSync(out,Buffer.concat([sig,ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));}
function savePng(buf,name){const W=320,H=240,o2=Buffer.alloc(W*H*4);let p=0;for(let i=0;i<W*H;i++){const v=(buf[i*2]<<8)|buf[i*2+1];o2[p++]=((v>>11)&31)<<3;o2[p++]=((v>>6)&31)<<3;o2[p++]=((v>>1)&31)<<3;o2[p++]=255;}fs.mkdirSync('test-results',{recursive:true});wpng(o2,W,H,name);}

let lastFp=null, saved=0;
const oP=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(a,d){const before=curTris;const r=oP(a,d);const drew=curTris-before;
  if(drew>20){const ci=curCi;const buf=Buffer.from(Buffer.from(rd.buffer,ci,320*240*2));const nb=nbScan(buf);
    if(nb>500){const fp=fingerprint(buf);const dist=lastFp?fpDist(lastFp,fp):1e9;
      if(dist>120 && saved<MAXSAVE){const f=rcp.f3dex2TaskCount|0;const name='test-results/oot_t61_'+String(saved).padStart(2,'0')+'_f'+f+'_nb'+nb+'.png';savePng(buf,name);log('SAVE',name,'tris',drew,'fpDist',dist|0);lastFp=fp;saved++;}
      else if(!lastFp){lastFp=fp;}}}
  return r;};

const t0=Date.now();const startF=rcp.f3dex2TaskCount|0;let bs=0;
for(let s=0;s<800000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;
    if(HOLD_START){const ph=(f-startF)%48;let w=(ph<10)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}}
    if(f-startF>=ADV)break;if(Date.now()-t0>parseInt(process.env.BUDGET||'90000'))break;}}
log('done f3dex2 +'+((rcp.f3dex2TaskCount|0)-startF),'saved',saved,'viInt',mmu.viInterruptCount|0);
if(process.env.OUTSTATE)saveState(process.env.OUTSTATE,ram,mmu,cpu,rcp);
