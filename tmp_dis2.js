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
const R=['zero','at','v0','v1','a0','a1','a2','a3','t0','t1','t2','t3','t4','t5','t6','t7','s0','s1','s2','s3','s4','s5','s6','s7','t8','t9','k0','k1','gp','sp','fp','ra'];
function dis(w){const op=w>>>26,rs=(w>>21)&31,rt=(w>>16)&31,rd=(w>>11)&31,sa=(w>>6)&31,fn=w&63,imm=(w<<16>>16);
 if(w===0)return 'nop';
 if(op===0){if(fn===0x08)return 'jr '+R[rs];if(fn===0x09)return 'jalr '+R[rd]+','+R[rs];if(fn===0x21)return 'addu '+R[rd]+','+R[rs]+','+R[rt];if(fn===0x25)return 'or '+R[rd]+','+R[rs]+','+R[rt];if(fn===0x24)return 'and '+R[rd]+','+R[rs]+','+R[rt];if(fn===0x2a)return 'slt '+R[rd]+','+R[rs]+','+R[rt];if(fn===0)return 'sll '+R[rd]+','+R[rt]+','+sa;if(fn===2)return 'srl '+R[rd]+','+R[rt]+','+sa;return 'spec fn=0x'+fn.toString(16)+' '+R[rd]+','+R[rs]+','+R[rt];}
 if(op===0x10){if((w&0x3f)===0x18)return 'eret';const sub=(w>>21)&31;return (sub===0?'mfc0 '+R[rt]+',$'+rd:sub===4?'mtc0 '+R[rt]+',$'+rd:'cop0');}
 if(op===0x23)return 'lw '+R[rt]+','+imm+'('+R[rs]+')';
 if(op===0x20)return 'lb '+R[rt]+','+imm+'('+R[rs]+')';
 if(op===0x24)return 'lbu '+R[rt]+','+imm+'('+R[rs]+')';
 if(op===0x37)return 'ld '+R[rt]+','+imm+'('+R[rs]+')';
 if(op===0x2b)return 'sw '+R[rt]+','+imm+'('+R[rs]+')';
 if(op===0x28)return 'sb '+R[rt]+','+imm+'('+R[rs]+')';
 if(op===0x3f)return 'sd '+R[rt]+','+imm+'('+R[rs]+')';
 if(op===0x0f)return 'lui '+R[rt]+',0x'+(w&0xffff).toString(16);
 if(op===0x0d)return 'ori '+R[rt]+','+R[rs]+',0x'+(w&0xffff).toString(16);
 if(op===0x09)return 'addiu '+R[rt]+','+R[rs]+','+imm;
 if(op===0x0c)return 'andi '+R[rt]+','+R[rs]+',0x'+(w&0xffff).toString(16);
 if(op===0x04)return 'beq '+R[rs]+','+R[rt]+','+imm;
 if(op===0x05)return 'bne '+R[rs]+','+R[rt]+','+imm;
 if(op===0x14)return 'beql '+R[rs]+','+R[rt]+','+imm;
 if(op===0x15)return 'bnel '+R[rs]+','+R[rt]+','+imm;
 if(op===0x03)return 'jal 0x'+(((0x80000000)|((w&0x3ffffff)<<2))>>>0).toString(16);
 if(op===0x02)return 'j 0x'+(((0x80000000)|((w&0x3ffffff)<<2))>>>0).toString(16);
 return 'op=0x'+op.toString(16)+' rt='+R[rt]+' rs='+R[rs]+' imm='+imm;}
for(let va=0x802f3900;va<=0x802f3970;va+=4){const w=ram.read32(va&0x7FFFFF)>>>0;console.log('0x'+va.toString(16),'0x'+w.toString(16).padStart(8,'0'),dis(w));}
console.log('--- save path around 0x802f3f00..0x802f3f30 ---');
for(let va=0x802f3ef0;va<=0x802f3f30;va+=4){const w=ram.read32(va&0x7FFFFF)>>>0;console.log('0x'+va.toString(16),'0x'+w.toString(16).padStart(8,'0'),dis(w));}
