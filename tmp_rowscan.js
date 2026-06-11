const fs=require('fs'),zlib=require('zlib');
function readPng(file){const b=fs.readFileSync(file);let o=8;let w,h,idat=[];
 while(o<b.length){const len=b.readUInt32BE(o);const ty=b.toString('binary',o+4,o+8);const d=b.slice(o+8,o+8+len);
  if(ty==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);}if(ty==='IDAT')idat.push(d);if(ty==='IEND')break;o+=12+len;}
 const raw=zlib.inflateSync(Buffer.concat(idat));const stride=w*4;const px=Buffer.alloc(w*h*4);
 for(let y=0;y<h;y++){const f=raw[y*(stride+1)];let off=y*(stride+1)+1;for(let x=0;x<stride;x++){let v=raw[off+x];if(f===1&&x>=4)v=(v+px[y*stride+x-4])&255;else if(f===2&&y>0)v=(v+px[(y-1)*stride+x])&255;else if(f===4){const a=x>=4?px[y*stride+x-4]:0,bb=y>0?px[(y-1)*stride+x]:0;v=(v+Math.floor((a+bb)/2))&255;}px[y*stride+x]=v;}}
 return {w,h,px};}
const {w,h,px}=readPng(process.argv[2]);
let line='';for(let y=0;y<h;y++){let nb=0;for(let x=0;x<w;x++){const i=(y*w+x)*4;if(px[i]+px[i+1]+px[i+2]>24)nb++;}line+=(nb>160?'#':nb>40?'+':nb>4?'.':' ');}
console.log(process.argv[2]); console.log(line);
