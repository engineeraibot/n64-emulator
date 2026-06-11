const {buildMachine}=require('./tmp_boot');
const {mmu,cpu}=buildMachine();
let fails=0;
function chk(name,got,exp){const g=BigInt.asUintN(64,got),e=BigInt.asUintN(64,exp);
  if(g!==e){console.log("FAIL",name,"got 0x"+g.toString(16),"exp 0x"+e.toString(16));fails++;}
  else console.log("ok  ",name);}
const enc=(rs,rt,rd)=>((rs&31)<<21)|((rt&31)<<16)|((rd&31)<<11);
const r64=r=>cpu._reg64(r);

// ADDU overflow into negative -> sign-extend high = 0xFFFFFFFF
cpu.gpr[1]=0x7FFFFFFF; cpu.gprHi[1]=0; cpu.gpr[2]=1; cpu.gprHi[2]=0;
cpu.specialTable[0x20](enc(1,2,3)); chk("ADDU neg sext", r64(3), 0xFFFFFFFF80000000n);
// ADDU positive -> high 0
cpu.gpr[1]=1;cpu.gpr[2]=2; cpu.specialTable[0x20](enc(1,2,3)); chk("ADDU pos", r64(3), 3n);
// stale-high overwrite: r5 holds 64-bit, ADDIU small positive must clear high
cpu._setReg64(5, 0x1122334480000000n);
cpu.gpr[6]=5; cpu.gprHi[6]=0; // ADDIU rt=5 rs=6 imm=0
cpu.opADDIU((6<<21)|(5<<16)|0); chk("ADDIU clears stale high", r64(5), 5n);
// LUI sign-extend (0x8000<<16 = 0x80000000)
cpu.opLUI((0<<21)|(7<<16)|0x8000); chk("LUI sext", r64(7), 0xFFFFFFFF80000000n);
// full 64-bit OR
cpu._setReg64(8,0x00000000FF00FF00n); cpu._setReg64(9,0xAA00000000FFn);
cpu.specialTable[0x25](enc(8,9,10)); chk("OR 64bit", r64(10), 0x0000AA00FF00FFFFn);
// AND 64-bit
cpu._setReg64(8,0xFFFFFFFFFFFFFFFFn); cpu._setReg64(9,0x123456789ABCDEF0n);
cpu.specialTable[0x24](enc(8,9,11)); chk("AND 64bit", r64(11), 0x123456789ABCDEF0n);
// ANDI clears high; ORI/XORI preserve high
cpu._setReg64(8,0x11223344AABBCCDDn);
cpu.opANDI((8<<21)|(12<<16)|0xFF00); chk("ANDI high=0", r64(12), 0xCC00n);
cpu._setReg64(8,0x11223344000000FFn);
cpu.opORI((8<<21)|(13<<16)|0x0F00); chk("ORI keeps high", r64(13), 0x112233440FFFn);
// SLT result high 0 even if dest had stale high
cpu._setReg64(14,0xDEADBEEF00000000n); cpu.gpr[1]=-5;cpu.gpr[2]=3;
cpu.specialTable[0x2A](enc(1,2,14)); chk("SLT high0", r64(14), 1n);
// SRA sign-extend
cpu.gpr[1]=-256; cpu.specialTable[0x03]((0<<21)|(1<<16)|(15<<11)|(4<<6)); chk("SRA sext", r64(15), 0xFFFFFFFFFFFFFFF0n);

// Loads via memory at kseg0 0x80300000
const A=0x80300000;
mmu.write32(A, 0x80000000>>>0);
cpu.gpr[20]=A|0; cpu.gprHi[20]=0;
cpu.opLW((20<<21)|(21<<16)|0); chk("LW sext", r64(21), 0xFFFFFFFF80000000n);
cpu.opLWU((20<<21)|(22<<16)|0); chk("LWU zext", r64(22), 0x80000000n);
mmu.write32(A,0x12345678); cpu.opLW((20<<21)|(23<<16)|0); chk("LW pos", r64(23), 0x12345678n);
// round-trip: ld value, addiu, sd, ld back uses correct high
mmu.write32(A,0xFFFFFFFF); mmu.write32(A+4,0x80000000>>>0); // 64-bit 0xFFFFFFFF80000000
cpu.opLD((20<<21)|(24<<16)|0); chk("LD", r64(24), 0xFFFFFFFF80000000n);
cpu.opSD((20<<21)|(24<<16)|8); // store at A+8
const hi=mmu.read32(A+8)>>>0, lo=mmu.read32(A+12)>>>0;
chk("SD roundtrip", (BigInt(hi)<<32n)|BigInt(lo), 0xFFFFFFFF80000000n);

console.log(fails?("\n"+fails+" FAILURES"):"\nALL PASS");
process.exit(fails?1:0);
