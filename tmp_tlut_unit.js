// Deterministic unit test: G_LOADTLUT + CI8/CI4 sampling. Keep as regression check.
const {buildMachine}=require('./tmp_boot.js');
const {ram,mmu,rcp}=buildMachine();
rcp.initRspState();
const rs=rcp.rspState;
function w8(a,v){mmu.write8(a,v);}
// --- Build a 256-entry RGBA16 TLUT in RDRAM at 0x100000: entry i = r=i>>3 g=0 b=31-(i>>3) a=1
const TL=0x100000;
for(let i=0;i<256;i++){const r=(i>>3)&0x1F,b=(31-(i>>3))&0x1F;const v=(r<<11)|(0<<6)|(b<<1)|1;w8(TL+i*2,v>>8);w8(TL+i*2+1,v&0xFF);}
rs.textureImage=TL; rs.useTexture=true;
// LOADTLUT into tile 7, tmem=256, count=256: hi uls=0 lo lrs=(255*4)
rcp.handleG_SETTILE((0<<21)|(2<<19)|(0<<9)|256, (7<<24)); // load tile 7, tmem 256
rcp.handleG_LOADTLUT(0, (7<<24)|((255*4)<<12));
// --- TEST1 CI8: indices 0..255 row in TMEM at 0, render tile 0
for(let i=0;i<64;i++)rcp.tmem[i]=i*4; // one row of 64 CI8 texels: idx=i*4
rcp.handleG_SETTILE((2<<21)|(1<<19)|(8<<9)|0, (0<<24)|(0<<20)|(6<<4)); // fmt CI size 8b line 8 tmem 0 pal 0 maskS 6
rcp.handleG_SETTILESIZE(0,(63<<2)<<12);
let ok=true;
for(const i of [0,10,63]){
  const c=rcp.sampleTexture(i*32,0,0); const idx=i*4;
  const er=((idx>>3)&0x1F)<<3, eb=((31-(idx>>3))&0x1F)<<3;
  if(c.r!==er||c.b!==eb||c.a!==255){ok=false;console.log('CI8 FAIL',i,c,er,eb);}
}
console.log('TEST1 CI8:',ok?'PASS':'FAIL');
// --- TEST2 CI4 with palette 2: reload TLUT as 16-entry palette at tmem=256+2*16
for(let i=0;i<16;i++){const v=((i*2)<<11)|((i)<<6)|(0<<1)|1;w8(TL+0x800+i*2,v>>8);w8(TL+0x800+i*2+1,v&0xFF);}
rs.textureImage=TL+0x800;
rcp.handleG_SETTILE((0<<21)|(2<<19)|(0<<9)|(256+2*16), (7<<24));
rcp.handleG_LOADTLUT(0,(7<<24)|((15*4)<<12));
for(let i=0;i<32;i++)rcp.tmem[i]=((i*2&0xF)<<4)|((i*2+1)&0xF); // CI4 pairs: texel2i=2i, texel2i+1=2i+1
rcp.handleG_SETTILE((2<<21)|(0<<19)|(4<<9)|0, (0<<24)|(2<<20)|(6<<4)); // CI4, pal 2
rcp.handleG_SETTILESIZE(0,(63<<2)<<12);
ok=true;
for(const i of [0,1,5,14,15]){
  const c=rcp.sampleTexture(i*32,0,0); const idx=i&0xF;
  const er=((idx*2)&0x1F)<<3, eg=(idx&0x1F)<<3;
  if(c.r!==er||c.g!==eg||c.a!==255){ok=false;console.log('CI4 FAIL',i,c,er,eg);}
}
console.log('TEST2 CI4 pal2:',ok?'PASS':'FAIL');
// --- TEST3 IA16 + IA4
rcp.tmem.fill(0);
for(let i=0;i<8;i++){rcp.tmem[i*2]=i*30;rcp.tmem[i*2+1]=255-i*30;}
rcp.handleG_SETTILE((3<<21)|(2<<19)|(2<<9)|0,(0<<24)|(6<<4));
rcp.handleG_SETTILESIZE(0,(7<<2)<<12);
ok=true;
for(const i of [0,3,7]){const c=rcp.sampleTexture(i*32,0,0);if(c.r!==i*30||c.a!==255-i*30){ok=false;console.log('IA16 FAIL',i,c);}}
console.log('TEST3 IA16:',ok?'PASS':'FAIL');
rcp.tmem[0]=((5<<1|1)<<4)|((2<<1)|0); // texel0: i3=5 a=1; texel1: i3=2 a=0
rcp.handleG_SETTILE((3<<21)|(0<<19)|(1<<9)|0,(0<<24)|(6<<4));
ok=true;
{const c0=rcp.sampleTexture(0,0,0),c1=rcp.sampleTexture(32,0,0);
 const e0=(5<<5)|(5<<2)|(5>>1), e1=(2<<5)|(2<<2)|(2>>1);
 if(c0.r!==e0||c0.a!==255){ok=false;console.log('IA4 FAIL t0',c0,e0);}
 if(c1.r!==e1||c1.a!==0){ok=false;console.log('IA4 FAIL t1',c1,e1);}}
console.log('TEST4 IA4:',ok?'PASS':'FAIL');
