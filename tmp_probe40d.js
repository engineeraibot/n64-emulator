const fs=require('fs'),zlib=require('zlib');
function crc32(buf){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<buf.length;n++)crc=t[(crc^buf[n])&0xFF]^(crc>>>8);return (crc^0xFFFFFFFF)>>>0;}
function writePng(rgba,w,h,out){function chunk(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty,'binary'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
const raw=Buffer.alloc((w*4+1)*h);
for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;raw.set(rgba.subarray(y*w*4,(y+1)*w*4),y*(w*4+1)+1);}
fs.writeFileSync(out,Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
// crop+zoom helper from a full 320x240 RGBA buffer
function crop(buf,W,x0,y0,w,h,scale){const out=Buffer.alloc(w*scale*h*scale*4);
for(let y=0;y<h*scale;y++)for(let x=0;x<w*scale;x++){const sx=x0+(x/scale|0),sy=y0+(y/scale|0);const si=(sy*W+sx)*4,di=(y*w*scale+x)*4;out[di]=buf[si];out[di+1]=buf[si+1];out[di+2]=buf[si+2];out[di+3]=255;}return out;}
// load PNGs we already produced? Simpler: re-run GL quickly is slow; decode PNG instead.
function readPng(file){const d=fs.readFileSync(file);let pos=8;let w=0,h=0;const idat=[];
while(pos<d.length){const len=d.readUInt32BE(pos);const ty=d.toString('binary',pos+4,pos+8);const data=d.subarray(pos+8,pos+8+len);
if(ty==='IHDR'){w=data.readUInt32BE(0);h=data.readUInt32BE(4);}else if(ty==='IDAT')idat.push(data);pos+=12+len;}
const raw=zlib.inflateSync(Buffer.concat(idat));const out=Buffer.alloc(w*h*4);
for(let y=0;y<h;y++){const f=raw[y*(w*4+1)];const row=raw.subarray(y*(w*4+1)+1,(y+1)*(w*4+1));
if(f!==0){ // un-filter: support 0 only; our writer uses 0
  if(f===2&&y>0){for(let i=0;i<w*4;i++)row[i]=(row[i]+out[(y-1)*w*4+i])&0xFF;}
  else if(f===1){for(let i=4;i<w*4;i++)row[i]=(row[i]+row[i-4])&0xFF;}
}
out.set(row.subarray(0,w*4),y*w*4);}return{w,h,data:out};}
const gl=readPng('test-results/gl-titlefull.png');
const sw=readPng('test-results/sw-titlefull.png');
writePng(crop(gl.data,320,12,196,90,30,4),90*4,30*4,'test-results/crop-gl-start.png');
writePng(crop(sw.data,320,12,196,90,30,4),90*4,30*4,'test-results/crop-sw-start.png');
console.log('wrote crops');
