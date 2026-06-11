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
    const v = new DataView(ram.rdram);
    if (phys + 4 > ram.rdram.byteLength) return 0xDEAD;
    return v.getUint32(phys, false) >>> 0;
}

// Run fast to 48332100
const deadline = Date.now() + 25000;
for (let i = 0; i < 48332100; i++) {
    cpu.step();
    if (Date.now() > deadline) { console.log('TIMEOUT'); process.exit(1); }
}
console.log(`At 48332100: Status=0x${(cpu.cp0Registers[12]>>>0).toString(16)}`);

// Now trace Status changes step-by-step
for (let i = 48332100; i < 48332500; i++) {
    const ps = cpu.cp0Registers[12];
    const pp = cpu.pc >>> 0;
    cpu.step();
    const ns = cpu.cp0Registers[12];
    if (ns !== ps) {
        let instrStr = '???';
        try { instrStr = '0x' + ((mmu.read32(pp)|0)>>>0).toString(16); } catch(e) {}
        const ie = ns & 1, exl = (ns >> 1) & 1;
        console.log(`[${i}] Status 0x${(ps>>>0).toString(16).padStart(8,'0')} -> 0x${(ns>>>0).toString(16).padStart(8,'0')} IE=${ie} EXL=${exl} PC=0x${pp.toString(16)} instr=${instrStr}`);
        if ((ns >>> 0) < 0x10) {
            console.log(`  *** STATUS NEAR ZERO — examining...`);
            // Read a few regs
            for (let j = 24; j < 32; j++) {
                console.log(`    $${j}=0x${(cpu.gpr[j]>>>0).toString(16)}`);
            }
            // SaveArea
            const ISAVE = 0x80336ce0;
            console.log(`    SaveArea[0x118]=0x${rd32(ISAVE+0x118).toString(16)} [0x11C]=0x${rd32(ISAVE+0x11C).toString(16)}`);
            // CP0
            console.log(`    Cause=0x${(cpu.cp0Registers[13]>>>0).toString(16)} EPC=0x${(cpu.cp0Registers[14]>>>0).toString(16)}`);
        }
    }
}
console.log(`Final: PC=0x${(cpu.pc>>>0).toString(16)} Status=0x${(cpu.cp0Registers[12]>>>0).toString(16)}`);
