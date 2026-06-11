const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
let c='';for(const f of ['memory.js','mmu.js','rcp.js','cpu.js'])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
c+='\nthis.__classes={Memory,MMU,RCP,CPU};\n';
const realLog=console.log;
const sb={console:{log:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
vm.createContext(sb);vm.runInContext(c,sb,{filename:'c.js'});
const{Memory,MMU,RCP,CPU}=sb.__classes;
const romBuf=fs.readFileSync(path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab=romBuf.buffer.slice(romBuf.byteOffset,romBuf.byteOffset+romBuf.byteLength);
const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,new sb.Uint8Array(320*240*4));const cpu=new CPU(mmu,rcp);
mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();
const b=new Uint8Array(ram.rdram);
function rd(a){a&=0x7FFFFF;return (b[a]<<24|b[a+1]<<16|b[a+2]<<8|b[a+3])>>>0;}
function rstrRaw(a){let s='';a&=0x7FFFFF;for(let i=0;i<24;i++){const ch=b[a+i];if(!ch)break;if(ch<32||ch>126)s+='\\x'+ch.toString(16);else s+=String.fromCharCode(ch);}return s;}
for(let s=0;s<26000000;s++)cpu.step();
realLog('fmt@0x801b53dc:',JSON.stringify(rstrRaw(0x801b53dc)));
realLog('suffix@0x801c9450:',JSON.stringify(rstrRaw(0x801c9450)));
const R=['zero','at','v0','v1','a0','a1','a2','a3','t0','t1','t2','t3','t4','t5','t6','t7','s0','s1','s2','s3','s4','s5','s6','s7','t8','t9','k0','k1','gp','sp','fp','ra'];
function dis(w){const op=w>>>26,rs=(w>>21)&31,rt=(w>>16)&31,rd2=(w>>11)&31,sa=(w>>6)&31,fn=w&63,imm=(w<<16>>16);
 if(w===0)return 'nop';
 if(op===0){if(fn===0x08)return 'jr '+R[rs];if(fn===0x09)return 'jalr '+R[rd2]+','+R[rs];if(fn===0x00)return 'sll '+R[rd2]+','+R[rt]+','+sa;if(fn===0x02)return 'srl '+R[rd2]+','+R[rt]+','+sa;if(fn===0x03)return 'sra '+R[rd2]+','+R[rt]+','+sa;
   const m={0x21:'addu',0x23:'subu',0x25:'or',0x24:'and',0x2a:'slt',0x2b:'sltu',0x10:'mfhi',0x12:'mflo',0x06:'srlv',0x04:'sllv',0x07:'srav',0x2d:'daddu',0x26:'xor',0x27:'nor',0x18:'mult',0x19:'multu',0x1a:'div',0x1b:'divu'};
   return (m[fn]||('spec fn=0x'+fn.toString(16)))+' '+R[rd2]+','+R[rs]+','+R[rt];}
 if(op===0x03)return 'jal 0x'+(((0x80000000)|((w&0x3ffffff)<<2))>>>0).toString(16);
 if(op===0x02)return 'j 0x'+(((0x80000000)|((w&0x3ffffff)<<2))>>>0).toString(16);
 if(op===0x01){const sub=rt;const m={0:'bltz',1:'bgez',0x11:'bgezal'};return (m[sub]||'regimm')+' '+R[rs]+',0x'+imm.toString(16);}
 const m={0x23:'lw',0x24:'lbu',0x20:'lb',0x25:'lhu',0x21:'lh',0x2b:'sw',0x28:'sb',0x29:'sh',0x0f:'lui',0x0d:'ori',0x09:'addiu',0x0c:'andi',0x0a:'slti',0x0b:'sltiu',0x04:'beq',0x05:'bne',0x06:'blez',0x07:'bgtz',0x0e:'xori',0x14:'beql',0x15:'bnel'};
 if(op===0x0f)return 'lui '+R[rt]+',0x'+(imm&0xffff).toString(16);
 if(op>=0x20&&op<=0x2b)return (m[op]||('op'+op))+' '+R[rt]+','+imm+'('+R[rs]+')';
 if(op===0x04||op===0x05||op===0x14||op===0x15)return (m[op])+' '+R[rs]+','+R[rt]+',0x'+imm.toString(16);
 if(op===0x09||op===0x0c||op===0x0d||op===0x0a||op===0x0b||op===0x0e)return (m[op]||('op'+op))+' '+R[rt]+','+R[rs]+',0x'+(imm&0xffff).toString(16);
 return 'op=0x'+op.toString(16);}
function dump(start,n){for(let i=0;i<n;i++){const va=start+i*4;realLog('0x'+(va>>>0).toString(16)+': '+dis(rd(va)));}}
realLog('=== 0x802efd04 (sprintf?) ===');dump(0x802efd04,40);
