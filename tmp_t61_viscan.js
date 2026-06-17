// Task #61: scan the actual DISPLAYED framebuffer (VI_ORIGIN) for distinct frames,
// so we catch texrect-only screens (a title/Triforce screen the triangle-gated
// probe would miss). Drives from INSTATE, optionally pulsing START.
process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState,saveState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
const IN=process.env.INSTATE||'state_oot_drive4';
loadState(IN,ram,mmu,cpu,rcp);
const rd=new Uint8Array(mmu.memory.rdram);
const ADV=parseInt(process.env.ADV||'4000');
const HOLD_START=process.env.NOSTART!=='1';
const MAXSAVE=parseInt(process.env.MAXSAVE||'30');

function readFB(){const type=mmu.viRegisters[0]&3;if(type<2)return null;const width=mmu.viRegisters[2]&0xFFF;if(width<160||width>700)return null;const origin=mmu.viRegisters[1]&0x7FFFFF;if(origin<0x1000)return null;const h=240;const bpp=(type===3)?4:2;const need=width*h*bpp;if(origin+need>rd.length)return null;return {origin,width,type,buf:Buffer.from(Buffer.from(rd.buffer,origin,need))};}
function nbScan(fb){const {buf,width,type}=fb;let nb=0;const h=240;if(type===3){for(let i=0;i<width*h;i++){if(buf[i*4]>8||buf[i*4+1]>8||buf[i*4+2]>8)nb++;}}else{for(let i=0;i<width*h;i++){const v=(buf[i*2]<<8)|buf[i*2+1];if(((v>>11)&31)>1||((v>>6)&31)>1||((v>>1)&31)>1)nb++;}}return nb;}
function fingerprint(fb){const {buf,width,type}=fb;const fp=new Array(16*12).fill(0);const h=240;for(let gy=0;gy<12;gy++)for(let gx=0;gx<16;gx++){let s=0,n=0;const x0=(gx*width/16)|0,x1=((gx+1)*width/16)|0,y0=gy*20,y1=gy*20+20;for(let y=y0;y<y1;y+=4)for(let x=x0;x<x1;x+=4){const i=y*width+x;let lum;if(type===3){lum=buf[i*4]+buf[i*4+1]+buf[i*4+2];}else{const v=(buf[i*2]<<8)|buf[i*2+1];lum=(((v>>11)&31)+((v>>6)&31)+((v>>1)&31))<<3;}s+=lum;n++;}fp[gy*16+gx]=s/n;}return fp;}
function fpDist(a,b){let d=0;for(let i=0;i<a.length;i++)d+=Math.abs(a[i]-b[i]);return d;}
function crc32(b){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<b.length;n++)crc=t[(crc^b[n])&0xFF]^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;}
function wpng(rgba,w,h,out){function ch(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;const st=w*4;const raw=Buffer.alloc((st+1)*h);for(let y=0;y<h;y++){raw[y*(st+1)]=0;rgba.copy(raw,y*(st+1)+1,y*st,(y+1)*st);}fs.writeFileSync(out,Buffer.concat([sig,ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));}
function savePng(fb,name){const {buf,width,type}=fb;const W=width,H=240,o2=Buffer.alloc(W*H*4);let p=0;for(let i=0;i<W*H;i++){if(type===3){o2[p++]=buf[i*4];o2[p++]=buf[i*4+1];o2[p++]=buf[i*4+2];o2[p++]=255;}else{const v=(buf[i*2]<<8)|buf[i*2+1];o2[p++]=((v>>11)&31)<<3;o2[p++]=((v>>6)&31)<<3;o2[p++]=((v>>1)&31)<<3;o2[p++]=255;}}fs.mkdirSync('test-results',{recursive:true});wpng(o2,W,H,name);}

let lastFp=null,saved=0,frames=0;
const t0=Date.now();const startF=rcp.f3dex2TaskCount|0;let bs=0,lastVi=mmu.viInterruptCount|0;
for(let s=0;s<800000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x1FFF)===0){const vi=mmu.viInterruptCount|0;
    if(vi!==lastVi){lastVi=vi;const fb=readFB();if(fb){frames++;const nb=nbScan(fb);if(nb>300){const fp=fingerprint(fb);const dist=lastFp?fpDist(lastFp,fp):1e9;if(dist>200&&saved<MAXSAVE){const f=rcp.f3dex2TaskCount|0;const name='test-results/oot_vi_'+String(saved).padStart(2,'0')+'_vi'+vi+'_f'+f+'_nb'+nb+'_t'+fb.type+'.png';savePng(fb,name);log('SAVE',name,'fpDist',dist|0,'orig0x'+fb.origin.toString(16));lastFp=fp;saved++;}else if(!lastFp&&nb>300){lastFp=fp;}}}}
    const f=rcp.f3dex2TaskCount|0;
    if(HOLD_START){const ph=(f-startF)%48;let w=(ph<10)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}}
    if(f-startF>=ADV)break;if(Date.now()-t0>parseInt(process.env.BUDGET||'38000'))break;}}
log('done f3dex2 +'+((rcp.f3dex2TaskCount|0)-startF),'viFrames',frames,'saved',saved,'viInt',mmu.viInterruptCount|0);
if(process.env.OUTSTATE)saveState(process.env.OUTSTATE,ram,mmu,cpu,rcp);
