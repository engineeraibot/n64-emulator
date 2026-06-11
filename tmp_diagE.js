// Trace all VI register writes and watch why viRegisters[6] stays 0
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = __dirname;
const files = ['memory.js', 'mmu.js', 'rcp.js', 'cpu.js'];
let combined = '';
for (const f of files) combined += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n';
combined += '\nthis.__classes = { Memory, MMU, RCP, CPU };\n';
const sandbox = { console:{log(){},warn(){},error(){}}, setTimeout:()=>{}, clearTimeout:()=>{},
    performance:{now:()=>Date.now()}, Math, Number, BigInt, JSON, DataView, ArrayBuffer,
    Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
    Float32Array, Float64Array, Array };
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

// Patch mmu.write32 to watch all writes to VI register range (0x04400000-0x04400FFF)
const origWrite32 = mmu.write32.bind(mmu);
let viWrites = [], stepCount = 0;
mmu.write32 = function(a, v) {
    const phys = (a & 0x1FFFFFFF) >>> 0;
    if (phys >= 0x04400000 && phys < 0x04400050) {
        const reg = (phys - 0x04400000) >> 2;
        viWrites.push({ s: stepCount, pc: (cpu.pc>>>0), reg, v: v>>>0 });
        if (viWrites.length <= 30) {
            console.log(`  [step ${stepCount}] VI[${reg}] = 0x${(v>>>0).toString(16).padStart(8,'0')} from PC=0x${(cpu.pc>>>0).toString(16)}`);
        }
    }
    return origWrite32(a, v);
};

const deadline = Date.now() + 20000;
let steps;
for (steps = 0; steps < 200000000; steps++) {
    stepCount = steps;
    cpu.step();
    if (Date.now() > deadline) break;
}
console.log(`\nTotal VI writes: ${viWrites.length}, viRegisters[6]=${mmu.viRegisters[6]}`);
console.log(`viNextInterrupt=${mmu.viNextInterrupt}`);
console.log(`Steps: ${steps}, Status=0x${(cpu.cp0Registers[12]>>>0).toString(16)}`);
