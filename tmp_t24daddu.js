const {buildMachine}=require('./tmp_boot');
const {cpu}=buildMachine();
function enc(fn,rs,rt,rd){return (rs<<21)|(rt<<16)|(rd<<11)|fn;}
// helper to set 64-bit reg
function set(r,hi,lo){cpu.gprHi[r]=hi|0;cpu.gpr[r]=lo|0;}
function get(r){return ((BigInt(cpu.gprHi[r]>>>0)<<32n)|BigInt(cpu.gpr[r]>>>0));}
// DADDU $1=$2+$3 : 0x1_00000000 + 0x2_00000000
set(2,1,0);set(3,2,0);cpu.specialTable[0x2D](enc(0x2D,2,3,1));
console.log('DADDU hi-add:', get(1).toString(16), get(1)===0x300000000n?'OK':'FAIL');
// carry: 0xFFFFFFFF + 1 = 0x1_00000000
set(2,0,0xFFFFFFFF|0);set(3,0,1);cpu.specialTable[0x2D](enc(0x2D,2,3,1));
console.log('DADDU carry:', get(1).toString(16), get(1)===0x100000000n?'OK':'FAIL');
// DSUBU 0x2_00000000 - 0x1_00000001 = 0x0_FFFFFFFF
set(2,2,0);set(3,1,1);cpu.specialTable[0x2F](enc(0x2F,2,3,1));
console.log('DSUBU borrow:', get(1).toString(16), get(1)===0xFFFFFFFFn?'OK':'FAIL');
// DADDIU $1=$2 + (-1) where $2=0x1_00000000 -> 0x0_FFFFFFFF
set(2,1,0);const imm=0xFFFF; cpu.opDADDIU((0x19<<26)|(2<<21)|(1<<16)|imm);
console.log('DADDIU neg imm:', get(1).toString(16), get(1)===0xFFFFFFFFn?'OK':'FAIL');
// low-32 stability: DADDU of plain 32-bit sign-extended values matches old |0 result
set(2,0,5);set(3,0,7);cpu.specialTable[0x2D](enc(0x2D,2,3,1));
console.log('DADDU low32:', cpu.gpr[1], cpu.gpr[1]===12?'OK':'FAIL');
