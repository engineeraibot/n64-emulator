process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
const pcHist={};
const t0=Date.now();let n=0;
for(let s=0;s<500000000;s++){
  try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0xFFF)===0){const pc=(cpu.pc>>>0);pcHist[pc]=(pcHist[pc]||0)+1;n++;}
  if((s&0x3FFFF)===0){if((rcp.f3dex2TaskCount|0)>=500)break;if(Date.now()-t0>30000)break;}
}
log('samples',n,'f3dex2',rcp.f3dex2TaskCount|0);
const ents=Object.entries(pcHist).sort((a,b)=>b[1]-a[1]).slice(0,12);
log('--- hottest PCs ---');
ents.forEach(e=>log('PC=0x'+(parseInt(e[0])>>>0).toString(16)+' hits='+e[1]+' ('+(100*e[1]/n).toFixed(1)+'%)'));
// Check what's at the hottest PC region in RAM (is it a wait loop?)
log('osTime/threadinfo: pc range spread =',Object.keys(pcHist).length,'distinct sampled PCs');
