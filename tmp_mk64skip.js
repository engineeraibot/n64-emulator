process.env.ROM=process.env.ROM||'Mario Kart 64 (Europe) (Rev A).n64';
const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_mk64_race', ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const startF=rcp.f3dTaskCount|0;
const STOP=startF+parseInt(process.env.ADV||'2',10);
const SKIPCOMB=process.env.SKIPCOMB?(parseInt(process.env.SKIPCOMB,16)>>>0):-1;
const UPPERONLY=process.env.UPPERONLY?parseInt(process.env.UPPERONLY,10):-1;
let auditOn=false, skipped=0;
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  if(auditOn && SKIPCOMB>=0){const ch=(this.rspState.combine&&this.rspState.combine.hi)>>>0; if(ch===SKIPCOMB){skipped++;return;}}
  if(auditOn && UPPERONLY>=0){const ymin=Math.min(v1.y,v2.y,v3.y); if(ymin>=UPPERONLY){skipped++;return;}}
  return origDraw(v1,v2,v3);
};
for(let s=0;s<400000000;s++){
  try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0; auditOn=(f>=STOP-1); if(f>=STOP)break;}
}
log('skipped',skipped);
const rd=new Uint8Array(mmu.memory.rdram);
let viO=((mmu.viRegisters[1])>>>0)&0x7FFFFF;
function crc32(b){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<b.length;n++)crc=t[(crc^b[n])&0xFF]^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;}
function wpng(rgba,w,h,out){function ch(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;const st=w*4;const raw=Buffer.alloc((st+1)*h);for(let y=0;y<h;y++){raw[y*(st+1)]=0;rgba.copy(raw,y*(st+1)+1,y*st,(y+1)*st);}fs.writeFileSync(out,Buffer.concat([sig,ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));}
const W=320,H=240,o2=Buffer.alloc(W*H*4);
let p=0;
for(let i=0;i<W*H;i++){const q=viO+i*2;const v=(rd[q]<<8)|rd[q+1];o2[p++]=((v>>11)&31)<<3;o2[p++]=((v>>6)&31)<<3;o2[p++]=((v>>1)&31)<<3;o2[p++]=255;}
fs.mkdirSync('test-results',{recursive:true});
wpng(o2,W,H,process.env.OUT_PNG||'test-results/mk64skip.png');
log('wrote',process.env.OUT_PNG);
