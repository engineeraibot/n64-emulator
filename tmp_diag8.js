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

function rd32(vaddr) {
    const phys = (vaddr & 0x1FFFFFFF) & 0x7FFFFF;
    if (phys + 4 > ram.rdram.byteLength) return 0xDEAD;
    return new DataView(ram.rdram).getUint32(phys, false) >>> 0;
}

const deadline = Date.now() + 25000;
for (let i = 0; i < 48332100; i++) {
    cpu.step();
    if (Date.now() > deadline) { console.log('TIMEOUT'); process.exit(1); }
}

// Now we're at step 48332100 with Status=0xff01
// Track writes to the TCB field at 0x80302ef0 + 0x118 = 0x80303008
const TCB_STATUS = 0x80302ef0 + 0x118; // 0x80303008
console.log(`TCB+0x118 = 0x${TCB_STATUS.toString(16)}`);
console.log(`Initial TCB[0x118] = 0x${rd32(TCB_STATUS).toString(16)}`);

const watchPhys = TCB_STATUS & 0x7FFFFF;
const origWrite32 = mmu.write32.bind(mmu);
let writeLog = [];
mmu.write32 = function(a, v) {
    const phys = a & 0x7FFFFF;
    if (phys >= watchPhys && phys < watchPhys + 8) {
        writeLog.push({ step: cpu.instructionCount, pc: cpu.pc>>>0, phys, v: v>>>0 });
    }
    return origWrite32(a, v);
};

for (let i = 48332100; i < 48332300; i++) {
    const ps = cpu.cp0Registers[12];
    const pp = cpu.pc >>> 0;
    cpu.step();
    const ns = cpu.cp0Registers[12];
    if (ns !== ps) {
        let instrStr = '???';
        try { instrStr = '0x' + (mmu.read32(pp)>>>0).toString(16); } catch(e) {}
        console.log(`[${i}] Status 0x${(ps>>>0).toString(16).padStart(8,'0')} -> 0x${(ns>>>0).toString(16).padStart(8,'0')} PC=0x${pp.toString(16)} instr=${instrStr}`);
    }
}

console.log(`\nWrites to TCB[0x118..0x11F] (0x${TCB_STATUS.toString(16)}):`);
for (const w of writeLog) {
    const off = w.phys - watchPhys;
    console.log(`  step=${w.step} PC=0x${w.pc.toString(16)} +${off}=0x${w.v.toString(16).padStart(8,'0')}`);
}
console.log(`Final TCB[0x118]=0x${rd32(TCB_STATUS).toString(16)} [0x11C]=0x${rd32(TCB_STATUS+4).toString(16)}`);
console.log(`$k0=0x${(cpu.gpr[26]>>>0).toString(16)} $k1=0x${(cpu.gpr[27]>>>0).toString(16)}`);
