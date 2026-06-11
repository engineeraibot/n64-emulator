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

// Watch TCB[0x118] = 0x80303008
const TCB_STATUS = 0x80303008;
const watchPhys = TCB_STATUS & 0x7FFFFF;

const origWrite32 = mmu.write32.bind(mmu);
mmu.write32 = function(a, v) {
    const phys = a & 0x7FFFFF;
    if (phys >= watchPhys && phys < watchPhys + 8) {
        const off = phys - watchPhys;
        console.log(`  [step ${cpu.instructionCount}] WRITE TCB+0x118+${off}=0x${(v>>>0).toString(16).padStart(8,'0')} PC=0x${(cpu.pc>>>0).toString(16)} Status=0x${(cpu.cp0Registers[12]>>>0).toString(16)}`);
        // Print a few nearby instructions
        for (let j = -4; j <= 2; j++) {
            const a2 = ((cpu.pc>>>0) + j*4) >>> 0;
            try { const instr = mmu.read32(a2)>>>0;
                const op = instr>>>26, rs=(instr>>21)&31, rt=(instr>>16)&31, rd=(instr>>11)&31, func=instr&63;
                let d = `0x${instr.toString(16)}`;
                if (instr === 0) d = 'NOP';
                else if (op===0x2b) d = `SW $${rt},${((instr<<16)>>16)}($${rs})`;
                else if (op===0x3f) d = `SD $${rt},${((instr<<16)>>16)}($${rs})`;
                else if (op===0x23) d = `LW $${rt},${((instr<<16)>>16)}($${rs})`;
                else if (op===0x37) d = `LD $${rt},${((instr<<16)>>16)}($${rs})`;
                else if (op===0x10 && rs===4) d = `MTC0 $${rt},CP0[${rd}]`;
                console.log(`    PC+${j*4}: ${d}`);
            } catch(e) {}
        }
    }
    return origWrite32(a, v);
};

const deadline = Date.now() + 12000;
for (let i = 0; i < 3000000; i++) {
    cpu.step();
    if (Date.now() > deadline) { console.log('TIMEOUT at step', i); break; }
}
console.log(`Final TCB[0x118]=0x${rd32(TCB_STATUS).toString(16)} Status=0x${(cpu.cp0Registers[12]>>>0).toString(16)}`);
