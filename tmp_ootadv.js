process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {saveState,loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
if(process.env.INSTATE)loadState(process.env.INSTATE,ram,mmu,cpu,rcp);
const ADV=parseInt(process.env.ADV||'400',10);
const startF=rcp.f3dex2TaskCount|0;
let maxTris=0,cimgEver=0,firstCimgF=-1,firstTriF=-1;
const origDraw=rcp.drawTriangle.bind(rcp);
let taskTris=0;
rcp.drawTriangle=function(a,b,c){taskTris++;if(firstTriF<0)firstTriF=rcp.f3dex2TaskCount|0;return origDraw(a,b,c);};
const origProc=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(addr,ds){taskTris=0;const r=origProc(addr,ds);if(taskTris>maxTris)maxTris=taskTris;
  if((this.rspState.colorImage>>>0)!==0){if(firstCimgF<0)firstCimgF=rcp.f3dex2TaskCount|0;cimgEver=this.rspState.colorImage>>>0;}return r;};
const t0=Date.now();let bs=0;const PRESSAT=process.env.PRESSAT?parseInt(process.env.PRESSAT):-1;
for(let s=0;s<500000000;s++){try{cpu.step();}catch(e){log('THREW',s,e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;
    if(PRESSAT>=0){const ph=(f-startF)%60;let w=(ph>=PRESSAT&&ph<PRESSAT+8)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}}
    if(f-startF>=ADV){log('reached f3dex2',f,'step',s);break;}if(Date.now()-t0>33000){log('[budget]',s,'f3dex2',f);break;}}}
if(process.env.OUTSTATE){saveState(process.env.OUTSTATE,ram,mmu,cpu,rcp);log('saved',process.env.OUTSTATE);}
log('f3dex2',rcp.f3dex2TaskCount,'maxTris/task',maxTris,'firstTriAt',firstTriF,'firstCimgAt',firstCimgF,'cimgEver=0x'+cimgEver.toString(16));
const rd=new Uint8Array(mmu.memory.rdram);
function scan(o){let nb=0;for(let i=0;i<320*240;i++){const p=o+i*2;const v=(rd[p]<<8)|rd[p+1];if(((v>>11)&31)>1||((v>>6)&31)>1||((v>>1)&31)>1)nb++;}return nb;}
let viO=((mmu.viRegisters[1])>>>0)&0x7FFFFF;let bestO=viO,bestN=scan(viO);
for(let o=0x100000;o<0x7d0000;o+=0x800){const nb=scan(o);if(nb>bestN){bestN=nb;bestO=o;}}
log('VI=0x'+viO.toString(16),'nb='+scan(viO),'best=0x'+bestO.toString(16),'nb='+bestN);
function crc32(b){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<b.length;n++)crc=t[(crc^b[n])&0xFF]^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;}
function wpng(rgba,w,h,out){function ch(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;const st=w*4;const raw=Buffer.alloc((st+1)*h);for(let y=0;y<h;y++){raw[y*(st+1)]=0;rgba.copy(raw,y*(st+1)+1,y*st,(y+1)*st);}fs.writeFileSync(out,Buffer.concat([sig,ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));}
const useO=process.env.USEBEST?bestO:viO;const W=320,H=240,o2=Buffer.alloc(W*H*4);let p=0;for(let i=0;i<W*H;i++){const q=useO+i*2;const v=(rd[q]<<8)|rd[q+1];o2[p++]=((v>>11)&31)<<3;o2[p++]=((v>>6)&31)<<3;o2[p++]=((v>>1)&31)<<3;o2[p++]=255;}
fs.mkdirSync('test-results',{recursive:true});wpng(o2,W,H,process.env.OUT_PNG||'test-results/ootadv.png');log('wrote',process.env.OUT_PNG,'from 0x'+useO.toString(16));
