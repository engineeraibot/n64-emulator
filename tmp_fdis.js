const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
// run a few steps so libultra is resident (HLE boot already copies it; run 2M to be safe)
for(let s=0;s<2000000;s++) cpu.step();
const b=new Uint8Array(ram.rdram);
function rd(a){a&=0x7FFFFF;return (b[a]<<24|b[a+1]<<16|b[a+2]<<8|b[a+3])>>>0;}
const R=['zero','at','v0','v1','a0','a1','a2','a3','t0','t1','t2','t3','t4','t5','t6','t7','s0','s1','s2','s3','s4','s5','s6','s7','t8','t9','k0','k1','gp','sp','fp','ra'];
function dis(w){const op=w>>>26,rs=(w>>21)&31,rt=(w>>16)&31,rd2=(w>>11)&31,sa=(w>>6)&31,fn=w&63,imm=(w<<16>>16);
 if(w===0)return 'nop';
 if(op===0){ if(fn===0x08)return 'jr '+R[rs]; if(fn===0x09)return 'jalr '+R[rd2]+','+R[rs];
   if(fn===0)return 'sll '+R[rd2]+','+R[rt]+','+sa; if(fn===2)return 'srl '+R[rd2]+','+R[rt]+','+sa; if(fn===3)return 'sra '+R[rd2]+','+R[rt]+','+sa;
   const m={0x21:'addu',0x23:'subu',0x25:'or',0x24:'and',0x2a:'slt',0x2b:'sltu',0x10:'mfhi',0x12:'mflo',0x2d:'daddu',0x26:'xor',0x0b:'movn',0x0a:'movz',0x18:'mult',0x19:'multu',0x1a:'div',0x1b:'divu'};
   return (m[fn]||('spec.0x'+fn.toString(16)))+' '+R[rd2]+','+R[rs]+','+R[rt];}
 if(op===0x03)return 'jal 0x'+(((0x80000000)|((w&0x3ffffff)<<2))>>>0).toString(16);
 if(op===0x02)return 'j 0x'+(((0x80000000)|((w&0x3ffffff)<<2))>>>0).toString(16);
 if(op===0x01){const m={0:'bltz',1:'bgez',0x11:'bgezal',0x10:'bltzal'};return (m[rt]||'regimm.'+rt.toString(16))+' '+R[rs]+',off'+imm;}
 const m={0x23:'lw',0x24:'lbu',0x20:'lb',0x25:'lhu',0x21:'lh',0x2b:'sw',0x28:'sb',0x29:'sh',0x0d:'ori',0x09:'addiu',0x0c:'andi',0x0a:'slti',0x0b:'sltiu',0x0e:'xori',0x37:'ld',0x3f:'sd'};
 if(op===0x0f)return 'lui '+R[rt]+',0x'+(imm&0xffff).toString(16);
 if((op===0x04||op===0x05||op===0x14||op===0x15)){const n={4:'beq',5:'bne',0x14:'beql',0x15:'bnel'};return n[op]+' '+R[rs]+','+R[rt]+',off'+imm;}
 if(op===0x06||op===0x07)return (op===6?'blez':'bgtz')+' '+R[rs]+',off'+imm;
 if(op===0x11)return 'cop1.'+w.toString(16);
 if(m[op]&&op>=0x20)return m[op]+' '+R[rt]+','+imm+'('+R[rs]+')';
 if(m[op])return m[op]+' '+R[rt]+','+R[rs]+',0x'+(imm&0xffff).toString(16);
 return 'op0x'+op.toString(16)+' raw='+w.toString(16);}
const addrs=(process.env.A||'0x802f6284').split(',');
for(const a of addrs){const START=parseInt(a,16),N=parseInt(process.env.N||'24',10);
 console.log('=== 0x'+START.toString(16)+' N='+N+' ===');
 for(let i=0;i<N;i++){const va=START+i*4;console.log('  0x'+(va>>>0).toString(16)+': '+dis(rd(va)));}}
