// Reusable save/restore of full machine state for fast post-title debugging.
const fs=require('fs');
function saveState(file, ram, mmu, cpu, rcp){
  const meta={
    cpu:{
      gpr:Array.from(cpu.gpr), gprHi:Array.from(cpu.gprHi),
      cp0:Array.from(cpu.cp0Registers),
      fpr:Buffer.from(new Uint8Array(cpu.fprBuffer)).toString('base64'),
      fcr0:cpu.fcr0, fcr31:cpu.fcr31, pc:cpu.pc|0,
      hi:cpu.hi|0, lo:cpu.lo|0, hiH:cpu.hiH|0, loH:cpu.loH|0,
      compareArmed:cpu._compareArmed, lastFiredCompare:cpu._lastFiredCompare,
      instructionCount:cpu.instructionCount,
      isHleBootDone:cpu.isHleBootDone, isRunning:cpu.isRunning,
      branchTaken:cpu.branchTaken, branchTarget:cpu.branchTarget|0,
      tlb:cpu.tlbEntries.map(e=>e?{pageMask:e.pageMask,entryHi:e.entryHi,entryLo0:e.entryLo0,entryLo1:e.entryLo1}:null),
    },
    mmu:{
      vi:Array.from(mmu.viRegisters), mi:Array.from(mmu.miRegisters),
      pi:Array.from(mmu.piRegisters), si:Array.from(mmu.siRegisters),
      sp:Array.from(mmu.spRegisters), dpc:Array.from(mmu.dpcRegisters),
      ai:Array.from(mmu.aiRegisters), ri:Array.from(mmu.riRegisters),
      pifRam:Buffer.from(mmu.pifRam).toString('base64'),
      eeprom:Buffer.from(mmu.eeprom).toString('base64'),
      spDmem:Buffer.from(mmu.spDmem).toString('base64'),
      spImem:Buffer.from(mmu.spImem).toString('base64'),
      piBusyUntil:mmu.piBusyUntil, siBusyUntil:mmu.siBusyUntil,
      aiBusyUntil:mmu.aiBusyUntil, aiQueuedDuration:mmu.aiQueuedDuration,
      viNextInterrupt:mmu.viNextInterrupt, siDmaDirection:mmu.siDmaDirection,
      siDramAddr:mmu.siDramAddr, buttons:mmu.buttons, stickX:mmu.stickX, stickY:mmu.stickY,
    },
    rcp:{ f3dTaskCount:rcp.f3dTaskCount|0, rspTaskCount:rcp.rspTaskCount|0 },
  };
  fs.writeFileSync(file+'.rdram', Buffer.from(new Uint8Array(ram.rdram)));
  fs.writeFileSync(file+'.json', JSON.stringify(meta));
}
function loadState(file, ram, mmu, cpu, rcp){
  const rd=fs.readFileSync(file+'.rdram');
  new Uint8Array(ram.rdram).set(new Uint8Array(rd.buffer,rd.byteOffset,rd.byteLength));
  const m=JSON.parse(fs.readFileSync(file+'.json','utf8'));
  const c=m.cpu;
  cpu.gpr.set(c.gpr); cpu.gprHi.set(c.gprHi); cpu.cp0Registers.set(c.cp0);
  new Uint8Array(cpu.fprBuffer).set(Buffer.from(c.fpr,'base64'));
  cpu.fcr0=c.fcr0; cpu.fcr31=c.fcr31; cpu.pc=c.pc|0;
  cpu.hi=c.hi|0; cpu.lo=c.lo|0; cpu.hiH=c.hiH|0; cpu.loH=c.loH|0;
  cpu._compareArmed=c.compareArmed; cpu._lastFiredCompare=c.lastFiredCompare;
  cpu.instructionCount=c.instructionCount;
  cpu.isHleBootDone=c.isHleBootDone; cpu.isRunning=c.isRunning;
  cpu.branchTaken=c.branchTaken; cpu.branchTarget=c.branchTarget|0;
  cpu.tlbEntries=c.tlb.map(e=>e?{pageMask:e.pageMask,entryHi:e.entryHi,entryLo0:e.entryLo0,entryLo1:e.entryLo1}:null);
  cpu.fetchPage=-1; cpu.fetchView=null;
  const mm=m.mmu;
  mmu.viRegisters.set(mm.vi); mmu.miRegisters.set(mm.mi); mmu.piRegisters.set(mm.pi);
  mmu.siRegisters.set(mm.si); mmu.spRegisters.set(mm.sp); mmu.dpcRegisters.set(mm.dpc);
  mmu.aiRegisters.set(mm.ai); mmu.riRegisters.set(mm.ri);
  mmu.pifRam.set(Buffer.from(mm.pifRam,'base64'));
  mmu.eeprom.set(Buffer.from(mm.eeprom,'base64'));
  mmu.spDmem.set(Buffer.from(mm.spDmem,'base64'));
  mmu.spImem.set(Buffer.from(mm.spImem,'base64'));
  mmu.piBusyUntil=mm.piBusyUntil; mmu.siBusyUntil=mm.siBusyUntil;
  mmu.aiBusyUntil=mm.aiBusyUntil; mmu.aiQueuedDuration=mm.aiQueuedDuration;
  mmu.viNextInterrupt=mm.viNextInterrupt; mmu.siDmaDirection=mm.siDmaDirection;
  mmu.siDramAddr=mm.siDramAddr; mmu.buttons=mm.buttons; mmu.stickX=mm.stickX; mmu.stickY=mm.stickY;
  return m;
}
module.exports={saveState,loadState};
