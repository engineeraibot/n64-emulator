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
    try {
        const phys = (vaddr & 0x1FFFFFFF) & 0x7FFFFF;
        if (phys + 4 > ram.rdram.byteLength) return 0xDEAD;
        return new DataView(ram.rdram).getUint32(phys, false) >>> 0;
    } catch(e) { return 0xDEAD; }
}

// Run to just before the crash (step 48332100)
const deadline = Date.now() + 25000;
for (let i = 0; i < 48332100; i++) {
    cpu.step();
    if (Date.now() > deadline) { console.log('TIMEOUT'); process.exit(1); }
}

// Now trace step-by-step watching for PC = 0x802f4088 (LW $k1, 280($k0))
// and PC = 0x802f40b0 (MTC0 $k1, Status)
let hitLW = false;
for (let i = 48332100; i < 48332350; i++) {
    const pp = cpu.pc >>> 0;
    const k0 = cpu.gpr[26] >>> 0;
    const k1before = cpu.gpr[27] >>> 0;
    const statusBefore = cpu.cp0Registers[12] >>> 0;
    
    cpu.step();
    
    const k1after = cpu.gpr[27] >>> 0;
    
    if (pp === 0x802f4088) {
        const addr = k0 + 0x118;
        const memval = rd32(addr);
        console.log(`[step ${i}] LW $k1,280($k0): $k0=0x${k0.toString(16)} addr=0x${(addr>>>0).toString(16)} mem[addr]=0x${memval.toString(16)} -> $k1=0x${k1after.toString(16)}`);
        hitLW = true;
    }
    if (pp === 0x802f40b0) {
        console.log(`[step ${i}] MTC0 $k1,Status: $k1=0x${k1before.toString(16)} Status=0x${statusBefore.toString(16)} -> 0x${(cpu.cp0Registers[12]>>>0).toString(16)}`);
        console.log(`  $k0=0x${k0.toString(16)} mem[$k0+0x118]=0x${rd32(k0+0x118).toString(16)}`);
    }
}
