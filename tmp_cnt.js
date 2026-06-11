const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const targets=[0x802f5fa0,0x802f6040,0x802f607c,0x802f609c,0x802f6148,0x802f6170,0x802f6254,0x802f6284,0x802f62a4,0x802f6338,0x802f6380,0x802f63b8,0x802f6600,0x802f66a0,0x802f66dc,0x802f66fc,0x802f67e8,0x802f6810];
const set=new Set(targets.map(t=>t>>>0));
const cnt=new Map();
const STEPS=parseInt(process.env.STEPS||'42000000',10);
for(let s=0;s<STEPS;s++){ const pc=cpu.pc>>>0; if(set.has(pc)) cnt.set(pc,(cnt.get(pc)||0)+1); cpu.step(); }
console.log('f3d=',rcp.f3dTaskCount);
for(const t of targets) console.log('0x'+(t>>>0).toString(16),cnt.get(t>>>0)||0);
