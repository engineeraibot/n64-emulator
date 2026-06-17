process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {makeFakeCanvas}=require('./tmp_glsim');
const {N64GLRenderer}=require('./gl-renderer');
const L=console.error.bind(console);
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE||'state_oot_n64logo',ram,mmu,cpu,rcp);
const canvas=makeFakeCanvas(640,480);
const glr=new N64GLRenderer(canvas);glr.attach(rcp);
const ADV=parseInt(process.env.ADV||'60');const startF=rcp.f3dex2TaskCount|0;
const t0=Date.now();let bs=0;
for(let s=0;s<500000000;s++){try{cpu.step();}catch(e){L('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(f-startF>=ADV)break;if(Date.now()-t0>34000)break;}}
glr.flush();
L('stats',JSON.stringify(glr.stats),'targets',glr.targets.size);
for(const t of glr.targets.values()){const snap=glr.readTarget(t.addr);let nb=0;for(let i=0;i<snap.data.length;i+=4)if(snap.data[i]>12||snap.data[i+1]>12||snap.data[i+2]>12)nb++;L('target 0x'+t.addr.toString(16),'lastUse',t.lastUse,'nb',nb);}
