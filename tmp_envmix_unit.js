// Deterministic unit test for A_ENVMIXER (exp) + A_SETVOL (SM64 audio ABI).
// Uses no-ramp configs (vol==target, rate=0 → step stays 0) so the gain/mix/route
// math is hand-computable, plus a state-persistence round-trip check.
const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const rd=new DataView(mmu.memory.rdram);
function clamp16(v){return v>32767?32767:(v<-32768?-32768:v);}

function buildCmds(){let p=0x1000;const start=p;const cmd=(w0,w1)=>{rd.setUint32(p,w0>>>0,false);rd.setUint32(p+4,w1>>>0,false);p+=8;};return {cmd,run:()=>rcp.runAudioTask(start,p-start)};}

// --- TEST 1: n=2 (dry only), vol=target=0x4000, dry=0x7FFF, wet=0 ---
{
  // input: 32 samples = 1000 at DMEM[0..63]; clear outputs
  for(let i=0;i<32;i++) rcp.adSetS16(i*2,1000);
  for(let i=0;i<64;i++) rcp.adSetS16(0x100+i*2,0); // dl region
  for(let i=0;i<64;i++) rcp.adSetS16(0x200+i*2,0); // dr region
  for(let i=0;i<40;i++) rd.setInt16(0xB000+i*2,0,false); // state block
  const {cmd,run}=buildCmds();
  cmd(0x09087FFF,0x00000000); // SETVOL A_AUX: dry=0x7FFF, wet=0
  cmd(0x09064000,0x00000000); // SETVOL vol left  (A_LEFT|A_VOL)=0x06 -> vol[0]=0x4000
  cmd(0x09044000,0x00000000); // SETVOL vol right (A_VOL)=0x04        -> vol[1]=0x4000
  cmd(0x09024000,0x00000000); // SETVOL target left (A_LEFT)=0x02     -> target[0]=0x4000 rate0=0
  cmd(0x09004000,0x00000000); // SETVOL target right (0)              -> target[1]=0x4000 rate1=0
  cmd(0x08080200,0x03000400); // SETBUFF A_AUX: dry_right=0x200 wet_left=0x300 wet_right=0x400
  cmd(0x08000000,0x01000040); // SETBUFF: in=0 out=0x100 count=0x40 (32 samples)
  cmd(0x03010000,0x0000B000); // ENVMIXER init, state @ 0xB000
  run();
  // l_vol=0x4000=16384; g0 = ((16384*32767)+0x4000)>>15 = 16384; dl=(1000*16384)>>15=500
  const g0=clamp16(((16384*32767)+0x4000)>>15);
  const expDl=clamp16((1000*g0)>>15);
  let fail=0;
  for(let i=0;i<32;i++){const dl=rcp.adGetS16(0x100+i*2),dr=rcp.adGetS16(0x200+i*2);
    if(dl!==expDl||dr!==expDl){fail++; if(fail<=3)console.log('  idx',i,'dl',dl,'dr',dr,'exp',expDl);}}
  // state persistence: saved val[0]==0x4000<<16, wet(byte0)==0, dry(byte4)==0x7FFF
  const savedVal0=rd.getInt32(0xB000+32,false), savedWet=rd.getInt16(0xB000+0,false), savedDry=rd.getInt16(0xB000+4,false);
  const stOk = (savedVal0===(0x4000*65536)) && (savedWet===0) && (savedDry===32767);
  console.log('TEST1 n=2 dry mix (expDl='+expDl+'):', fail===0?'PASS':'FAIL('+fail+')');
  console.log('TEST1 state round-trip:', stOk?'PASS':'FAIL val0='+savedVal0+' wet='+savedWet+' dry='+savedDry);
}

// --- TEST 2: n=4 (dry+wet), vol=target=0x4000, dry=wet=0x4000 ---
{
  for(let i=0;i<32;i++) rcp.adSetS16(i*2,1000);
  for(const b of [0x100,0x200,0x300,0x400]) for(let i=0;i<64;i++) rcp.adSetS16(b+i*2,0);
  for(let i=0;i<40;i++) rd.setInt16(0xB000+i*2,0,false);
  const {cmd,run}=buildCmds();
  cmd(0x09084000,0x00004000); // SETVOL A_AUX: dry=0x4000, wet=0x4000
  cmd(0x09064000,0x00000000); // vol left  = 0x4000
  cmd(0x09044000,0x00000000); // vol right = 0x4000
  cmd(0x09024000,0x00000000); // target left  = 0x4000
  cmd(0x09004000,0x00000000); // target right = 0x4000
  cmd(0x08080200,0x03000400); // aux buffers
  cmd(0x08000000,0x01000040); // in=0 out=0x100 count=0x40
  cmd(0x03090000,0x0000B000); // ENVMIXER init|aux
  run();
  const g=clamp16(((16384*16384)+0x4000)>>15); // 8192
  const expv=clamp16((1000*g)>>15);            // 250
  let fail=0;
  for(let i=0;i<32;i++){
    const dl=rcp.adGetS16(0x100+i*2),dr=rcp.adGetS16(0x200+i*2),wl=rcp.adGetS16(0x300+i*2),wr=rcp.adGetS16(0x400+i*2);
    if(dl!==expv||dr!==expv||wl!==expv||wr!==expv){fail++; if(fail<=3)console.log('  idx',i,dl,dr,wl,wr,'exp',expv);}}
  console.log('TEST2 n=4 dry+wet mix (exp='+expv+'):', fail===0?'PASS':'FAIL('+fail+')');
}
