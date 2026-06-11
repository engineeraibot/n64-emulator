// Task #35 deterministic unit tests: SETOTHERMODE masked RMW, 2-cycle combiner,
// 2-cycle blender, RGBA32 sampling. Keep as a regression check.
const {buildMachine}=require('./tmp_boot');
const {rcp}=buildMachine();
rcp.initRspState();
const rs=rcp.rspState;
let fails=0;
function chk(name,got,want,tol=0.51){const ok=Math.abs(got-want)<=tol;if(!ok)fails++;console.log((ok?'PASS':'FAIL'),name,'got',got,'want',want);}

// ---- 1. _otherModeRMW: F3DEX2 gsDPSetCycleType(G_CYC_2CYCLE) ----
// shift=20,len=2 -> w0 len-1=1, shiftcompl=32-20-2=10 -> hi=0xE3000A01, w1=1<<20
rs.otherModeHi=0x00ABCDEF; // pre-existing bits to preserve outside 20-21
let v=rcp._otherModeRMW(rs.otherModeHi,0xE3000A01,1<<20,true);
chk('RMW ex2 sets cyc bits',(v>>>20)&3,1,0);
chk('RMW ex2 preserves low bits',v&0xFFFFF,0x0ABCDEF&0xFFFFF,0);
chk('RMW ex2 preserves high bits',(v>>>22)>>>0,(0x00ABCDEF>>>22)>>>0,0);
// F3D form: shift=(w0>>>8)&0xFF=20, len=w0&0xFF=2
v=rcp._otherModeRMW(0x00ABCDEF,0xBA001402,2<<20,false);
chk('RMW f3d sets cyc bits',(v>>>20)&3,2,0);
chk('RMW f3d preserves others',v&0xFFFFF,0x0ABCDEF&0xFFFFF,0);

// ---- 2. 2-cycle combiner ----
// cycle0: rgb=(TEXEL0-0)*SHADE/255+0, a=SHADE
// cycle1: rgb=(COMBINED-0)*PRIM/255+ENV, a=(COMBINED-0)*SHADE/255+0
const cA=1,cB=15,cC=4,cD=7, aA=7,aB=7,aC=7,aD=4;
const cA1=0,cB1=15,cC1=3,cD1=5, aA1=0,aB1=7,aC1=4,aD1=7;
rs.combine={hi:((cA<<20)|(cC<<15)|(aA<<12)|(aC<<9)|(cA1<<5)|cC1)>>>0,
            lo:((cB<<28)|(cB1<<24)|(aA1<<21)|(aC1<<18)|(cD<<15)|(aB<<12)|(aD<<9)|(cD1<<6)|(aB1<<3)|aD1)>>>0};
rs.primColor=0x80604020; // p r=128 g=96 b=64 a=32
rs.envColor=0x10203040;  // e r=16 g=32 b=48 a=64
rs.otherModeHi=1<<20;    // 2CYCLE
rcp._setupCombine();
const shade={r:200,g:100,b:50,a:150}, tex={r:90,g:180,b:240,a:255};
let c=rcp.combineColor(shade,tex);
function c255(x){return Math.max(0,Math.min(255,x))|0;} // mirror clamp255's |0 truncation
const r0=c255((tex.r*shade.r)/255), g0=c255((tex.g*shade.g)/255), b0=c255((tex.b*shade.b)/255), a0=c255(shade.a);
chk('2cyc r',c.r,c255((r0*128)/255+16));
chk('2cyc g',c.g,c255((g0*96)/255+32));
chk('2cyc b',c.b,c255((b0*64)/255+48));
chk('2cyc a',c.a,c255((a0*shade.a)/255));
// 1-cycle mode must ignore the cycle-1 fields entirely
rs.otherModeHi=0; rcp._setupCombine(); c=rcp.combineColor(shade,tex);
chk('1cyc r unchanged',c.r,r0); chk('1cyc a unchanged',c.a,a0);

// ---- 3. 2-cycle blender: cycle0 fog, cycle1 mem composite ----
// lo: p0=3(fog) a0=2(shadeA) m0=0(px) b0=0(1-A); p1=0(px) a1=0(combA) m1=1(mem) b1=0(1-A)
rs.otherModeLo=((3<<30)|(0<<28)|(2<<26)|(0<<24)|(0<<22)|(1<<20)|(0<<18)|(0<<16))>>>0;
rs.otherModeHi=1<<20;
rs.fogColor=0xC0A08060; // fog r=192 g=160 b=128 a=96
rs.blendColor=0;
chk('blenderActive 2cyc fog',rcp.blenderActive()?1:0,1,0);
rcp._setupBlend();
const px={r:100,g:120,b:140,a:128}, mem={r:10,g:20,b:30,a:255};
const A0=px.a/255, B0=1-A0;
const s1r=c255(192*A0+px.r*B0), s1g=c255(160*A0+px.g*B0), s1b=c255(128*A0+px.b*B0); // truncated like the code
const A1=px.a/255, Bm=1-A1;
let bl=rcp.blendPixel(px,mem,undefined);
chk('2cyc blend r',bl.r,c255(s1r*A1+mem.r*Bm),1.1);
chk('2cyc blend g',bl.g,c255(s1g*A1+mem.g*Bm),1.1);
chk('2cyc blend b',bl.b,c255(s1b*A1+mem.b*Bm),1.1);
// 1-cycle path unchanged: IM_RD off -> inactive
rs.otherModeHi=0;
chk('blenderActive 1cyc imrd-off',rcp.blenderActive()?1:0,0,0);

// ---- 4. RGBA32 sampling ----
rs.useTexture=true; rs.textureImage={addr:0};
const tile=rs.tiles[0];
tile.format=0; tile.size=3; tile.tmem=0; tile.line=4; tile.maskS=4; tile.maskT=4;
tile.cmS=0; tile.cmT=0; tile.shiftS=0; tile.shiftT=0; tile.uls=0; tile.ult=0; tile.lrs=15<<2; tile.lrt=15<<2;
rcp.tmem[0]=11;rcp.tmem[1]=22;rcp.tmem[2]=33;rcp.tmem[3]=44; // texel (0,0)
rcp.tmem[4]=55;rcp.tmem[5]=66;rcp.tmem[6]=77;rcp.tmem[7]=88; // texel (1,0)
let tx=rcp.sampleTexture(0,0,0);
chk('rgba32 t00 r',tx.r,11,0);chk('rgba32 t00 a',tx.a,44,0);
tx=rcp.sampleTexture(32,0,0); // s=32 -> ts=1
chk('rgba32 t10 g',tx.g,66,0);chk('rgba32 t10 b',tx.b,77,0);
console.log(fails===0?'ALL PASS':'FAILURES: '+fails);
