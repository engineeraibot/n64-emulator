process.env.ROM='Mario Kart 64 (Europe) (Rev A).n64';
const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_mk64_race', ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const WANT=(parseInt(process.env.COMB||'60b2c1',16))>>>0;
const STOP=(rcp.f3dTaskCount|0)+2;
let auditOn=false, cap=null;
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  if(auditOn && !cap && this.rspState.useTexture){
    const rs=this.rspState; const ch=(rs.combine&&rs.combine.hi)>>>0;
    if(ch===WANT){const t=rs.tiles[rs.currentTile|0]; cap={tile:JSON.parse(JSON.stringify(t)),tmem:Uint8Array.from(this.tmem)};}
  }
  return origDraw(v1,v2,v3);
};
for(let s=0;s<400000000;s++){try{cpu.step();}catch(e){log(e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0;auditOn=(f>=STOP-1);if(f>=STOP||cap)break;}}
if(!cap){log('not captured');process.exit(1);}
const {tile,tmem}=cap;
const W=tile.lrs>tile.uls?(((tile.lrs-tile.uls)>>2)+1):64;
const H=tile.lrt>tile.ult?(((tile.lrt-tile.ult)>>2)+1):32;
log('fmt',tile.format,'sz',tile.size,'tmem',tile.tmem,'line',tile.line,'pal',tile.palette,'W',W,'H',H,'cm',tile.cmS,tile.cmT,'mask',tile.maskS,tile.maskT);
function crc32(b){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<b.length;n++)crc=t[(crc^b[n])&0xFF]^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;}
function wpng(rgba,w,h,out){function ch(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;const st=w*4;const raw=Buffer.alloc((st+1)*h);for(let y=0;y<h;y++){raw[y*(st+1)]=0;rgba.copy(raw,y*(st+1)+1,y*st,(y+1)*st);}fs.writeFileSync(out,Buffer.concat([sig,ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));}
const ww=Math.min(W,128),hh=Math.min(H,64);const out=Buffer.alloc(ww*hh*4);let p=0;
for(let y=0;y<hh;y++)for(let x=0;x<ww;x++){
  const pp=(tile.tmem*8 + y*tile.line*8 + (tile.size===1?x:x>>1))&4095;
  const idx=tile.size===1?tmem[pp]:(x&1?tmem[pp]&0xF:tmem[pp]>>4);
  const palOff=2048+(tile.palette*16+idx)*2;
  const v=(tmem[palOff]<<8)|tmem[palOff+1];
  out[p++]=((v>>11)&31)<<3;out[p++]=((v>>6)&31)<<3;out[p++]=((v>>1)&31)<<3;out[p++]=255;
}
fs.mkdirSync('test-results',{recursive:true});wpng(out,ww,hh,'test-results/mk64_sky_'+process.env.COMB+'.png');log('wrote',ww+'x'+hh);
