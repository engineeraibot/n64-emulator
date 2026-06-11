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

// Read 32-bit from physical RAM (no mmu)
function rd32(vaddr) {
    const phys = (vaddr & 0x1FFFFFFF) & 0x7FFFFF;
    const v = new DataView(ram.rdram);
    if (phys + 4 > ram.rdram.byteLength) return 0xDEAD;
    return v.getUint32(phys, false) >>> 0;
}

const ISAVE = 0x80336ce0;
const SR_OFF = 0x118;
const watchPhys = (ISAVE + SR_OFF) & 0x7FFFFF;

// Patch mmu.write32 to watch writes to SaveArea[0x118] and [0x11C]
const origWrite32 = mmu.write32.bind(mmu);
let writeLog = [];
mmu.write32 = function(a, v) {
    const phys = a & 0x7FFFFF;
    if (phys >= watchPhys && phys < watchPhys + 8) {
        writeLog.push({ step: cpu.instructionCount, pc: (cpu.pc>>>0), phys: phys, v: v>>>0 });
    }
    return origWrite32(a, v);
};

// Run to step 48332100 quickly
const deadline = Date.now() + 25000;
for (let i = 0; i < 48332100; i++) {
    cpu.step();
    if (Date.now() > deadline) { console.log('TIMEOUT'); process.exit(1); }
}
console.log(`At step 48332100: Status=0x${(cpu.cp0Registers[12]>>>0).toString(16)} SaveArea[0x118]=0x${rd32(ISAVE+SR_OFF).toString(16)}`);

// Clear log and run 300 more steps watching for writes
writeLog = [];
for (let i = 48332100; i < 48332400; i++) {
    cpu.step();
}
console.log(`\nWrites to SaveArea[0x118..0x11F] in steps 48332100-48332400:`);
for (const w of writeLog) {
    const off = w.phys - watchPhys;
    console.log(`  step=${w.step} PC=0x${w.pc.toString(16)} phys+${off}=0x${w.v.toString(16).padStart(8,'0')}`);
}
console.log(`SaveArea[0x118]=0x${rd32(ISAVE+SR_OFF).toString(16)} [0x11C]=0x${rd32(ISAVE+SR_OFF+4).toString(16)}`);
console.log(`Status=0x${(cpu.cp0Registers[12]>>>0).toString(16)}`);
