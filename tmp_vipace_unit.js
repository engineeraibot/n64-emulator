// Unit/functional test for the VI vblank wall-clock pacer (Task #46).
// NB: in-sandbox the machine runs BELOW real time (~4 vblank/s vs 50), so the
// browser's "menus run 4-5x" case can't occur natively here. Part A therefore
// runs the REAL machine + REAL pacer logic with the target period as a test
// knob (500ms/vblank => target 2/s, which the machine DOES outrun); Part B
// drives the pacer with a synthetic clock to prove rate-lock, no-debt
// (no fast-forward burst after a slow stretch), and disengagement when behind.
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');

// --- pacer factory: algorithm identical to script.js (clock/period injectable) ---
function makePacer(mmu, rcp, nowFn, periodOverride){
  let viPaceCount=-1, viPaceStamp=0;
  return ()=>{
    if(((rcp.f3dTaskCount|0)+(rcp.f3dex2TaskCount|0))<1) return false;
    const c=mmu.viInterruptCount|0;
    const t=nowFn();
    const periodMs=periodOverride!==undefined?periodOverride:((mmu.viRegisters[6]&0x3FF)>0x240?20:50/3);
    if(viPaceCount<0){viPaceCount=c;viPaceStamp=t;return false;}
    const ahead=(c-viPaceCount)-(t-viPaceStamp)/periodMs;
    if(ahead<=0){viPaceCount=c;viPaceStamp=t;return false;}
    return ahead>1;
  };
}

// ---- Part A: real machine, knobbed period ----
function runMachine(periodMs, seconds){
  const {ram,mmu,rcp,cpu}=buildMachine();
  loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
  const pacer = periodMs===0 ? ()=>false : makePacer(mmu,rcp,()=>performance.now(),periodMs);
  const t0=performance.now(), c0=mmu.viInterruptCount|0;
  let steps=0;
  while(performance.now()-t0<seconds*1000){
    if(pacer()){ const u=performance.now()+4; while(performance.now()<u){} continue; }
    const ss=performance.now(); let s=0;
    while(s<250000){ cpu.step();s++;steps++; if((s&0x3FF)===0&&performance.now()-ss>=8)break; }
  }
  const dt=(performance.now()-t0)/1000;
  return {vps:((mmu.viInterruptCount|0)-c0)/dt, mips:steps/dt/1e6};
}
const SEC=parseFloat(process.env.SEC||'5');
const free=runMachine(0,SEC);
const clamped=runMachine(500,SEC);   // target 2 vblank/s — machine produces ~4/s free
console.log(`A: free ${free.vps.toFixed(2)} vbl/s (${free.mips.toFixed(2)}M steps/s) | paced@500ms ${clamped.vps.toFixed(2)} vbl/s`);
const aOK = free.vps>3 && clamped.vps>=1.7 && clamped.vps<=2.7;

// ---- Part B: synthetic clock, pure pacer behavior ----
let T=0; const mmuS={viInterruptCount:0,viRegisters:new Int32Array(16)}; mmuS.viRegisters[6]=0x271; // PAL
const rcpS={f3dTaskCount:1,f3dex2TaskCount:0};
const pacer=makePacer(mmuS,rcpS,()=>T); // real PAL period 20ms
// Emulator 4x real time: a vblank every 5ms of wall when running. Loop in 1ms ticks.
let produced=0;
for(let acc=0;T<10000;T+=1){ if(!pacer()){acc+=1; if(acc>=5){acc-=5;mmuS.viInterruptCount++;produced++;}} }
const fastRate=produced/10; // per second over 10s
// Slow stretch: emulator only manages a vblank every 100ms for 5s.
let slowStart=mmuS.viInterruptCount;
for(let acc=0;T<15000;T+=1){ if(!pacer()){acc+=1; if(acc>=100){acc-=100;mmuS.viInterruptCount++;}} }
const slowRate=(mmuS.viInterruptCount-slowStart)/5;
// Fast again: MUST NOT burst above ~50/s to repay the slow stretch (no debt).
let fastStart=mmuS.viInterruptCount;
for(let acc=0;T<25000;T+=1){ if(!pacer()){acc+=1; if(acc>=5){acc-=5;mmuS.viInterruptCount++;}} }
const fast2Rate=(mmuS.viInterruptCount-fastStart)/10;
console.log(`B: fast ${fastRate.toFixed(1)}/s (want ~50) | slow ${slowRate.toFixed(1)}/s (want ~10, unthrottled) | post-slow fast ${fast2Rate.toFixed(1)}/s (want ~50, NO burst)`);
const bOK = fastRate>=48&&fastRate<=52.5 && slowRate>=9&&slowRate<=10.5 && fast2Rate>=48&&fast2Rate<=52.5;

console.log((aOK&&bOK)?'PASS':`FAIL (A=${aOK} B=${bOK})`);
process.exit(aOK&&bOK?0:1);
