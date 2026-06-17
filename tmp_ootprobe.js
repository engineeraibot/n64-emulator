process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
let tris=0,cimgSet=0,setcimgCalls=0,vtxCalls=0;
const opHist={};
// hook processDisplayList opcodes via histogram already in rcp (dlOpcodeHistogram)
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){tris++;return origDraw(a,b,c);};
const t0=Date.now();
for(let s=0;s<300000000;s++){try{cpu.step();}catch(e){log('THREW',s,e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0;if(f>=120){log('reached f3d',f,'step',s);break;}if(Date.now()-t0>34000){log('[budget]',s,'f3d',f);break;}}}
log('ucode:',rcp.rspState&&rcp.rspState.ucodeName,'isEX2',rcp.rspState&&rcp.rspState.isF3DEX2,'idxScale',rcp.rspState&&rcp.rspState.triIndexScale);
log('f3dTasks',rcp.f3dTaskCount,'f3dex2',rcp.f3dex2TaskCount|0,'rspTasks',rcp.rspTaskCount,'audio',rcp.audioTasksRun|0);
log('tris drawn:',tris,'colorImage=0x'+(rcp.rspState.colorImage>>>0).toString(16),'cimgW',rcp.rspState.colorImageWidth);
// dump opcode histogram
const h=rcp.dlOpcodeHistogram||{};
const ents=Object.entries(h).map(([k,v])=>[parseInt(k),v]).sort((a,b)=>b[1]-a[1]);
log('--- DL opcode histogram (hex:count) ---');
log(ents.slice(0,24).map(e=>'0x'+e[0].toString(16)+':'+e[1]).join('  '));
// segments
log('segments:',(rcp.rspState.segments||[]).map((x,i)=>x?('['+i+']=0x'+(x>>>0).toString(16)):null).filter(Boolean).join(' '));
