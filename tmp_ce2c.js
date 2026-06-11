const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
let c='';for(const f of ['memory.js','mmu.js','rcp.js','cpu.js'])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
c+='\nthis.__classes={Memory,MMU,RCP,CPU};\n';
const sb={console,setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
vm.createContext(sb);vm.runInContext(c,sb,{filename:'c.js'});
const{Memory,MMU,RCP,CPU}=sb.__classes;
const romBuf=fs.readFileSync(path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab=romBuf.buffer.slice(romBuf.byteOffset,romBuf.byteOffset+romBuf.byteLength);
const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,new sb.Uint8Array(320*240*4));const cpu=new CPU(mmu,rcp);
mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();
const b=new Uint8Array(ram.rdram);
function rd(a){a&=0x7FFFFF;return (b[a]<<24|b[a+1]<<16|b[a+2]<<8|b[a+3])>>>0;}
const R=['zero','at','v0','v1','a0','a1','a2','a3','t0','t1','t2','t3','t4','t5','t6','t7','s0','s1','s2','s3','s4','s5','s6','s7','t8','t9','k0','k1','gp','sp','fp','ra'];
function dis(w,va){const op=w>>>26,rs=(w>>21)&31,rt=(w>>16)&31,rd2=(w>>11)&31,sa=(w>>6)&31,fn=w&63,imm=(w<<16>>16);
 if(w===0)return 'nop';
 if(op===0){const m={0x08:'jr',0x09:'jalr',0x21:'addu',0x23:'subu',0x25:'or',0x24:'and',0x2a:'slt',0x2b:'sltu',0x27:'nor',0x26:'xor'};
   if(fn===0x08)return 'jr '+R[rs]; if(fn===0x09)return 'jalr '+R[rd2]+','+R[rs];
   if(fn===0x00)return 'sll '+R[rd2]+','+R[rt]+','+sa;
   if(fn===0x02)return 'srl '+R[rd2]+','+R[rt]+','+sa;
   if(fn===0x03)return 'sra '+R[rd2]+','+R[rt]+','+sa;
   return (m[fn]||('spec fn=0x'+fn.toString(16)))+' '+R[rd2]+','+R[rs]+','+R[rt];}
 if(op===0x11)return 'cop1 rs=0x'+rs.toString(16)+' ft='+R[rt]+' fs='+rd2+' fd='+sa+' fn=0x'+fn.toString(16);
 if(op===0x03)return 'jal 0x'+(((0x80000000)|((w&0x3ffffff)<<2))>>>0).toString(16);
 if(op===0x02)return 'j 0x'+(((0x80000000)|((w&0x3ffffff)<<2))>>>0).toString(16);
 const m={0x23:'lw',0x24:'lbu',0x20:'lb',0x25:'lhu',0x21:'lh',0x2b:'sw',0x28:'sb',0x29:'sh',0x0f:'lui',0x0d:'ori',0x09:'addiu',0x0c:'andi',0x0a:'slti',0x0b:'sltiu',0x31:'lwc1',0x35:'ldc1'};
 if(op===0x04)return 'beq '+R[rs]+','+R[rt]+',0x'+((va+4+imm*4)>>>0).toString(16);
 if(op===0x05)return 'bne '+R[rs]+','+R[rt]+',0x'+((va+4+imm*4)>>>0).toString(16);
 if(op===0x14)return 'beql '+R[rs]+','+R[rt]+',0x'+((va+4+imm*4)>>>0).toString(16);
 if(op===0x15)return 'bnel '+R[rs]+','+R[rt]+',0x'+((va+4+imm*4)>>>0).toString(16);
 if(op===0x01)return 'regimm rt=0x'+rt.toString(16)+' '+R[rs]+',0x'+((va+4+imm*4)>>>0).toString(16);
 if(m[op]){if(op===0x0f)return 'lui '+R[rt]+',0x'+(w&0xffff).toString(16);if(op>=0x20)return m[op]+' '+R[rt]+','+imm+'('+R[rs]+')';return m[op]+' '+R[rt]+','+R[rs]+','+imm;}
 return 'op=0x'+op.toString(16);}
const MAX=27000000;
let dumped=false;
for(let s=0;s<MAX;s++){
  const pc=cpu.pc>>>0;
  // capture the specific 0x8017ce2c call that precedes the panic (current obj type 0x10000)
  if(pc===0x8017ce2c && rd(0x801a7784+0)!==undefined){
    const g=rd(0x801a7784);
    if(rd(g+0xC)===0x10000 && !dumped){
      dumped=true;
      console.log('0x8017ce2c CALL pre-panic: a0=0x'+(cpu.gpr[4]>>>0).toString(16),'a1=0x'+(cpu.gpr[5]>>>0).toString(16));
      console.log('a0 type@+0xC=0x'+rd((cpu.gpr[4]>>>0)+0xC).toString(16),'a1 type@+0xC=0x'+rd((cpu.gpr[5]>>>0)+0xC).toString(16));
      console.log('--- disasm 0x8017ce2c ---');
      for(let va=0x8017ce2c;va<0x8017cf00;va+=4)console.log('  0x'+va.toString(16),dis(rd(va),va));
      break;
    }
  }
  cpu.step();
}
