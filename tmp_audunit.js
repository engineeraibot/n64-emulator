const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const rd=new DataView(mmu.memory.rdram);
// 1) put a sine (s16, BE) at 0x2000: 32 samples
const NS=32;
for(let i=0;i<NS;i++){const v=Math.round(8000*Math.sin(i/NS*2*Math.PI));rd.setInt16(0x2000+i*2,v,false);}
// 2) build command list at 0x1000
let p=0x1000;
function cmd(w0,w1){rd.setUint32(p,w0>>>0,false);rd.setUint32(p+4,w1>>>0,false);p+=8;}
cmd(0x08000040,0x00000040);              // SETBUFF in=0x40 out=0 count=0x40
cmd(0x04000000,0x00002000);              // LOADBUFF from 0x2000 -> DMEM[0x40]
cmd(0x08000040,0x01400040);              // SETBUFF in=0x40 out=0x140 count=0x40
cmd(0x05018000,0x00003000);              // RESAMPLE 1:1 init, state 0x3000
cmd(0x06000000,0x00004000);              // SAVEBUFF DMEM[0x140] count0x40 -> 0x4000
const size=p-0x1000;
rcp.runAudioTask(0x1000,size);
// verify output ~ input
let maxErr=0,nz=0;
for(let i=0;i<NS;i++){const a=rd.getInt16(0x2000+i*2,false);const b=rd.getInt16(0x4000+i*2,false);if(b!==0)nz++;maxErr=Math.max(maxErr,Math.abs(a-b));}
console.log('resample 1:1 -> nonzero',nz,'/',NS,'maxErr',maxErr);

// 3) test MIXER: mix 0x4000-loaded buf into a cleared out and check sum
// clear DMEM[0x300] count 0x40, load sine into 0x40, mix 0x40 -> 0x300 with gain 0x7fff
p=0x1000;
cmd(0x02000300,0x00000040);              // CLEARBUFF dmem=0x300 count=0x40
cmd(0x08000040,0x00000040);              // SETBUFF in=0x40 count=0x40
cmd(0x04000000,0x00002000);              // LOADBUFF -> DMEM[0x40]
cmd(0x0c007fff,0x00400300);              // MIXER gain0x7fff in=0x40 out=0x300 (count=0x40)
cmd(0x08030040,0x03000040);              // SETBUFF out=0x300 count=0x40  (in=0x40)
cmd(0x06000000,0x00005000);              // SAVEBUFF DMEM[0x300] -> 0x5000
rcp.runAudioTask(0x1000,p-0x1000);
let mxErr=0;
for(let i=0;i<NS;i++){const a=rd.getInt16(0x2000+i*2,false);const b=rd.getInt16(0x5000+i*2,false);
  const exp=Math.max(-32768,Math.min(32767,(a*0x7fff)>>15));mxErr=Math.max(mxErr,Math.abs(exp-b));}
console.log('mixer gain~1.0 -> maxErr',mxErr);

// 4) test INTERLEAVE: L=0x40(sine) R=0x300 -> out 0x600, then save
p=0x1000;
cmd(0x08000040,0x00000080);              // SETBUFF in=0x40 count=0x80 (out=0)
cmd(0x04000000,0x00002000);              // LOADBUFF sine->0x40 (0x80 bytes=64 samp; only 32 valid)
cmd(0x08000040,0x06000080);              // SETBUFF in=0x40 out=0x600 count=0x80
cmd(0x0d000000,0x00400040);              // INTERLEAVE L=0x40 R=0x40 -> out=0x600 count=0x80
cmd(0x08060600,0x06000080);              // SETBUFF out=0x600 count=0x80
cmd(0x06000000,0x00006000);              // SAVEBUFF -> 0x6000
rcp.runAudioTask(0x1000,p-0x1000);
// interleaved L,R,L,R; with L==R should equal duplicated
let ilOk=true;
for(let k=0;k<8;k++){const l=rd.getInt16(0x6000+k*4,false);const r=rd.getInt16(0x6000+k*4+2,false);if(l!==r)ilOk=false;}
console.log('interleave L==R duplicated ->', ilOk?'OK':'FAIL', 'sample0',rd.getInt16(0x6000,false));
