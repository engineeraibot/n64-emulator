const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const N=parseInt(process.env.N||'6000000',10);
const hist=new Array(64).fill(0); const sp=new Array(64).fill(0);
const origDecode=cpu.decodeAndExecute.bind(cpu);
let cnt=0;
cpu.decodeAndExecute=function(instr,pc,ds){
  if(!ds){const op=(instr>>>26)&0x3f; hist[op]++; if(op===0)sp[instr&0x3f]++; cnt++;}
  return origDecode(instr,pc,ds);
};
for(let i=0;i<N;i++){try{cpu.step();}catch(e){break;}}
const names={0:'SPECIAL',1:'REGIMM',2:'J',3:'JAL',4:'BEQ',5:'BNE',6:'BLEZ',7:'BGTZ',8:'ADDI',9:'ADDIU',10:'SLTI',11:'SLTIU',12:'ANDI',13:'ORI',14:'XORI',15:'LUI',16:'COP0',17:'COP1',20:'BEQL',21:'BNEL',23:'BGTZL',31:'SPECIAL2',32:'LB',35:'LW',36:'LBU',37:'LHU',39:'LWU',40:'SB',41:'SH',43:'SW',47:'CACHE',55:'LD',63:'SD'};
const spn={0:'SLL',2:'SRL',3:'SRA',4:'SLLV',6:'SRLV',7:'SRAV',8:'JR',9:'JALR',12:'SYSCALL',16:'MFHI',18:'MFLO',24:'MULT',25:'MULTU',26:'DIV',27:'DIVU',32:'ADD',33:'ADDU',34:'SUB',35:'SUBU',36:'AND',37:'OR',38:'XOR',39:'NOR',42:'SLT',43:'SLTU',45:'DADDU'};
const top=hist.map((c,i)=>[c,i]).filter(x=>x[0]>0).sort((a,b)=>b[0]-a[0]);
console.log('total decoded',cnt);
for(const [c,i] of top.slice(0,16)) console.log((100*c/cnt).toFixed(1)+'%', names[i]||('op'+i), c);
console.log('--- SPECIAL fns ---');
const tsp=sp.map((c,i)=>[c,i]).filter(x=>x[0]>0).sort((a,b)=>b[0]-a[0]);
for(const [c,i] of tsp.slice(0,12)) console.log((100*c/cnt).toFixed(1)+'%', spn[i]||('fn'+i), c);
