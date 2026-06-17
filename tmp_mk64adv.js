process.env.ROM='Mario Kart 64 (Europe) (Rev A).n64';
const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {saveState,loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
const IN=process.env.INSTATE||'';
if(IN)loadState(IN,ram,mmu,cpu,rcp);
const STOP=parseInt(process.env.STOPF3D||'400',10);
const START=0x1000,A=0x8000;
const t0=Date.now();
let lastPress=-1,btnState=0;
for(let s=0;s<400000000;s++){
  try{cpu.step();}catch(e){log('THREW',s,e.message);break;}
  if((s&0x3FFF)===0){
    const f=rcp.f3dTaskCount|0;
    // Toggle START every ~40 frames: press for ~10 frames then release (edge detect)
    const phase=(f%40);
    let want = (phase<6)? (START|A):0;
    if(want!==btnState){mmu.updateController(want,0,0);btnState=want;}
    if(f>=STOP){log('reached f3d',f,'step',s);break;}
    if(Date.now()-t0>34000){log('[budget]',s,'f3d',f);break;}
  }
}
const OUTSTATE=process.env.OUTSTATE||'';
if(OUTSTATE){saveState(OUTSTATE,ram,mmu,cpu,rcp);log('saved',OUTSTATE,'at f3d',rcp.f3dTaskCount|0);}
// render VI buffer
const rd=new Uint8Array(mmu.memory.rdram);
function scan(o){let nb=0;for(let i=0;i<320*240;i++){const p=o+i*2;const v=(rd[p]<<8)|rd[p+1];if(((v>>11)&31)>1||((v>>6)&31)>1||((v>>1)&31)>1)nb++;}return nb;}
let viO=((mmu.viRegisters[1])>>>0)&0x7FFFFF;
let bestO=viO,bestN=scan(viO);
for(let o=0x100000;o<0x7d0000;o+=0x800){const nb=scan(o);if(nb>bestN){bestN=nb;bestO=o;}}
log('VI=0x'+viO.toString(16),'nb='+scan(viO),'best=0x'+bestO.toString(16),'nb='+bestN,'f3d',rcp.f3dTaskCount|0);
function crc32(b){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<b.length;n++)crc=t[(crc^b[n])&0xFF]^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;}
function wpng(rgba,w,h,out){function ch(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;const st=w*4;const raw=Buffer.alloc((st+1)*h);for(let y=0;y<h;y++){raw[y*(st+1)]=0;rgba.copy(raw,y*(st+1)+1,y*st,(y+1)*st);}fs.writeFileSync(out,Buffer.concat([sig,ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));}
const useO=process.env.USEBEST?bestO:viO;
const W=320,H=240,o2=Buffer.alloc(W*H*4);let p=0;for(let i=0;i<W*H;i++){const q=useO+i*2;const v=(rd[q]<<8)|rd[q+1];o2[p++]=((v>>11)&31)<<3;o2[p++]=((v>>6)&31)<<3;o2[p++]=((v>>1)&31)<<3;o2[p++]=255;}
fs.mkdirSync('test-results',{recursive:true});wpng(o2,W,H,process.env.OUT_PNG||'test-results/mk64adv.png');log('wrote',process.env.OUT_PNG||'test-results/mk64adv.png','from 0x'+useO.toString(16));
