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

const MAX = parseInt(process.argv[2] || '70000000', 10);
const BUDGET = parseInt(process.env.BUDGET_MS || '40000', 10);

// Log first N WR64B blocks chronologically, with step
let blockCount = 0;
const seen = new Set();
const origCopy = mmu.copyRdramToPif.bind(mmu);
let curStep = 0;
mmu.copyRdramToPif = function(dramAddr) {
  origCopy(dramAddr);
  const hex = Array.from(mmu.pifRam.slice(0, 24)).map(b => b.toString(16).padStart(2,'0')).join('');
  if (!seen.has(hex)) {
    seen.add(hex);
    realLog('block#'+(blockCount++), 'step', curStep, 'f3d', rcp.f3dTaskCount|0, hex);
  }
};

const t0 = Date.now();
for (let s = 0; s < MAX; s++) {
  curStep = s;
  try { cpu.step(); } catch (e) { realLog('THREW', s, e.message); break; }
  if ((s & 0xFFFF) === 0 && Date.now() - t0 > BUDGET) { realLog('[budget] step', s, 'f3d', rcp.f3dTaskCount|0); break; }
}
realLog('channel0Cmds', mmu.controllerDebug.channel0Cmds, 'pifCmdCalls', mmu.controllerDebug.pifCmdCalls);
