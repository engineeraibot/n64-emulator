const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_adv2', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const STOP=parseInt(process.env.STOPF3D||'18',10);rcp.f3dTaskCount=0;
const t0=Date.now();
// Run until a VI interrupt fires right after f3d>=STOP, then buffers are stable
for(let s=0;;s++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFFF)===0){if((rcp.f3dTaskCount|0)>=STOP)break;if(Date.now()-t0>38000)break;}}
const b=new Uint8Array(ram.rdram);const FB_W=320,FB_H=240;
function dump(origin){const out=Buffer.alloc(FB_W*FB_H*4);let p=0;const bpp=2;
 for(let y=0;y<FB_H;y++)for(let x=0;x<FB_W;x++){const a=(origin+(y*FB_W+x)*bpp)&0x7FFFFF;const v=(b[a]<<8)|b[a+1];
  out[p++]=((v>>11)&31)<<3;out[p++]=((v>>6)&31)<<3;out[p++]=((v>>1)&31)<<3;out[p++]=255;}return out;}
function nb(rgba){let n=0;for(let i=0;i<rgba.length;i+=4)if(rgba[i]>12||rgba[i+1]>12||rgba[i+2]>12)n++;return n;}
function crc32(buf){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<buf.length;n++)crc=t[(crc^buf[n])&0xFF]^(crc>>>8);return (crc^0xFFFFFFFF)>>>0;}
function wp(rgba,out){function ch(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const bb=Buffer.concat([Buffer.from(ty,'binary'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(bb),0);return Buffer.concat([l,bb,c]);}
 const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ih=Buffer.alloc(13);ih.writeUInt32BE(FB_W,0);ih.writeUInt32BE(FB_H,4);ih[8]=8;ih[9]=6;
 const st=FB_W*4;const raw=Buffer.alloc((st+1)*FB_H);for(let y=0;y<FB_H;y++){raw[y*(st+1)]=0;rgba.copy(raw,y*(st+1)+1,y*st,(y+1)*st);}
 fs.writeFileSync(out,Buffer.concat([sig,ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));}
fs.mkdirSync('test-results',{recursive:true});
const viO=(mmu.viRegisters[1]&0x7FFFFF)>>>0;
realLog('VI origin=0x'+viO.toString(16),'f3d',rcp.f3dTaskCount|0);
for(const o of [0x38f800,0x3b5000,0x3da800,viO]){const r=dump(o);realLog('buf 0x'+o.toString(16),'nonBlack',nb(r));wp(r,'test-results/buf_'+o.toString(16)+'.png');}
