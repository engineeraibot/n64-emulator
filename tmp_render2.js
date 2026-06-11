const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
console.log=()=>{};
const NOSWZ=process.env.NOSWZ==='1';
const DISCARD=process.env.DISCARD==='1';
// reimplement sampleTexture path via wrapper: easier to patch the two behaviors.
const origSample=rcp.sampleTexture.bind(rcp);
if(NOSWZ){
  // monkeypatch by overriding: temporarily set a flag the patched fn reads.
  // We can't change source; instead re-derive: wrap to re-sample with corrected addr.
}
// We patch by replacing sampleTexture with a copy that toggles swizzle & discard sentinel.
rcp.sampleTexture=function(s,t,tileIdx){
  if(!this.rspState.useTexture||!this.rspState.textureImage)return {r:255,g:255,b:255,a:255};
  const tile=this.rspState.tiles[tileIdx];
  let ts=Math.floor(s/32), tt=Math.floor(t/32);
  const applyShiftMask=(val,shift,mask)=>{if(shift>0&&shift<=10)val>>=shift;else if(shift>10)val<<=(16-shift);if(mask>0)val&=(1<<mask)-1;return val;};
  ts=applyShiftMask(ts,tile.shiftS,tile.maskS); tt=applyShiftMask(tt,tile.shiftT,tile.maskT);
  const wrapS=tile.maskS?(1<<tile.maskS):1024, wrapT=tile.maskT?(1<<tile.maskT):1024;
  ts=Math.abs(ts)%wrapS; tt=Math.abs(tt)%wrapT;
  if(tile.format===0&&tile.size===2){
    const wordGroup=ts>>2, texelInWord=ts&3;
    let wordIndex=tile.tmem+tt*tile.line+wordGroup;
    if(!NOSWZ && (tt&1)!==0) wordIndex^=1;
    const p=wordIndex*8+texelInWord*2;
    if(p+1>=4096)return {r:255,g:255,b:255,a:255};
    const v=(this.tmem[p]<<8)|this.tmem[p+1];
    return {r:((v>>11)&0x1F)<<3,g:((v>>6)&0x1F)<<3,b:((v>>1)&0x1F)<<3,a:(v&1)?255:0,_texelA:(v&1)};
  }
  return origSample(s,t,tileIdx);
};
// Patch rasterize-time discard: wrap combineColor to mark, but discard needs to skip write.
// Easier: wrap sampleTexture above returns a:0 for transparent; then patch rspState so the
// existing alpha gate fires. But gate uses combiner alpha. Instead we hook by making the
// combiner output alpha follow texel alpha when DISCARD set.
const origCombine=rcp.combineColor.bind(rcp);
let lastTexelA=1;
const s2=rcp.sampleTexture.bind(rcp);
rcp.sampleTexture=function(s,t,ti){const r=s2(s,t,ti);lastTexelA=(r._texelA!==undefined)?r._texelA:1;return r;};
rcp.combineColor=function(shade,tex){const c=origCombine(shade,tex);if(DISCARD && lastTexelA===0)c.a=0;return c;};

const STOPF3D=parseInt(process.env.STOPF3D||'20',10);
rcp.f3dTaskCount=0;
const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0x1FFFF)===0){if(rcp.f3dTaskCount>=STOPF3D)break;if(Date.now()-t0>38000)break;}}
const FB_W=320,FB_H=240;
function snapToRgba(snap){const d=snap.data,w=snap.width|0,h=snap.height|0,type=snap.type|0,bpp=type===3?4:2;const out=Buffer.alloc(FB_W*FB_H*4);let p=0;
 for(let y=0;y<FB_H;y++)for(let x=0;x<FB_W;x++){if(y<h&&x<w){const i=(y*w+x)*bpp;if(type===2&&i+1<d.length){const v=(d[i]<<8)|d[i+1];out[p++]=((v>>11)&31)<<3;out[p++]=((v>>6)&31)<<3;out[p++]=((v>>1)&31)<<3;out[p++]=255;}else if(type===3&&i+2<d.length){out[p++]=d[i];out[p++]=d[i+1];out[p++]=d[i+2];out[p++]=255;}else{out[p++]=0;out[p++]=0;out[p++]=0;out[p++]=255;}}else{out[p++]=0;out[p++]=0;out[p++]=0;out[p++]=255;}}return out;}
function crc32(buf){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<buf.length;n++)crc=t[(crc^buf[n])&0xFF]^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;}
function writePng(rgba,w,h,out){function chunk(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty,'binary'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;const stride=w*4;const raw=Buffer.alloc((stride+1)*h);for(let y=0;y<h;y++){raw[y*(stride+1)]=0;rgba.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride);}fs.writeFileSync(out,Buffer.concat([sig,chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
const snap=rcp.bestRichVideoSnapshot||rcp.lastRichVideoSnapshot;
const OUT=process.env.OUT_PNG||'test-results/menu.png';
fs.mkdirSync('test-results',{recursive:true});
if(snap){realLog('snap origin=0x'+(snap.origin>>>0).toString(16),'nonBlack='+snap.nonBlack,'f3d',rcp.f3dTaskCount|0,'NOSWZ',NOSWZ,'DISCARD',DISCARD);writePng(snapToRgba(snap),FB_W,FB_H,OUT);realLog('wrote',OUT);}
else realLog('no snapshot f3d',rcp.f3dTaskCount|0);
