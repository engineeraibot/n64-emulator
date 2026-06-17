process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {makeFakeCanvas}=require('./tmp_glsim');
const {N64GLRenderer}=require('./gl-renderer');
const L=console.error.bind(console);
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE||'state_oot_scene',ram,mmu,cpu,rcp);
const canvas=makeFakeCanvas(640,480);
const glr=new N64GLRenderer(canvas);glr.attach(rcp);
const ADV=parseInt(process.env.ADV||'250');const startF=rcp.f3dex2TaskCount|0;
const t0=Date.now();let bs=0;
for(let s=0;s<500000000;s++){try{cpu.step();}catch(e){L('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(f-startF>=ADV)break;if(Date.now()-t0>38000)break;}}
glr.flush();
L('glr stats',JSON.stringify(glr.stats),'targets',glr.targets.size);
let best=null;for(const t of glr.targets.values()){if(!best||t.lastUse>best.lastUse)best=t;}
if(!best){L('NO GL TARGETS');process.exit(1);}
const snap=glr.readTarget(best.addr);const W=snap.width,H=snap.height;let nb=0;
for(let i=0;i<snap.data.length;i+=4)if(snap.data[i]>12||snap.data[i+1]>12||snap.data[i+2]>12)nb++;
L('GL nonBlack',nb,'of',W*H,'target 0x'+best.addr.toString(16));
function crc32(b){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<b.length;n++)crc=t[(crc^b[n])&0xFF]^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;}
function wpng(rgba,w,h,out){function ch(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;raw.set(rgba.subarray(y*w*4,(y+1)*w*4),y*(w*4+1)+1);}fs.writeFileSync(out,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));}
const rgba=Buffer.from(snap.data);for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
wpng(rgba,W,H,process.env.OUT_PNG||'test-results/oot_gl_t56.png');L('wrote',process.env.OUT_PNG);
