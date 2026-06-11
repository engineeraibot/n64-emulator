const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_hold1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const b=new Uint8Array(ram.rdram);
function str(a){a&=0x7FFFFF;let s='';for(let i=0;i<48;i++){const c=b[a+i];if(c===0)break;s+=(c>=32&&c<127)?String.fromCharCode(c):'.';}return s;}
// find "maketestdl" and "PRESS" and "Super Mario" strings in RDRAM
function findStr(needle){const N=Buffer.from(needle);let hits=[];for(let i=0;i<b.length-N.length;i++){let ok=true;for(let j=0;j<N.length;j++){if(b[i+j]!==N[j]){ok=false;break;}}if(ok){hits.push(i);if(hits.length>=5)break;}}return hits.map(h=>'0x80'+(h).toString(16).padStart(6,'0'));}
realLog('maketestdl @',findStr('maketestdl').join(' '));
realLog('PRESS @',findStr('PRESS').join(' '));
realLog('gdm_ @',findStr('gdm_').join(' '));
realLog('dynlist @',findStr('dynlist').join(' '));
realLog('gd_main @',findStr('gd_main').join(' '));
