process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE||'state_oot_drive4',ram,mmu,cpu,rcp);
const hist=new Map();
const N=parseInt(process.env.N||'40000000');
for(let i=0;i<N;i++){if((i&0x3FF)===0){const p=cpu.pc>>>0;hist.set(p,(hist.get(p)||0)+1);}cpu.step();}
const top=[...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);
console.error('top PCs (sampled 1/1024):');
for(const[p,c]of top)console.error('  0x'+p.toString(16),c);
console.error('distinct sampled PCs:',hist.size);
