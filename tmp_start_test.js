const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = __dirname;
const ROM_PATH = path.join(ROOT, 'Super Mario 64 (Europe) (En,Fr,De).n64');
const files = ['memory.js', 'mmu.js', 'rcp.js', 'cpu.js'];
let combined = '';
for (const f of files) combined += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n';
combined += '\nthis.__classes = { Memory, MMU, RCP, CPU };\n';
const sandbox = { console, setTimeout: ()=>{}, clearTimeout: ()=>{}, performance:{now:()=>Date.now()},
  Math, Number, BigInt, JSON, DataView, ArrayBuffer, Uint8Array, Uint16Array, Uint32Array,
  Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, Array };
vm.createContext(sandbox);
vm.runInContext(combined, sandbox, { filename: 'combined-emu.js' });
const { Memory, MMU, RCP, CPU } = sandbox.__classes;
const romBuf = fs.readFileSync(ROM_PATH);
const ab = romBuf.buffer.slice(romBuf.byteOffset, romBuf.byteOffset + romBuf.byteLength);
const FB_W=320, FB_H=240;
const framebuffer = new sandbox.Uint8Array(FB_W*FB_H*4);
const ram = new Memory(8*1024*1024);
const mmu = new MMU(ram);
const rcp = new RCP(mmu, framebuffer);
const cpu = new CPU(mmu, rcp);
mmu.cpu = cpu; mmu.rcp = rcp; ram.loadRom(ab);
cpu.isRunning = true;
if (!cpu.isHleBootDone) cpu.performHleBoot();

const PRESS_AT = parseInt(process.env.PRESS_AT||'40000000',10);
const TOTAL = parseInt(process.env.TOTAL||'90000000',10);
const START = 0x1000; // N64 START button
let pressedFrames = 0;
let lastF3d = 0;
let f3dAtPress = -1;
for (let s=0; s<TOTAL; s++){
  cpu.step();
  // Inject START in a window after PRESS_AT: toggle press/release every ~1M steps
  if (s >= PRESS_AT) {
    if (f3dAtPress < 0) f3dAtPress = rcp.f3dTaskCount|0;
    const phase = Math.floor((s - PRESS_AT)/2000000) % 2;
    mmu.updateController(phase===0 ? START : 0, 0, 0);
  }
  if ((s & 0xFFFFF)===0){
    const f3d = rcp.f3dTaskCount|0;
    if (f3d !== lastF3d){ lastF3d = f3d; }
  }
}
console.log('f3dAtPress=',f3dAtPress,'f3dFinal=',rcp.f3dTaskCount|0,'tri=',(rcp.drawStats&&rcp.drawStats.triangles)|0);
console.log('buttonReads=',mmu.controllerDebug.buttonReads,'lastButtons=0x'+(mmu.controllerDebug.lastButtons||0).toString(16),'ch0Cmds=',mmu.controllerDebug.channel0Cmds);
console.log('taskHist=',JSON.stringify(rcp.taskTypeHistogram||{}));
