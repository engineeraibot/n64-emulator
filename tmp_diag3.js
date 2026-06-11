// Proper diagnostic matching harness setup exactly
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = __dirname;
const files = ['memory.js', 'mmu.js', 'rcp.js', 'cpu.js'];
let combined = '';
for (const f of files) combined += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n';
combined += '\nthis.__classes = { Memory, MMU, RCP, CPU };\n';
const sandbox = {
    console: { log() {}, warn() {}, error() {} },  // suppress noise
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
const FB_W = 320, FB_H = 240;
const framebuffer = new sandbox.Uint8Array(FB_W * FB_H * 4);
const ram = new Memory(8 * 1024 * 1024);
const mmu = new MMU(ram);
const rcp = new RCP(mmu, framebuffer);
const cpu = new CPU(mmu, rcp);
mmu.cpu = cpu; mmu.rcp = rcp;
ram.loadRom(ab);
cpu.isRunning = true;
if (!cpu.isHleBootDone) cpu.performHleBoot();
console.log(`Boot OK: PC=0x${(cpu.pc>>>0).toString(16)} Status=0x${(cpu.cp0Registers[12]>>>0).toString(16)}`);

let statusChanges = 0;
const MAX_STATUS_LOGS = 40;
const STEPS = 200000000;
const deadline = Date.now() + 22000;

let badPcFound = false;
for (let i = 0; i < STEPS; i++) {
    const prevStatus = cpu.cp0Registers[12];
    const prevPC = cpu.pc;

    cpu.step();

    const newStatus = cpu.cp0Registers[12];

    // Track Status changes
    if (newStatus !== prevStatus && statusChanges < MAX_STATUS_LOGS) {
        statusChanges++;
        const ie = newStatus & 1;
        const exl = (newStatus >> 1) & 1;
        console.log(`[step ${i}] Status 0x${(prevStatus>>>0).toString(16).padStart(8,'0')} -> 0x${(newStatus>>>0).toString(16).padStart(8,'0')} IE=${ie} EXL=${exl} at prevPC=0x${(prevPC>>>0).toString(16)}`);
        if (statusChanges === MAX_STATUS_LOGS) console.log('... (Status change log full)');
    }

    // Catch non-kernel PCs (kseg0: 0x80000000-0x9FFFFFFF, kseg1: 0xA0000000-0xBFFFFFFF)
    const upc = cpu.pc >>> 0;
    if (upc < 0x80000000 && !badPcFound) {
        badPcFound = true;
        console.log(`\n[step ${i}] BAD PC=0x${upc.toString(16)} prevPC=0x${(prevPC>>>0).toString(16)}`);
        console.log(`  Status=0x${(newStatus>>>0).toString(16).padStart(8,'0')} Cause=0x${(cpu.cp0Registers[13]>>>0).toString(16)} EPC=0x${(cpu.cp0Registers[14]>>>0).toString(16)}`);
        for (let j = -4; j <= 2; j++) {
            const a = ((prevPC>>>0) + j*4) >>> 0;
            try { console.log(`  prevPC+${j*4} (0x${a.toString(16)}): instr=0x${(mmu.read32(a)>>>0).toString(16)}`); } catch(e) {}
        }
        // Don't break — let exception handler run and see what happens after
    }

    if (Date.now() > deadline) { console.log(`Timeout at step ${i}`); break; }
}
console.log(`\nFinal: PC=0x${(cpu.pc>>>0).toString(16)} Status=0x${(cpu.cp0Registers[12]>>>0).toString(16).padStart(8,'0')} IE=${cpu.cp0Registers[12] & 1} f3d=${rcp.f3dTaskCount|0}`);
