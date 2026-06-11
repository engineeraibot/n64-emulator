const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_hold1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const b=new Uint8Array(ram.rdram);
// search for osContStartReadData per-channel block: 01 04 01 ff (txlen,rxlen,cmd=1,...)
// and osContInit status block: 01 03 00 (txlen,rxlen,cmd=0)
function find(seq){let hits=[];for(let i=0;i<b.length-seq.length;i++){let ok=true;for(let j=0;j<seq.length;j++)if(b[i+j]!==seq[j]){ok=false;break;}if(ok){hits.push(i);if(hits.length>=6)break;}}return hits.map(h=>'0x'+h.toString(16));}
realLog('read-block 01 04 01 ff @',find([0x01,0x04,0x01,0xff]).join(' ')||'NONE');
realLog('status-block ff 01 03 00 @',find([0xff,0x01,0x03,0x00]).join(' ')||'NONE');
realLog('readfmt ff 01 04 01 @',find([0xff,0x01,0x04,0x01]).join(' ')||'NONE');
// __osContPifRam is in libultra .bss; dump SI event queue region guesses not needed.
// Also check gControllerBits-ish: search known SM64 EU? unknown. Instead check osContInit ran by scanning for 'type 0005' status struct (00 05 00 00) repeated
realLog('status 00 05 00 @',find([0x00,0x05,0x00,0x00]).slice(0,6).join(' ')||'NONE');
