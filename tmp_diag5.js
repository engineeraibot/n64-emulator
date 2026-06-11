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
const mmu = new MMU(ram);
const rcp = new RCP(mmu, framebuffer);
const cpu = new CPU(mmu, rcp);
mmu.cpu = cpu; mmu.rcp = rcp;
ram.loadRom(ab);
cpu.isRunning = true;
cpu.performHleBoot();

// Helper: read a 32-bit value from RAM
function rd32(vaddr) {
    const phys = (vaddr & 0x1FFFFFFF) & 0x7FFFFF;
    const buf = new Uint8Array(ram.rdram);
    return ((buf[phys]<<24)|(buf[phys+1]<<16)|(buf[phys+2]<<8)|buf[phys+3]) >>> 0;
}

// Run to step 48332100 quickly
const deadline1 = Date.now() + 25000;
for (let i = 0; i < 48332100; i++) {
    cpu.step();
    if (Date.now() > deadline1) { console.log('Timeout at step', i); process.exit(1); }
}

console.log('Reached step 48332100');
console.log(`  Status=0x${(cpu.cp0Registers[12]>>>0).toString(16)} PC=0x${(cpu.pc>>>0).toString(16)}`);

// Read the interrupt save area (0x80336ce0) + 0x118 = 0x80336df8
const ISAVE = 0x80336ce0;
const SR_OFF = 0x118;
console.log(`  SaveArea[0x118]=0x${rd32(ISAVE+SR_OFF).toString(16)} [0x11C]=0x${rd32(ISAVE+SR_OFF+4).toString(16)}`);

// Now trace step-by-step watching Status
let prevStatus2 = cpu.cp0Registers[12];
for (let i = 48332100; i < 48332350; i++) {
    const ps = cpu.cp0Registers[12];
    const pp = cpu.pc;
    cpu.step();
    const ns = cpu.cp0Registers[12];
    const instr = (mmu.read32(pp) | 0) >>> 0;
    if (ns !== ps) {
        const op = instr >>> 26;
        const rs = (instr >> 21) & 0x1F;
        const rt = (instr >> 16) & 0x1F;
        const rd = (instr >> 11) & 0x1F;
        console.log(`[${i}] Status 0x${(ps>>>0).toString(16).padStart(8,'0')} -> 0x${(ns>>>0).toString(16).padStart(8,'0')} at PC=0x${(pp>>>0).toString(16)} instr=0x${instr.toString(16)}`);
        // Log nearby save area
        console.log(`  SaveArea[0x118]=0x${rd32(ISAVE+SR_OFF).toString(16).padStart(8,'0')} [0x11C]=0x${rd32(ISAVE+SR_OFF+4).toString(16).padStart(8,'0')}`);
        // Log all GPRs for context
        for (let j = 0; j < 32; j += 4) {
            console.log(`  $${j}=0x${(cpu.gpr[j]>>>0).toString(16)} $${j+1}=0x${(cpu.gpr[j+1]>>>0).toString(16)} $${j+2}=0x${(cpu.gpr[j+2]>>>0).toString(16)} $${j+3}=0x${(cpu.gpr[j+3]>>>0).toString(16)}`);
        }
    }
}
console.log(`Final: PC=0x${(cpu.pc>>>0).toString(16)} Status=0x${(cpu.cp0Registers[12]>>>0).toString(16)}`);
