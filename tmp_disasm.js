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
const ram = new Memory(8 * 1024 * 1024);
const mmu = new MMU(ram);
const rcp = new RCP(mmu, new sandbox.Uint8Array(320 * 240 * 4));
const cpu = new CPU(mmu, rcp);
mmu.cpu = cpu; mmu.rcp = rcp;
ram.loadRom(ab);
cpu.isRunning = true;
cpu.performHleBoot();

// Simple MIPS disassembler
const REGS = ['$0','$at','$v0','$v1','$a0','$a1','$a2','$a3','$t0','$t1','$t2','$t3','$t4','$t5','$t6','$t7','$s0','$s1','$s2','$s3','$s4','$s5','$s6','$s7','$t8','$t9','$k0','$k1','$gp','$sp','$fp','$ra'];
const CP0_NAMES = {0:'Index',1:'Random',2:'EntryLo0',3:'EntryLo1',4:'Context',5:'PageMask',6:'Wired',8:'BadVAddr',9:'Count',10:'EntryHi',11:'Compare',12:'Status',13:'Cause',14:'EPC',15:'PRId',16:'Config',28:'TagLo',30:'ErrorEPC'};

function dis(addr, instr) {
    const op = instr >>> 26;
    const rs = (instr >> 21) & 0x1F;
    const rt = (instr >> 16) & 0x1F;
    const rd = (instr >> 11) & 0x1F;
    const sa = (instr >> 6) & 0x1F;
    const func = instr & 0x3F;
    const imm16 = (instr << 16) >> 16;
    const uimm16 = instr & 0xFFFF;
    
    if (instr === 0) return 'NOP';
    switch(op) {
        case 0: { // SPECIAL
            switch(func) {
                case 0x00: return `SLL ${REGS[rd]},${REGS[rt]},${sa}`;
                case 0x02: return `SRL ${REGS[rd]},${REGS[rt]},${sa}`;
                case 0x03: return `SRA ${REGS[rd]},${REGS[rt]},${sa}`;
                case 0x08: return `JR ${REGS[rs]}`;
                case 0x09: return `JALR ${REGS[rd]},${REGS[rs]}`;
                case 0x0C: return `SYSCALL`;
                case 0x0D: return `BREAK 0x${((instr>>6)&0xFFFFF).toString(16)}`;
                case 0x10: return `MFHI ${REGS[rd]}`;
                case 0x12: return `MFLO ${REGS[rd]}`;
                case 0x19: return `MULTU ${REGS[rs]},${REGS[rt]}`;
                case 0x1A: return `DIV ${REGS[rs]},${REGS[rt]}`;
                case 0x20: return `ADD ${REGS[rd]},${REGS[rs]},${REGS[rt]}`;
                case 0x21: return `ADDU ${REGS[rd]},${REGS[rs]},${REGS[rt]}`;
                case 0x23: return `SUBU ${REGS[rd]},${REGS[rs]},${REGS[rt]}`;
                case 0x24: return `AND ${REGS[rd]},${REGS[rs]},${REGS[rt]}`;
                case 0x25: return `OR ${REGS[rd]},${REGS[rs]},${REGS[rt]}`;
                case 0x26: return `XOR ${REGS[rd]},${REGS[rs]},${REGS[rt]}`;
                case 0x27: return `NOR ${REGS[rd]},${REGS[rs]},${REGS[rt]}`;
                case 0x2A: return `SLT ${REGS[rd]},${REGS[rs]},${REGS[rt]}`;
                case 0x2B: return `SLTU ${REGS[rd]},${REGS[rs]},${REGS[rt]}`;
                default: return `SPECIAL_${func.toString(16)}`;
            }
        }
        case 0x04: return `BEQ ${REGS[rs]},${REGS[rt]},0x${((addr+4+(imm16*4))>>>0).toString(16)}`;
        case 0x05: return `BNE ${REGS[rs]},${REGS[rt]},0x${((addr+4+(imm16*4))>>>0).toString(16)}`;
        case 0x08: return `ADDI ${REGS[rt]},${REGS[rs]},${imm16}`;
        case 0x09: return `ADDIU ${REGS[rt]},${REGS[rs]},0x${uimm16.toString(16)}`;
        case 0x0C: return `ANDI ${REGS[rt]},${REGS[rs]},0x${uimm16.toString(16)}`;
        case 0x0D: return `ORI ${REGS[rt]},${REGS[rs]},0x${uimm16.toString(16)}`;
        case 0x0F: return `LUI ${REGS[rt]},0x${uimm16.toString(16)}`;
        case 0x10: { // COP0
            const co = (instr >> 25) & 1;
            if (co) {
                if (func === 0x18) return 'ERET';
                return `COP0_CO_${func.toString(16)}`;
            }
            switch(rs) {
                case 0: return `MFC0 ${REGS[rt]},${CP0_NAMES[rd]||'CP0_'+rd}`;
                case 4: return `MTC0 ${REGS[rt]},${CP0_NAMES[rd]||'CP0_'+rd}`;
                default: return `COP0_${rs.toString(16)}`;
            }
        }
        case 0x23: return `LW ${REGS[rt]},${imm16}(${REGS[rs]})`;
        case 0x25: return `LHU ${REGS[rt]},${imm16}(${REGS[rs]})`;
        case 0x2B: return `SW ${REGS[rt]},${imm16}(${REGS[rs]})`;
        case 0x37: return `LD ${REGS[rt]},${imm16}(${REGS[rs]})`;
        case 0x3F: return `SD ${REGS[rt]},${imm16}(${REGS[rs]})`;
        case 0x24: return `LBU ${REGS[rt]},${imm16}(${REGS[rs]})`;
        case 0x20: return `LB ${REGS[rt]},${imm16}(${REGS[rs]})`;
        case 0x28: return `SB ${REGS[rt]},${imm16}(${REGS[rs]})`;
        case 0x2C: return `SDL ${REGS[rt]},${imm16}(${REGS[rs]})`;
        case 0x2D: return `SDR ${REGS[rt]},${imm16}(${REGS[rs]})`;
        case 0x1A: return `LDL ${REGS[rt]},${imm16}(${REGS[rs]})`;
        case 0x1B: return `LDR ${REGS[rt]},${imm16}(${REGS[rs]})`;
        default: return `op${op.toString(16)}_${func.toString(16)}`;
    }
}

// Dump interrupt handler area: 0x802f3900 - 0x802f4200
console.log('=== Interrupt handler (0x802f3900 - 0x802f4200) ===');
for (let addr = 0x802f3900; addr < 0x802f4200; addr += 4) {
    let instr;
    try { instr = mmu.read32(addr) >>> 0; } catch(e) { break; }
    const d = dis(addr, instr);
    const marker = (addr === 0x802f40b0) ? ' <*** MTC0 Status crash ***>' : '';
    console.log(`  0x${addr.toString(16)}: 0x${instr.toString(16).padStart(8,'0')}  ${d}${marker}`);
}
