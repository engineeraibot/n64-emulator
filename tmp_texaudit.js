// Dump every distinct texture (tile snapshot) used during the final f3d task.
const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_title_fix', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
const STOPF3D=parseInt(process.env.STOPF3D||'2',10);
function crc32(b){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<b.length;n++)crc=t[(crc^b[n])&0xFF]^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;}
function writePng(rgba,w,h,out){function ch(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}
 const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 const st=w*4;const raw=Buffer.alloc((st+1)*h);for(let y=0;y<h;y++){raw[y*(st+1)]=0;rgba.copy(raw,y*(st+1)+1,y*st,(y+1)*st);}
 fs.writeFileSync(out,Buffer.concat([sig,ch('IHDR',ihdr),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));}
const seen=new Set();
let auditOn=false, dumpId=0;
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  if(auditOn && this.rspState.useTexture){
    const rs=this.rspState; const ti=rs.currentTile|0; const tile=rs.tiles[ti];
    const wT=tile.lrs>tile.uls?(((tile.lrs-tile.uls)>>2)+1):0;
    const hT=tile.lrt>tile.ult?(((tile.lrt-tile.ult)>>2)+1):0;
    if(wT>0&&hT>0&&wT<=128&&hT<=128){
      // fingerprint = tile cfg + tmem contents crc
      const fp=[tile.tmem,tile.line,tile.format,tile.size,wT,hT,crc32(Buffer.from(this.tmem.slice(0,4096)))].join('_');
      if(!seen.has(fp)){
        seen.add(fp);
        const out=Buffer.alloc(wT*hT*4);let p=0;
        for(let y=0;y<hT;y++)for(let x=0;x<wT;x++){
          const tx=this.sampleTexture(((tile.uls>>2)+x)*32,((tile.ult>>2)+y)*32,ti);
          out[p++]=tx.r;out[p++]=tx.g;out[p++]=tx.b;out[p++]=255;
        }
        const f=`test-results/texaudit-${String(dumpId).padStart(2,'0')}-f${tile.format}s${tile.size}-${wT}x${hT}.png`;
        writePng(out,wT,hT,f);
        realLog('dump',f,'tmem',tile.tmem,'line',tile.line,'scaleS',rs.textureScaleS.toFixed(3),'scaleT',rs.textureScaleT.toFixed(3),
          'vtx s/t range',[v1,v2,v3].map(v=>`(${(v.s/32).toFixed(1)},${(v.t/32).toFixed(1)})`).join(' '));
        dumpId++;
      }
    }
  }
  return origDraw(v1,v2,v3);
};
const t0=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0xFFF)===0){
    const f=rcp.f3dTaskCount|0;
    auditOn = f>=STOPF3D-1;
    if(f>=STOPF3D){realLog('reached f3d',f);break;}
    if(Date.now()-t0>40000){realLog('[budget] f3d',f);break;}
  }
}
realLog('dumped',dumpId,'textures');
