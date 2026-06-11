const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = __dirname;
const ROM_PATH = path.join(ROOT, 'Super Mario 64 (Europe) (En,Fr,De).n64');
const files = ['memory.js', 'mmu.js', 'rcp.js', 'cpu.js'];
let combined = '';
for (const f of files) combined += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n';
combined += '\nthis.__classes = { Memory, MMU, RCP, CPU };\n';
const realLog = console.log.bind(console);
const sandbox = {
  console: { log: () => {}, error: () => {}, warn: () => {} },
  setTimeout: () => {}, clearTimeout: () => {},
  performance: { now: () => Date.now() },
  Math, Number, BigInt, JSON, DataView, ArrayBuffer,
  Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
  Float32Array, Float64Array, Array,
};
vm.createContext(sandbox);
vm.runInContext(combined, sandbox, { filename: 'combined-emu.js' });
const { Memory, MMU, RCP, CPU } = sandbox.__classes;
const romBuf = fs.readFileSync(ROM_PATH);
const ab = romBuf.buffer.slice(romBuf.byteOffset, romBuf.byteOffset + romBuf.byteLength);
const framebuffer = new Uint8Array(320*240*4);
const ram = new Memory(8*1024*1024);
const mmu = new MMU(ram);
const rcp = new RCP(mmu, framebuffer);
const cpu = new CPU(mmu, rcp);
mmu.cpu = cpu; mmu.rcp = rcp;
ram.loadRom(ab);
cpu.isRunning = true;
if (!cpu.isHleBootDone) cpu.performHleBoot();

const START = 0x1000;
const PRESS_AT_F3D = parseInt(process.env.PRESS_AT_F3D || '90', 10);
const MAX = parseInt(process.argv[2] || '70000000', 10);
const BUDGET = parseInt(process.env.BUDGET_MS || '40000', 10);

const blockSigs = new Map();
const origCopy = mmu.copyRdramToPif.bind(mmu);
mmu.copyRdramToPif = function(dramAddr) {
  origCopy(dramAddr);
  const hex = Array.from(mmu.pifRam.slice(0, 32)).map(b => b.toString(16).padStart(2,'0')).join('');
  blockSigs.set(hex, (blockSigs.get(hex)||0)+1);
};

const t0 = Date.now();
let pressed = false, pressStep = 0;
for (let s = 0; s < MAX; s++) {
  try { cpu.step(); } catch (e) { realLog('THREW', s, e.message); break; }
  const f3d = rcp.f3dTaskCount | 0;
  if (!pressed && f3d >= PRESS_AT_F3D) {
    mmu.updateController(START, 0, 0);
    pressed = true; pressStep = s;
    realLog('[probe] pressed START at step', s, 'f3d', f3d, 'buttonReads', mmu.controllerDebug.buttonReads);
  }
  if (pressed && s - pressStep > 8000000) { realLog('[probe] released after 8M'); break; }
  if ((s & 0xFFFF) === 0 && Date.now() - t0 > BUDGET) { realLog('[probe] time budget at step', s, 'f3d', f3d); break; }
}
realLog('--- controllerDebug ---');
realLog(JSON.stringify(mmu.controllerDebug, null, 1));
realLog('f3dTaskCount', rcp.f3dTaskCount, 'rspTaskCount', rcp.rspTaskCount);
realLog('--- distinct joybus blocks (first 32 bytes), top by count ---');
const sigs = [...blockSigs.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);
for (const [hex,n] of sigs) realLog(n, hex);
