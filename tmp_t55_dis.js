process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE||'state_oot_c2',ram,mmu,cpu,rcp);
const R=['zero','at','v0','v1','a0','a1','a2','a3','t0','t1','t2','t3','t4','t5','t6','t7','s0','s1','s2','s3','s4','s5','s6','s7','t8','t9','k0','k1','gp','sp','fp','ra'];
function dis(w){const op=w>>>26,rs=(w>>21)&31,rt=(w>>16)&31,rd2=(w>>11)&31,sa=(w>>6)&31,fn=w&63,imm=(w<<16>>16);
 if(w===0)return 'nop';
 if(op===0){const m={0x21:'addu',0x23:'subu',0x25:'or',0x24:'and',0x2a:'slt',0x2b:'sltu',0x10:'mfhi',0x12:'mflo',0x00:'sll',0x02:'srl',0x03:'sra',0x08:'jr',0x09:'jalr',0x06:'srlv',0x04:'sllv',0x07:'srav',0x2d:'daddu',0x26:'xor',0x27:'nor',0x18:'mult',0x19:'multu',0x1a:'div',0x1b:'divu'};return (m[fn]||('spec fn=0x'+fn.toString(16)))+' '+R[rd2]+','+R[rs]+','+R[rt]+(fn===0||fn===2||fn===3?' sa='+sa:'');}
 if(op===0x03)return 'jal 0x'+(((0x80000000)|((w&0x3ffffff)<<2))>>>0).toString(16);
 if(op===0x02)return 'j 0x'+(((0x80000000)|((w&0x3ffffff)<<2))>>>0).toString(16);
 if(op===0x01){const m={0:'bltz',1:'bgez',0x11:'bgezal'};return (m[rt]||'regimm')+' '+R[rs]+',0x'+imm.toString(16);}
 const m={0x23:'lw',0x24:'lbu',0x20:'lb',0x25:'lhu',0x21:'lh',0x2b:'sw',0x28:'sb',0x29:'sh',0x0f:'lui',0x0d:'ori',0x09:'addiu',0x0c:'andi',0x0a:'slti',0x0b:'sltiu',0x04:'beq',0x05:'bne',0x06:'blez',0x07:'bgtz',0x0e:'xori',0x14:'beql',0x15:'bnel',0x31:'lwc1',0x39:'swc1',0x35:'ldc1',0x3d:'sdc1'};
 if(op===0x0f)return 'lui '+R[rt]+',0x'+(imm&0xffff).toString(16);
 if(op>=0x20&&op<=0x2b)return (m[op]||('op'+op))+' '+R[rt]+','+imm+'('+R[rs]+')';
 if(op===0x04||op===0x05||op===0x14||op===0x15)return (m[op])+' '+R[rs]+','+R[rt]+',0x'+imm.toString(16);
 return (m[op]||('op0x'+op.toString(16)))+' '+R[rt]+','+R[rs]+','+imm;}
const rd=new Uint8Array(mmu.memory.rdram);
function rdw(a){a&=0x7FFFFF;return((rd[a]<<24)|(rd[a+1]<<16)|(rd[a+2]<<8)|rd[a+3])>>>0;}
for(const base of [0x80034620,0x800d6168,0x800b7118]){
  console.log('--- around 0x'+base.toString(16)+' ---');
  for(let a=base;a<base+0x30;a+=4)console.log('  0x'+a.toString(16),dis(rdw(a)));
}
