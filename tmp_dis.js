const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_f3d96', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const b=new Uint8Array(ram.rdram);
function rd(a){a&=0x7FFFFF;return (b[a]<<24|b[a+1]<<16|b[a+2]<<8|b[a+3])>>>0;}
const R=['zero','at','v0','v1','a0','a1','a2','a3','t0','t1','t2','t3','t4','t5','t6','t7','s0','s1','s2','s3','s4','s5','s6','s7','t8','t9','k0','k1','gp','sp','fp','ra'];
function dis(w){const op=w>>>26,rs=(w>>21)&31,rt=(w>>16)&31,rd2=(w>>11)&31,sa=(w>>6)&31,fn=w&63,imm=(w<<16>>16);
 if(w===0)return 'nop';
 if(op===0){
   if(fn===0x08)return 'jr '+R[rs]; if(fn===0x09)return 'jalr '+R[rd2]+','+R[rs];
   if(fn===0x00)return 'sll '+R[rd2]+','+R[rt]+','+sa;
   if(fn===0x02)return 'srl '+R[rd2]+','+R[rt]+','+sa;
   if(fn===0x03)return 'sra '+R[rd2]+','+R[rt]+','+sa;
   const m={0x21:'addu',0x23:'subu',0x25:'or',0x24:'and',0x2a:'slt',0x2b:'sltu',0x10:'mfhi',0x12:'mflo',0x06:'srlv',0x04:'sllv',0x07:'srav',0x2d:'daddu',0x26:'xor',0x27:'nor',0x0b:'movn',0x0a:'movz'};
   return (m[fn]||('spec fn=0x'+fn.toString(16)))+' '+R[rd2]+','+R[rs]+','+R[rt]+(fn===0?(' ('+sa+')'):'');}
 if(op===0x03)return 'jal 0x'+(((0x80000000)|((w&0x3ffffff)<<2))>>>0).toString(16);
 if(op===0x02)return 'j 0x'+(((0x80000000)|((w&0x3ffffff)<<2))>>>0).toString(16);
 if(op===0x01){const sub=rt;const m={0:'bltz',1:'bgez',0x11:'bgezal'};return (m[sub]||'regimm sub=0x'+sub.toString(16))+' '+R[rs]+',off0x'+(imm&0xffff).toString(16);}
 if(op===0x11)return 'cop1 '+w.toString(16);
 const m={0x23:'lw',0x24:'lbu',0x20:'lb',0x25:'lhu',0x21:'lh',0x2b:'sw',0x28:'sb',0x29:'sh',0x0f:'lui',0x0d:'ori',0x09:'addiu',0x0c:'andi',0x0a:'slti',0x0b:'sltiu',0x04:'beq',0x05:'bne',0x06:'blez',0x07:'bgtz',0x0e:'xori',0x14:'beql',0x15:'bnel',0x31:'lwc1',0x39:'swc1',0x37:'ld',0x3f:'sd'};
 if(op===0x0f)return 'lui '+R[rt]+',0x'+(imm&0xffff).toString(16);
 if(op>=0x20&&op<=0x3f&&m[op]&&op!==0x04&&op!==0x05&&op!==0x14&&op!==0x15)return (m[op])+' '+R[rt]+','+imm+'('+R[rs]+')';
 if(op===0x04||op===0x05||op===0x14||op===0x15)return (m[op])+' '+R[rs]+','+R[rt]+',off0x'+(imm&0xffff).toString(16);
 if(op===0x09||op===0x0c||op===0x0d||op===0x0a||op===0x0b||op===0x0e)return (m[op]||('op'+op))+' '+R[rt]+','+R[rs]+',0x'+(imm&0xffff).toString(16);
 return 'op=0x'+op.toString(16)+' raw='+w.toString(16);
}
const addrs=(process.env.A||'0x8017b73c').split(',');
for(const a of addrs){const START=parseInt(a,16),N=parseInt(process.env.N||'20',10);
 realLog('=== 0x'+START.toString(16)+' (N='+N+') ===');
 for(let i=0;i<N;i++){const va=START+i*4;realLog('  0x'+(va>>>0).toString(16)+': '+dis(rd(va)));}}
