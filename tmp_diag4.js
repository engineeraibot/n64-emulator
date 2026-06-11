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

// Run up to just before step 96703
for (let i = 0; i < 96700; i++) cpu.step();

// Now step-by-step with full logging
console.log(`Pre-transition: Status=0x${(cpu.cp0Registers[12]>>>0).toString(16)}`);
for (let i = 96700; i < 96720; i++) {
    const prevStatus = cpu.cp0Registers[12];
    const prevPC = cpu.pc;
    const prevGPR = Array.from({length:32}, (_,j) => cpu.gpr[j]);
    cpu.step();
    const newStatus = cpu.cp0Registers[12];
    const instr = (mmu.read32(prevPC)|0) >>> 0;
    if (newStatus !== prevStatus) {
        console.log(`[step ${i}] PC=0x${(prevPC>>>0).toString(16)} instr=0x${instr.toString(16).padStart(8,'0')} Status: 0x${(prevStatus>>>0).toString(16)} -> 0x${(newStatus>>>0).toString(16)}`);
        // Decode instr
        const op = instr >>> 26;
        const rs = (instr >> 21) & 0x1F;
        const rt = (instr >> 16) & 0x1F;
        const rd = (instr >> 11) & 0x1F;
        const func = instr & 0x3F;
        console.log(`  op=${op.toString(16)} rs=$${rs}=0x${(prevGPR[rs]>>>0).toString(16)} rt=$${rt}=0x${(prevGPR[rt]>>>0).toString(16)} rd=$${rd} func=${func.toString(16)}`);
        // COP0: op=0x10
        if (op === 0x10) {
            const sub = rs; // sub-opcode is in rs field for COP0
            console.log(`  COP0 sub=0x${sub.toString(16)} rt=$${rt}=0x${(prevGPR[rt]>>>0).toString(16)} rd=CP0[${rd}]`);
        }
    }
}
