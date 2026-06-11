const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const rd=new DataView(mmu.memory.rdram);

function clamp16(v){return v>32767?32767:(v<-32768?-32768:v);}
function sign4(n){n&=0xf;return n>=8?n-16:n;}

// Helper: load a codebook (npred*16 int16) into DRAM and run LOADADPCM
function loadBook(addr, book){ for(let i=0;i<book.length;i++) rd.setInt16(addr+i*2, book[i], false); }

// ---- Test 1: zero codebook -> output = sign4(nibble)<<scale ----
{
  const bookAddr=0x8000, book=new Array(16).fill(0); // 1 predictor, all zero
  loadBook(bookAddr, book);
  // craft 1 frame at DMEM via DRAM->LOADBUFF: header scale=2 pred=0, then 8 bytes of nibbles
  const scale=2;
  const nibbles=[1,-1,2,-2,3,-3,4,-4,5,-5,6,-6,7,7,-8,0];
  const frame=[ (scale<<4)|0 ];
  for(let i=0;i<8;i++){const hi=nibbles[i*2]&0xf, lo=nibbles[i*2+1]&0xf; frame.push((hi<<4)|lo);} // 9 bytes
  // place frame at DRAM 0x9000
  for(let i=0;i<frame.length;i++) rd.setUint8(0x9000+i, frame[i]);
  let p=0x1000; const cmd=(w0,w1)=>{rd.setUint32(p,w0>>>0,false);rd.setUint32(p+4,w1>>>0,false);p+=8;};
  cmd(0x0b000020, 0x00008000);               // LOADADPCM count=0x20 bytes (16 int16) from 0x8000
  cmd(0x08000000, 0x00000010);               // SETBUFF in=0 out=0 count=0x10? count must >=9 for load
  // Actually load 16 bytes of compressed into DMEM[0]: set count and LOADBUFF
  cmd(0x08000000, 0x00000010);               // in=0 out=0 count=0x10
  cmd(0x04000000, 0x00009000);               // LOADBUFF 0x9000 -> DMEM[0] (count=0x10 bytes)
  cmd(0x08000000, 0x01000020);               // SETBUFF in=0 out=0x100 count=0x20 (32 out bytes=1 frame)
  cmd(0x01010000, 0x0000a000);               // ADPCM init, state 0xa000  (flags=01 init)
  rcp.runAudioTask(0x1000, p-0x1000);
  let ok=true;
  for(let i=0;i<16;i++){const got=rd.getInt16(0x100? 0:0,false);}
  // read decoded from DMEM[0x100]
  let fail=0;
  for(let i=0;i<16;i++){
    const exp=clamp16(sign4(nibbles[i])<<scale);
    const got=rcp.adGetS16(0x100+i*2);
    if(exp!==got){fail++; if(fail<=3) console.log('  idx',i,'exp',exp,'got',got);}
  }
  console.log('TEST1 zero-book residual decode:', fail===0?'PASS':'FAIL ('+fail+')');
}

// ---- Test 2: book1=2048 const, book2=0 -> out = clamp(l1seed + e[i]) within each group ----
{
  const bookAddr=0x8000; const book=new Array(16).fill(0);
  for(let i=0;i<8;i++) book[i]=2048;  // book1[0..7]=2048, book2=0
  loadBook(bookAddr, book);
  const scale=0;
  const nibbles=[1,2,3,4,5,6,7,1, 2,3,4,5,6,7,1,2];
  const frame=[(scale<<4)|0];
  for(let i=0;i<8;i++){const hi=nibbles[i*2]&0xf, lo=nibbles[i*2+1]&0xf; frame.push((hi<<4)|lo);}
  for(let i=0;i<frame.length;i++) rd.setUint8(0x9000+i, frame[i]);
  // seed history: state last frame [14]=l2,[15]=l1; set l1=100 -> group0 seed
  for(let i=0;i<16;i++) rd.setInt16(0xa000+i*2, 0, false);
  rd.setInt16(0xa000+15*2, 100, false); // l1=100
  rd.setInt16(0xa000+14*2, 0, false);   // l2=0
  let p=0x1000; const cmd=(w0,w1)=>{rd.setUint32(p,w0>>>0,false);rd.setUint32(p+4,w1>>>0,false);p+=8;};
  cmd(0x0b000020, 0x00008000);
  cmd(0x08000000, 0x00000010);
  cmd(0x04000000, 0x00009000);
  cmd(0x08000000, 0x01000020);
  cmd(0x01000000, 0x0000a000);   // ADPCM NOT init (use history), flags=0
  rcp.runAudioTask(0x1000, p-0x1000);
  // expected: group0 i=0: l1=100 -> 100+e0; but l1 stays the group seed (book1[i]=2048 for all i, book2=0 so no in-group feedthrough)
  // group0: dst[i]=100+e[i]; group1 seed l1=dst[7]
  let exp=[]; 
  for(let i=0;i<8;i++) exp[i]=clamp16(100+nibbles[i]);
  const g1seed=exp[7];
  for(let i=0;i<8;i++) exp[8+i]=clamp16(g1seed+nibbles[8+i]);
  let fail=0;
  for(let i=0;i<16;i++){const got=rcp.adGetS16(0x100+i*2); if(got!==exp[i]){fail++; if(fail<=4)console.log('  idx',i,'exp',exp[i],'got',got);}}
  console.log('TEST2 book1*l1 path:', fail===0?'PASS':'FAIL ('+fail+')');
}
