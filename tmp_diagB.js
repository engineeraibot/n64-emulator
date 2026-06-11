const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = __dirname;
const files = ['memory.js', 'mmu.js', 'rcp.js', 'cpu.js'];
let combined = '';
for (const f of files) combined += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n';
combined += '\nthis.__classes = { Memory, MMU, RCP, CPU };\n';
const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => {}, clearTimeout: () => {},
    performance: { now: () => Date.now() },
    Math, Number, BigInt, JSON, DataView, ArrayBuffer,
    Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
    Float32Array, Float64Array, Array,
};
vm.createContext(sandbox);
vm.runInContext(combined, sandbox, { filename: 'combined-emu.js' });
const { Memory, MMU, RCP, CPU } = sandbox.__classes;
const romBuf = fs.readFileSync(path.join(ROOT, 'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab = romBuf.buffer.slice(romBuf.byteOffset, romBuf.byteOffset + romBuf.byteLength);
const framebuffer = new sandbox.Uint8Array(320 * 240 * 4);
const ram = new Memory(8 * 1024 * 1024);

// Patch Memory.write32 and write64 to track writes to physical 0x303008
const WATCH_PHYS = 0x303008;
const origW32 = ram.write32.bind(ram);
const origW64 = ram.write64.bind(ram);
let stepCount = 0;
let cpuRef = null;
ram.write32 = function(address, value) {
    const phys = address & 0x7FFFFF;
    if (phys >= WATCH_PHYS && phys < WATCH_PHYS + 8) {
        const off = phys - WATCH_PHYS;
        const pc = cpuRef ? (cpuRef.pc>>>0).toString(16) : '?';
        console.log(`  [step ${stepCount}] Memory.write32 phys+${off}=0x${(value>>>0).toString(16).padStart(8,'0')} PC=0x${pc}`);
    }
    return origW32(address, value);
};
ram.write64 = function(address, value) {
    const phys = address & 0x7FFFFF;
    if (phys >= WATCH_PHYS && phys < WATCH_PHYS + 8) {
        const pc = cpuRef ? (cpuRef.pc>>>0).toString(16) : '?';
        console.log(`  [step ${stepCount}] Memory.write64 phys=0x${phys.toString(16)} val=0x${value.toString(16)} PC=0x${pc}`);
    }
    return origW64(address, value);
};

const mmu = new MMU(ram);
const rcp = new RCP(mmu, framebuffer);
const cpu = new CPU(mmu, rcp);
cpuRef = cpu;
mmu.cpu = cpu; mmu.rcp = rcp;
console.log('--- ROM load:');
ram.loadRom(ab);
console.log('--- HLE boot:');
cpu.isRunning = true;
cpu.performHleBoot();
console.log('--- Running:');

function rd32(vaddr) {
    const phys = (vaddr & 0x1FFFFFFF) & 0x7FFFFF;
    if (phys + 4 > ram.rdram.byteLength) return 0xDEAD;
    return new DataView(ram.rdram).getUint32(phys, false) >>> 0;
}

const deadline = Date.now() + 15000;
const MAX_STEPS = 5000000;
for (stepCount = 0; stepCount < MAX_STEPS; stepCount++) {
    cpu.step();
    if (Date.now() > deadline) { console.log('TIMEOUT at step', stepCount); break; }
    if (stepCount % 1000000 === 0) {
        console.log(`step ${stepCount}: TCB[0x118]=0x${rd32(0x80303008).toString(16)}`);
    }
}
console.log(`Done. TCB[0x118]=0x${rd32(0x80303008).toString(16)} Status=0x${(cpu.cp0Registers[12]>>>0).toString(16)}`);
