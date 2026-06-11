const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_title_full', ram, mmu, cpu, rcp);
const realLog=console.log; global.console={log:()=>{},warn:()=>{},error:()=>{}};
for(let i=0;i<parseInt(process.env.N||'8000000',10);i++) cpu.step();
const src=new Uint8Array(mmu.memory.rdram);
function nb(origin){let n=0;const W=320,H=240;for(let y=0;y<H;y++){for(let x=0;x<W;x++){const a=(origin+(y*W+x)*2)&0x7FFFFF;const v=(src[a]<<8)|src[a+1];const r=(v>>11)&31,g=(v>>6)&31,b=(v>>1)&31;if(r>1||g>1||b>1)n++;}}return n;}
const vo=mmu.viRegisters[1]&0x7FFFFF;
realLog('VI_ORIGIN=0x'+vo.toString(16),'-> drawBase=0x'+((vo-0x280)&0x7FFFFF).toString(16));
for(const o of [0x38f800,0x3b5000,0x3da800]){realLog('buf 0x'+o.toString(16),'nonBlack',nb(o), (o===((vo-0x280)&0x7FFFFF))?'<== DISPLAYED':'');}
realLog('history origins:', rcp.videoTargetHistory.map(c=>'0x'+c.origin.toString(16)+'(tri'+c.triangles+',seq'+c.sequence+')').slice(-6).join(' '));
const sel=rcp.getDeterministicVideoTarget(vo, mmu.viRegisters[2]&0xFFF, mmu.viRegisters[0]&0x3);
realLog('CURRENT getDeterministic picks: origin=0x'+(sel?sel.origin.toString(16):'null')+' source='+(sel?sel.source:'-'));
