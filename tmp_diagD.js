// Watch ALL writes in range 0x80302e00-0x80304000 to find where osCreateThread sets thread SR
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = __dirname;
const files = ['memory.js', 'mmu.js', 'rcp.js', 'cpu.js'];
let combined = '';
for (const f of files) combined += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n';
combined += '\nthis.__classes = { Memory, MMU, RCP, CPU };\n';
const sandbox = { console: { log(){}, warn(){}, error(){} }, setTimeout:()=>{}, clearTimeout:()=>{},
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

const WATCH_LO = 0x302e00, WATCH_HI = 0x304000; // physical range around thread @ 0x80302ef0
let stepCount = 0, cpuRef = null, writes = [];

const origW32 = ram.write32.bind(ram);
ram.write32 = function(address, value) {
    const phys = address & 0x7FFFFF;
    if (phys >= WATCH_LO && phys < WATCH_HI) {
        writes.push({ s: stepCount, p: phys, v: value>>>0, pc: cpuRef?(cpuRef.pc>>>0):0 });
    }
    return origW32(address, value);
};

const mmu = new MMU(ram);
const rcp = new RCP(mmu, framebuffer);
const cpu = new CPU(mmu, rcp);
cpuRef = cpu;
mmu.cpu = cpu; mmu.rcp = rcp;
ram.loadRom(ab);
cpu.isRunning = true;
cpu.performHleBoot();

const deadline = Date.now() + 15000;
for (stepCount = 0; stepCount < 10000000; stepCount++) {
    cpu.step();
    if (Date.now() > deadline) { console.log('TIMEOUT at step', stepCount); break; }
}

// Print all writes near 0x303008 (TCB+0x118)
console.log(`Writes to 0x80302e00..0x80304000 (phys) near TCB+0x118 (0x303008):`);
for (const w of writes) {
    if (w.p >= 0x303000 && w.p < 0x303020) {
        console.log(`  step=${w.s} phys=0x${w.p.toString(16)} val=0x${w.v.toString(16).padStart(8,'0')} PC=0x${w.pc.toString(16)}`);
    }
}
console.log(`\nAll writes in range, grouped by offset from 0x80302ef0:`);
const byOff = new Map();
for (const w of writes) {
    const off = w.p - 0x302ef0;
    if (off >= 0 && off < 0x200) { // within plausible TCB size
        if (!byOff.has(off)) byOff.set(off, []);
        byOff.get(off).push(w);
    }
}
const sorted = [...byOff.entries()].sort((a,b) => a[0]-b[0]);
for (const [off, ws] of sorted) {
    console.log(`  TCB+0x${off.toString(16)}: ${ws.length} writes, last val=0x${ws[ws.length-1].v.toString(16).padStart(8,'0')} at step=${ws[ws.length-1].s} PC=0x${ws[ws.length-1].pc.toString(16)}`);
}
