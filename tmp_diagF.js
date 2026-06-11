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

// Watch if PC ever reaches VI init (0x802515F0) or osViSetMode area
const TARGET_PCS = [0x802515F0, 0x802515f0, 0x8024E5F0];
let hitVI = false;

// Also monitor writes to VI registers (physical 0x04400000+)
const origWrite32 = mmu.write32.bind(mmu);
let viWrites = 0;
mmu.write32 = function(a, v) {
    const phys = (a & 0x1FFFFFFF) >>> 0;
    if (phys >= 0x04400000 && phys < 0x04400050) {
        viWrites++;
        const reg = (phys - 0x04400000) >> 2;
        console.log(`  VI[${reg}]=0x${(v>>>0).toString(16)} from PC=0x${(cpu.pc>>>0).toString(16)} step=${cpu.instructionCount}`);
    }
    return origWrite32(a, v);
};

const deadline = Date.now() + 20000;
let steps;
for (steps = 0; steps < 100000000; steps++) {
    const pc = cpu.pc >>> 0;
    if (pc === 0x802515f0 || pc === 0x8024e5f0) {
        if (!hitVI) {
            hitVI = true;
            console.log(`Hit VI init code at PC=0x${pc.toString(16)} step=${steps}`);
        }
    }
    cpu.step();
    if (Date.now() > deadline) break;
}
console.log(`Done. steps=${steps} viWrites=${viWrites} viReg6=${mmu.viRegisters[6]} Status=0x${(cpu.cp0Registers[12]>>>0).toString(16)}`);
// Also print what's in RDRAM around 0x802515F0
const phys = 0x2515f0;
const rdv = new DataView(ram.rdram);
console.log('Instructions at 0x802515F0:');
for (let i = 0; i < 8; i++) {
    const w = rdv.getUint32(phys + i*4, false) >>> 0;
    console.log(`  0x${(0x802515F0 + i*4).toString(16)}: 0x${w.toString(16).padStart(8,'0')}`);
}
