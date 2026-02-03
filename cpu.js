class CPU {
    constructor(mmu, rcp) {
        console.log("CPU Initialized");
        this.mmu = mmu;
        this.rcp = rcp;
        this.reset();
    }

    reset() {
        console.log("CPU Reset");
        this.instructionCount = 0;
        this.gpr = new BigInt64Array(32);
        this.fprBuffer = new ArrayBuffer(32 * 8);
        this.fprView = new DataView(this.fprBuffer);
        this.fcr0 = 0x00000510; // FPU implementation/revision
        this.fcr31 = 0;        // FPU control/status
        this.pc = 0xBFC00000n;
        this.cp0Registers = new BigInt64Array(32);
        this.cp0Registers[16] = 0x0006E463n; // Config: standard N64 config
        this.hi = 0n;
        this.lo = 0n;
        this.gpr[0] = 0n;
        this.isRunning = false;
        this.branchTaken = false;
        this.branchTarget = 0n;
        this.isHleBootDone = false;
        this.exceptionRaised = false;
    }

    run() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log("CPU is running...");

        if (!this.isHleBootDone) {
            this.performHleBoot();
        }

        const runFrame = () => {
            if (!this.isRunning) return;
            // High instructions per frame for SM64
            for (let i = 0; i < 5000000; i++) {
                this.step();
            }
            requestAnimationFrame(runFrame);
        };
        requestAnimationFrame(runFrame);
    }

    performHleBoot() {
        console.log("Performing HLE Boot (Skip IPL3)...");
        const memory = this.mmu.memory;
        if (!memory.rom) {
            console.error("HLE Boot: No ROM loaded!");
            return;
        }

        const romView = new Uint8Array(memory.rom);
        const rdramView = new Uint8Array(memory.rdram);
        const romDataView = new DataView(memory.rom);

        // Copy header to RDRAM 0
        rdramView.set(romView.subarray(0, 0x1000), 0);

        // Read Entry Point from header offset 0x08
        const entryPoint = BigInt(romDataView.getUint32(0x08, false)) & 0xFFFFFFFFn;
        this.pc = BigInt.asIntN(32, entryPoint);

        // Copy the boot segment from ROM 0x1000 to RAM
        const ramOffset = Number(entryPoint & 0x00FFFFFFn);
        const segmentSize = 0x100000; // Copy 1MB to be safe
        if (ramOffset + segmentSize <= rdramView.length) {
            rdramView.set(romView.subarray(0x1000, 0x1000 + segmentSize), ramOffset);
        }

        console.log(`HLE Boot: Entry Point=0x${entryPoint.toString(16)}, RAM Offset=0x${ramOffset.toString(16)}`);

        // Initialize registers
        this.gpr[29] = 0x80370000n; // sp
        this.gpr[31] = 0x80000000n; // ra
        this.cp0Registers[12] = 0x34000000n; // CU0, CU1 set

        this.isHleBootDone = true;
    }

    stop() {
        this.isRunning = false;
        console.log("CPU stopped.");
    }

    step() {
        this.instructionCount++;

        this.cp0Registers[9] = (this.cp0Registers[9] + 1n) & 0xFFFFFFFFn; // Count
        if (this.cp0Registers[9] === this.cp0Registers[11]) {
            this.cp0Registers[13] |= 0x00008000n; // IP7 (Timer)
        }

        // Update Cause IP2 from MI_INTR_REG & MI_INTR_MASK_REG
        if (this.mmu.miRegisters[2] & this.mmu.miRegisters[3]) {
            this.cp0Registers[13] |= 0x00000400n; // IP2
        } else {
            this.cp0Registers[13] &= ~0x00000400n;
        }

        const status = this.cp0Registers[12];
        const cause = this.cp0Registers[13];
        if ((status & 1n) && !(status & 2n)) { // IE=1, EXL=0
            if ((status >> 8n) & (cause >> 8n) & 0xFFn) {
                this.raiseException(0, this.pc, false);
            }
        }

        const currentPc = this.pc;
        const instruction = this.mmu.read32(Number(currentPc));

        this.exceptionRaised = false;
        const nextPc = this.decodeAndExecute(instruction, currentPc);
        if (this.exceptionRaised || nextPc === null) return;

        if (this.branchTaken) {
            const delaySlotInstruction = this.mmu.read32(Number(currentPc + 4n));
            this.decodeAndExecute(delaySlotInstruction, currentPc + 4n);

            this.pc = BigInt.asIntN(32, this.branchTarget);
            this.branchTaken = false;
        } else {
            this.pc = BigInt.asIntN(32, nextPc);
        }

        this.gpr[0] = 0n;
    }

    decodeAndExecute(instruction, currentPc) {
        const opcode = (instruction >>> 26) & 0x3F;

        switch (opcode) {
            case 0x00: return this.opSPECIAL(instruction, currentPc);
            case 0x01: return this.opREGIMM(instruction, currentPc);
            case 0x02: return this.opJ(instruction, currentPc);
            case 0x03: return this.opJAL(instruction, currentPc);
            case 0x04: return this.opBEQ(instruction, currentPc);
            case 0x05: return this.opBNE(instruction, currentPc);
            case 0x06: return this.opBLEZ(instruction, currentPc);
            case 0x07: return this.opBGTZ(instruction, currentPc);
            case 0x14: return this.opBEQL(instruction, currentPc);
            case 0x15: return this.opBNEL(instruction, currentPc);
            case 0x16: return this.opBLEZL(instruction, currentPc);
            case 0x17: return this.opBGTZL(instruction, currentPc);
            case 0x12: return this.opCOP2(instruction, currentPc);
            case 0x1C: return this.opSPECIAL2(instruction, currentPc);
            case 0x08:
            case 0x09: this.opADDIU(instruction); break;
            case 0x18: // DADDI
            case 0x19: this.opDADDIU(instruction); break;
            case 0x0A: this.opSLTI(instruction); break;
            case 0x0B: this.opSLTIU(instruction); break;
            case 0x0C: this.opANDI(instruction); break;
            case 0x0D: this.opORI(instruction); break;
            case 0x0E: this.opXORI(instruction); break;
            case 0x0F: this.opLUI(instruction); break;
            case 0x10: if (this.opCOP0(instruction)) return null; break;
            case 0x11: { const pc = this.opCOP1(instruction, currentPc); if (pc !== undefined) return pc; break; }
            case 0x1A: this.opLDL(instruction); break;
            case 0x1B: this.opLDR(instruction); break;
            case 0x20: this.opLB(instruction); break;
            case 0x21: this.opLH(instruction); break;
            case 0x22: this.opLWL(instruction); break;
            case 0x23: this.opLW(instruction); break;
            case 0x24: this.opLBU(instruction); break;
            case 0x25: this.opLHU(instruction); break;
            case 0x26: this.opLWR(instruction); break;
            case 0x27: this.opLWU(instruction); break;
            case 0x28: this.opSB(instruction); break;
            case 0x29: this.opSH(instruction); break;
            case 0x2A: this.opSWL(instruction); break;
            case 0x2B: this.opSW(instruction); break;
            case 0x2C: this.opSDL(instruction); break;
            case 0x2D: this.opSWR(instruction); break;
            case 0x2E: this.opSDR(instruction); break;
            case 0x2F: break; // CACHE
            case 0x30: this.opLL(instruction); break;
            case 0x31: this.opLWC1(instruction); break;
            case 0x33: break; // PREF
            case 0x34: this.opLLD(instruction); break;
            case 0x35: this.opLDC1(instruction); break;
            case 0x38: this.opSC(instruction); break;
            case 0x39: this.opSWC1(instruction); break;
            case 0x3B: break; // CACHE
            case 0x3C: this.opSCD(instruction); break;
            case 0x3D: this.opSDC1(instruction); break;
            case 0x37: this.opLD(instruction); break;
            case 0x3F: this.opSD(instruction); break;
            default:
                if (instruction !== 0) console.warn(`Unknown opcode: 0x${opcode.toString(16).padStart(2, '0')} at PC 0x${BigInt.asUintN(32, currentPc).toString(16).padStart(8, '0')}`);
        }
        return currentPc + 4n;
    }
    opBEQL(instruction, currentPc) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] === this.gpr[rt]) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
            return currentPc + 4n;
        }
        return currentPc + 8n;
    }
    opBNEL(instruction, currentPc) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] !== this.gpr[rt]) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
            return currentPc + 4n;
        }
        return currentPc + 8n;
    }
    opBLEZL(instruction, currentPc) {
        const rs = (instruction >>> 21) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] <= 0n) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
            return currentPc + 4n;
        }
        return currentPc + 8n;
    }
    opBGTZL(instruction, currentPc) {
        const rs = (instruction >>> 21) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] > 0n) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
            return currentPc + 4n;
        }
        return currentPc + 8n;
    }

    opCOP2(instruction, currentPc) {
        return currentPc + 4n;
    }

    opSPECIAL2(instruction, currentPc) {
        const funct = instruction & 0x3F;
        if (funct === 0x02) { // MUL
            const rs = (instruction >>> 21) & 0x1F;
            const rt = (instruction >>> 16) & 0x1F;
            const rd = (instruction >>> 11) & 0x1F;
            this.gpr[rd] = BigInt.asIntN(32, BigInt.asIntN(32, this.gpr[rs]) * BigInt.asIntN(32, this.gpr[rt]));
        }
        return currentPc + 4n;
    }

    opSPECIAL(instruction, currentPc) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const rd = (instruction >>> 11) & 0x1F;
        const sa = (instruction >>> 6) & 0x1F;
        const funct = instruction & 0x3F;

        switch (funct) {
            case 0x00: this.gpr[rd] = BigInt.asIntN(32, (this.gpr[rt] & 0xFFFFFFFFn) << BigInt(sa)); break;
            case 0x01: // MOVCI
                const tf = (instruction >>> 16) & 1;
                const cond = (this.fcr31 & 0x00800000) !== 0;
                if (tf === (cond ? 1 : 0)) this.gpr[rd] = this.gpr[rs];
                break;
            case 0x02: this.gpr[rd] = BigInt.asIntN(32, (BigInt.asUintN(32, this.gpr[rt]) >> BigInt(sa))); break;
            case 0x03: this.gpr[rd] = BigInt.asIntN(32, (BigInt.asIntN(32, this.gpr[rt]) >> BigInt(sa))); break;
            case 0x04: this.gpr[rd] = BigInt.asIntN(32, (this.gpr[rt] & 0xFFFFFFFFn) << (this.gpr[rs] & 0x1Fn)); break;
            case 0x06: this.gpr[rd] = BigInt.asIntN(32, (BigInt.asUintN(32, this.gpr[rt]) >> (this.gpr[rs] & 0x1Fn))); break;
            case 0x07: this.gpr[rd] = BigInt.asIntN(32, (BigInt.asIntN(32, this.gpr[rt]) >> (this.gpr[rs] & 0x1Fn))); break;
            case 0x0A: if (this.gpr[rt] === 0n) this.gpr[rd] = this.gpr[rs]; break; // MOVZ
            case 0x0B: if (this.gpr[rt] !== 0n) this.gpr[rd] = this.gpr[rs]; break; // MOVN
            case 0x0C: return this.raiseException(8, currentPc, false); // SYSCALL
            case 0x0D: return this.raiseException(9, currentPc, false); // BREAK
            case 0x0F: break; // SYNC
            case 0x08: this.branchTarget = this.gpr[rs]; this.branchTaken = true; break;
            case 0x09: this.branchTarget = this.gpr[rs]; this.gpr[rd] = currentPc + 8n; this.branchTaken = true; break;
            case 0x10: this.gpr[rd] = this.hi; break; // MFHI
            case 0x11: this.hi = this.gpr[rs]; break; // MTHI
            case 0x12: this.gpr[rd] = this.lo; break; // MFLO
            case 0x13: this.lo = this.gpr[rs]; break; // MTLO
            case 0x14: this.gpr[rd] = BigInt.asIntN(64, this.gpr[rt] << (this.gpr[rs] & 0x3Fn)); break; // DSLLV
            case 0x16: this.gpr[rd] = BigInt.asIntN(64, BigInt.asUintN(64, this.gpr[rt]) >> (this.gpr[rs] & 0x3Fn)); break; // DSRLV
            case 0x17: this.gpr[rd] = BigInt.asIntN(64, BigInt.asIntN(64, this.gpr[rt]) >> (this.gpr[rs] & 0x3Fn)); break; // DSRAV
            case 0x18: { // MULT
                const res = BigInt.asIntN(32, this.gpr[rs]) * BigInt.asIntN(32, this.gpr[rt]);
                this.lo = BigInt.asIntN(32, res);
                this.hi = BigInt.asIntN(32, res >> 32n);
                break;
            }
            case 0x19: { // MULTU
                const res = BigInt.asUintN(32, this.gpr[rs]) * BigInt.asUintN(32, this.gpr[rt]);
                this.lo = BigInt.asIntN(32, res);
                this.hi = BigInt.asIntN(32, res >> 32n);
                break;
            }
            case 0x1A: { // DIV
                const a = BigInt.asIntN(32, this.gpr[rs]);
                const b = BigInt.asIntN(32, this.gpr[rt]);
                if (b !== 0n) { this.lo = BigInt.asIntN(32, a / b); this.hi = BigInt.asIntN(32, a % b); }
                break;
            }
            case 0x1C: { // DMULT
                const a = this.gpr[rs];
                const b = this.gpr[rt];
                const res = a * b;
                this.lo = BigInt.asIntN(64, res);
                this.hi = BigInt.asIntN(64, res >> 64n);
                break;
            }
            case 0x1D: { // DMULTU
                const a = BigInt.asUintN(64, this.gpr[rs]);
                const b = BigInt.asUintN(64, this.gpr[rt]);
                const res = a * b;
                this.lo = BigInt.asIntN(64, res & 0xFFFFFFFFFFFFFFFFn);
                this.hi = BigInt.asIntN(64, res >> 64n);
                break;
            }
            case 0x1E: { // DDIV
                const a = this.gpr[rs];
                const b = this.gpr[rt];
                if (b !== 0n) { this.lo = a / b; this.hi = a % b; }
                break;
            }
            case 0x1F: { // DDIVU
                const a = BigInt.asUintN(64, this.gpr[rs]);
                const b = BigInt.asUintN(64, this.gpr[rt]);
                if (b !== 0n) {
                    this.lo = BigInt.asIntN(64, a / b);
                    this.hi = BigInt.asIntN(64, a % b);
                }
                break;
            }
            case 0x1B: { // DIVU
                const a = BigInt.asUintN(32, this.gpr[rs]);
                const b = BigInt.asUintN(32, this.gpr[rt]);
                if (b !== 0n) { this.lo = BigInt.asIntN(32, a / b); this.hi = BigInt.asIntN(32, a % b); }
                break;
            }
            case 0x20:
            case 0x21: this.gpr[rd] = BigInt.asIntN(32, this.gpr[rs] + this.gpr[rt]); break;
            case 0x22:
            case 0x23: this.gpr[rd] = BigInt.asIntN(32, this.gpr[rs] - this.gpr[rt]); break;
            case 0x24: this.gpr[rd] = this.gpr[rs] & this.gpr[rt]; break;
            case 0x25: this.gpr[rd] = this.gpr[rs] | this.gpr[rt]; break;
            case 0x26: this.gpr[rd] = this.gpr[rs] ^ this.gpr[rt]; break;
            case 0x27: this.gpr[rd] = ~(this.gpr[rs] | this.gpr[rt]); break;
            case 0x2A: this.gpr[rd] = (this.gpr[rs] < this.gpr[rt]) ? 1n : 0n; break;
            case 0x2B: this.gpr[rd] = (BigInt.asUintN(64, this.gpr[rs]) < BigInt.asUintN(64, this.gpr[rt])) ? 1n : 0n; break;
            case 0x2C:
            case 0x2D: this.gpr[rd] = this.gpr[rs] + this.gpr[rt]; break; // DADDU
            case 0x2E:
            case 0x2F: this.gpr[rd] = this.gpr[rs] - this.gpr[rt]; break; // DSUBU
            case 0x30: if (this.gpr[rs] >= this.gpr[rt]) return this.raiseException(13, currentPc, false); break; // TGE
            case 0x31: if (BigInt.asUintN(64, this.gpr[rs]) >= BigInt.asUintN(64, this.gpr[rt])) return this.raiseException(13, currentPc, false); break; // TGEU
            case 0x32: if (this.gpr[rs] < this.gpr[rt]) return this.raiseException(13, currentPc, false); break; // TLT
            case 0x33: if (BigInt.asUintN(64, this.gpr[rs]) < BigInt.asUintN(64, this.gpr[rt])) return this.raiseException(13, currentPc, false); break; // TLTU
            case 0x34: if (this.gpr[rs] === this.gpr[rt]) return this.raiseException(13, currentPc, false); break; // TEQ
            case 0x36: if (this.gpr[rs] !== this.gpr[rt]) return this.raiseException(13, currentPc, false); break; // TNE
            case 0x38: this.gpr[rd] = BigInt.asIntN(64, this.gpr[rt] << BigInt(sa)); break; // DSLL
            case 0x3A: this.gpr[rd] = BigInt.asIntN(64, BigInt.asUintN(64, this.gpr[rt]) >> BigInt(sa)); break; // DSRL
            case 0x3B: this.gpr[rd] = BigInt.asIntN(64, BigInt.asIntN(64, this.gpr[rt]) >> BigInt(sa)); break; // DSRA
            case 0x3C: this.gpr[rd] = BigInt.asIntN(64, this.gpr[rt] << (BigInt(sa) + 32n)); break; // DSLL32
            case 0x3E: this.gpr[rd] = BigInt.asIntN(64, BigInt.asUintN(64, this.gpr[rt]) >> (BigInt(sa) + 32n)); break; // DSRL32
            case 0x3F: this.gpr[rd] = BigInt.asIntN(64, BigInt.asIntN(64, this.gpr[rt]) >> (BigInt(sa) + 32n)); break; // DSRA32
            default:
                if (instruction !== 0) console.warn(`Unknown SPECIAL funct: 0x${funct.toString(16).padStart(2, '0')} at PC 0x${BigInt.asUintN(32, currentPc).toString(16).padStart(8, '0')}`);
        }
        return currentPc + 4n;
    }

    opADDIU(instruction) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        this.gpr[rt] = BigInt.asIntN(32, this.gpr[rs] + imm);
    }
    opDADDIU(instruction) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        this.gpr[rt] = this.gpr[rs] + imm;
    }
    opSLTI(instruction) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        this.gpr[rt] = (this.gpr[rs] < imm) ? 1n : 0n;
    }
    opSLTIU(instruction) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        this.gpr[rt] = (BigInt.asUintN(64, this.gpr[rs]) < BigInt.asUintN(64, imm)) ? 1n : 0n;
    }
    opANDI(instruction) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt(instruction & 0xFFFF);
        this.gpr[rt] = this.gpr[rs] & imm;
    }
    opORI(instruction) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt(instruction & 0xFFFF);
        this.gpr[rt] = this.gpr[rs] | imm;
    }
    opXORI(instruction) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt(instruction & 0xFFFF);
        this.gpr[rt] = this.gpr[rs] ^ imm;
    }
    opLUI(instruction) {
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt(instruction & 0xFFFF);
        this.gpr[rt] = BigInt.asIntN(32, imm << 16n);
    }
    opBEQ(instruction, currentPc) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] === this.gpr[rt]) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
        }
        return currentPc + 4n;
    }
    opBNE(instruction, currentPc) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] !== this.gpr[rt]) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
        }
        return currentPc + 4n;
    }
    opBLEZ(instruction, currentPc) {
        const rs = (instruction >>> 21) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] <= 0n) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
        }
        return currentPc + 4n;
    }
    opBGTZ(instruction, currentPc) {
        const rs = (instruction >>> 21) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] > 0n) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
        }
        return currentPc + 4n;
    }
    opJ(instruction, currentPc) {
        const target = BigInt(instruction & 0x03FFFFFF);
        this.branchTarget = (currentPc & 0xF0000000n) | (target << 2n);
        this.branchTaken = true;
        return currentPc + 4n;
    }
    opJAL(instruction, currentPc) {
        this.gpr[31] = currentPc + 8n;
        return this.opJ(instruction, currentPc);
    }
    opREGIMM(instruction, currentPc) {
        const rs = (instruction >>> 21) & 0x1F;
        const sub = (instruction >>> 16) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        let taken = false;
        let link = false;
        let likely = false;
        switch (sub) {
            case 0x00: if (this.gpr[rs] < 0n) taken = true; break; // BLTZ
            case 0x01: if (this.gpr[rs] >= 0n) taken = true; break; // BGEZ
            case 0x02: if (this.gpr[rs] < 0n) { taken = true; likely = true; } break; // BLTZL
            case 0x03: if (this.gpr[rs] >= 0n) { taken = true; likely = true; } break; // BGEZL
            case 0x10: if (this.gpr[rs] < 0n) { taken = true; link = true; } break; // BLTZAL
            case 0x11: if (this.gpr[rs] >= 0n) { taken = true; link = true; } break; // BGEZAL
            case 0x12: if (this.gpr[rs] < 0n) { taken = true; link = true; likely = true; } break; // BLTZALL
            case 0x13: if (this.gpr[rs] >= 0n) { taken = true; link = true; likely = true; } break; // BGEZALL
        }
        if (link) this.gpr[31] = currentPc + 8n;
        if (taken) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
            return currentPc + 4n;
        } else {
            return likely ? currentPc + 8n : currentPc + 4n;
        }
    }
    opLB(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.gpr[rt] = BigInt.asIntN(8, BigInt(this.mmu.read8(Number(addr))));
    }
    opLBU(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.gpr[rt] = BigInt.asUintN(8, BigInt(this.mmu.read8(Number(addr))));
    }
    opLH(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.gpr[rt] = BigInt.asIntN(16, BigInt(this.mmu.read16(Number(addr))));
    }
    opLHU(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.gpr[rt] = BigInt.asUintN(16, BigInt(this.mmu.read16(Number(addr))));
    }
    opLW(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.gpr[rt] = BigInt.asIntN(32, BigInt(this.mmu.read32(Number(addr))));
    }
    opLWU(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.gpr[rt] = BigInt.asUintN(32, BigInt(this.mmu.read32(Number(addr))));
    }
    opLD(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.gpr[rt] = this.mmu.read64(Number(addr));
    }
    opSB(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.mmu.write8(Number(addr), Number(this.gpr[rt] & 0xFFn));
    }
    opSH(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.mmu.write16(Number(addr), Number(this.gpr[rt] & 0xFFFFn));
    }
    opSW(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.mmu.write32(Number(addr), Number(this.gpr[rt] & 0xFFFFFFFFn));
    }
    opLWL(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        const byteOffset = Number(addr & 3n);
        const word = this.mmu.read32(Number(addr & ~3n));
        const rt32 = Number(this.gpr[rt] & 0xFFFFFFFFn);
        let result;
        switch (byteOffset) {
            case 0: result = word; break;
            case 1: result = (rt32 & 0x000000FF) | (word << 8); break;
            case 2: result = (rt32 & 0x0000FFFF) | (word << 16); break;
            case 3: result = (rt32 & 0x00FFFFFF) | (word << 24); break;
        }
        this.gpr[rt] = BigInt.asIntN(32, BigInt(result | 0));
    }
    opLWR(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        const byteOffset = Number(addr & 3n);
        const word = this.mmu.read32(Number(addr & ~3n));
        const rt32 = Number(this.gpr[rt] & 0xFFFFFFFFn);
        let result;
        switch (byteOffset) {
            case 0: result = (rt32 & 0xFFFFFF00) | (word >>> 24); break;
            case 1: result = (rt32 & 0xFFFF0000) | (word >>> 16); break;
            case 2: result = (rt32 & 0xFF000000) | (word >>> 8); break;
            case 3: result = word; break;
        }
        this.gpr[rt] = BigInt.asIntN(32, BigInt(result | 0));
    }
    opSWL(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        const byteOffset = Number(addr & 3n);
        const wordAddr = Number(addr & ~3n);
        let word = this.mmu.read32(wordAddr);
        const rt32 = Number(this.gpr[rt] & 0xFFFFFFFFn);
        switch (byteOffset) {
            case 0: word = rt32; break;
            case 1: word = (word & 0xFF000000) | (rt32 >>> 8); break;
            case 2: word = (word & 0xFFFF0000) | (rt32 >>> 16); break;
            case 3: word = (word & 0xFFFFFF00) | (rt32 >>> 24); break;
        }
        this.mmu.write32(wordAddr, word);
    }
    opSWR(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        const byteOffset = Number(addr & 3n);
        const wordAddr = Number(addr & ~3n);
        let word = this.mmu.read32(wordAddr);
        const rt32 = Number(this.gpr[rt] & 0xFFFFFFFFn);
        switch (byteOffset) {
            case 0: word = (word & 0x00FFFFFF) | (rt32 << 24); break;
            case 1: word = (word & 0x0000FFFF) | (rt32 << 16); break;
            case 2: word = (word & 0x000000FF) | (rt32 << 8); break;
            case 3: word = rt32; break;
        }
        this.mmu.write32(wordAddr, word);
    }
    opLDL(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        const dword = this.mmu.read64(Number(addr & ~7n));
        const rtVal = this.gpr[rt];
        const byteOffset = Number(addr & 7n);
        let result;
        // LDL Big-Endian: Load B0..Bn into R0..Rn
        switch (byteOffset) {
            case 0: result = (rtVal & 0x00FFFFFFFFFFFFFFn) | (dword & 0xFF00000000000000n); break;
            case 1: result = (rtVal & 0x0000FFFFFFFFFFFFn) | (dword & 0xFFFF000000000000n); break;
            case 2: result = (rtVal & 0x000000FFFFFFFFFFn) | (dword & 0xFFFFFF0000000000n); break;
            case 3: result = (rtVal & 0x00000000FFFFFFFFn) | (dword & 0xFFFFFFFF00000000n); break;
            case 4: result = (rtVal & 0x0000000000FFFFFFn) | (dword & 0xFFFFFFFFFF000000n); break;
            case 5: result = (rtVal & 0x000000000000FFFFn) | (dword & 0xFFFFFFFFFFFF0000n); break;
            case 6: result = (rtVal & 0x00000000000000FFn) | (dword & 0xFFFFFFFFFFFFFF00n); break;
            case 7: result = dword; break;
        }
        this.gpr[rt] = result;
    }
    opLDR(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        const dword = this.mmu.read64(Number(addr & ~7n));
        const rtVal = this.gpr[rt];
        const byteOffset = Number(addr & 7n);
        let result;
        // LDR Big-Endian: Load Bn..B7 into Rn..R7
        switch (byteOffset) {
            case 0: result = dword; break;
            case 1: result = (rtVal & 0xFF00000000000000n) | (dword & 0x00FFFFFFFFFFFFFFn); break;
            case 2: result = (rtVal & 0xFFFF000000000000n) | (dword & 0x0000FFFFFFFFFFFFn); break;
            case 3: result = (rtVal & 0xFFFFFF0000000000n) | (dword & 0x000000FFFFFFFFFFn); break;
            case 4: result = (rtVal & 0xFFFFFFFF00000000n) | (dword & 0x00000000FFFFFFFFn); break;
            case 5: result = (rtVal & 0xFFFFFFFFFF000000n) | (dword & 0x0000000000FFFFFFn); break;
            case 6: result = (rtVal & 0xFFFFFFFFFFFF0000n) | (dword & 0x000000000000FFFFn); break;
            case 7: result = (rtVal & 0xFFFFFFFFFFFFFF00n) | (dword & 0x00000000000000FFn); break;
        }
        this.gpr[rt] = result;
    }
    opSDL(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        const wordAddr = Number(addr & ~7n);
        const byteOffset = Number(addr & 7n);
        let dword = this.mmu.read64(wordAddr);
        const rtVal = this.gpr[rt];
        // SDL Big-Endian: Store R0..Rn into B0..Bn
        switch (byteOffset) {
            case 0: dword = (dword & 0x00FFFFFFFFFFFFFFn) | (rtVal & 0xFF00000000000000n); break;
            case 1: dword = (dword & 0x0000FFFFFFFFFFFFn) | (rtVal & 0xFFFF000000000000n); break;
            case 2: dword = (dword & 0x000000FFFFFFFFFFn) | (rtVal & 0xFFFFFF0000000000n); break;
            case 3: dword = (dword & 0x00000000FFFFFFFFn) | (rtVal & 0xFFFFFFFF00000000n); break;
            case 4: dword = (dword & 0x0000000000FFFFFFn) | (rtVal & 0xFFFFFFFFFF000000n); break;
            case 5: dword = (dword & 0x000000000000FFFFn) | (rtVal & 0xFFFFFFFFFFFF0000n); break;
            case 6: dword = (dword & 0x00000000000000FFn) | (rtVal & 0xFFFFFFFFFFFFFF00n); break;
            case 7: dword = rtVal; break;
        }
        this.mmu.write64(wordAddr, dword);
    }
    opSDR(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        const wordAddr = Number(addr & ~7n);
        const byteOffset = Number(addr & 7n);
        let dword = this.mmu.read64(wordAddr);
        const rtVal = this.gpr[rt];
        // SDR Big-Endian: Store Rn..R7 into Bn..B7
        switch (byteOffset) {
            case 0: dword = rtVal; break;
            case 1: dword = (dword & 0xFF00000000000000n) | (rtVal & 0x00FFFFFFFFFFFFFFn); break;
            case 2: dword = (dword & 0xFFFF000000000000n) | (rtVal & 0x0000FFFFFFFFFFFFn); break;
            case 3: dword = (dword & 0xFFFFFF0000000000n) | (rtVal & 0x000000FFFFFFFFFFn); break;
            case 4: dword = (dword & 0xFFFFFFFF00000000n) | (rtVal & 0x00000000FFFFFFFFn); break;
            case 5: dword = (dword & 0xFFFFFFFFFF000000n) | (rtVal & 0x0000000000FFFFFFn); break;
            case 6: dword = (dword & 0xFFFFFFFFFFFF0000n) | (rtVal & 0x000000000000FFFFn); break;
            case 7: dword = (dword & 0xFFFFFFFFFFFFFF00n) | (rtVal & 0x00000000000000FFn); break;
        }
        this.mmu.write64(wordAddr, dword);
    }
    opSD(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.mmu.write64(Number(addr), this.gpr[rt]);
    }
    opLL(instruction) {
        this.opLW(instruction); // Atomic not really needed on single-core
    }
    opLLD(instruction) {
        this.opLD(instruction);
    }
    opSC(instruction) {
        const rt = (instruction >>> 16) & 0x1F;
        this.opSW(instruction);
        this.gpr[rt] = 1n; // Always succeed
    }
    opSCD(instruction) {
        const rt = (instruction >>> 16) & 0x1F;
        this.opSD(instruction);
        this.gpr[rt] = 1n; // Always succeed
    }
    opLWC1(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const ft = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.fprView.setUint32(ft * 8 + 4, this.mmu.read32(Number(addr)), false);
    }
    opLDC1(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const ft = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.fprView.setBigUint64(ft * 8, this.mmu.read64(Number(addr)), false);
    }
    opSWC1(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const ft = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.mmu.write32(Number(addr), this.fprView.getUint32(ft * 8 + 4, false));
    }
    opSDC1(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const ft = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.mmu.write64(Number(addr), this.fprView.getBigUint64(ft * 8, false));
    }
    opCOP1(instruction, currentPc) {
        const sub = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const fs = (instruction >>> 11) & 0x1F;
        const fd = (instruction >>> 6) & 0x1F;
        const funct = instruction & 0x3F;

        if (sub === 0x08) { // BC1
            const cond = (this.fcr31 & 0x00800000) !== 0;
            const type = (instruction >>> 16) & 0x03;
            const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
            let taken = false;
            if (type === 0) taken = !cond;      // BC1F
            else if (type === 1) taken = cond;  // BC1T
            else if (type === 2) taken = !cond; // BC1FL
            else if (type === 3) taken = cond;  // BC1TL

            if (taken) {
                this.branchTarget = currentPc + 4n + (imm << 2n);
                this.branchTaken = true;
                return currentPc + 4n;
            } else if (type >= 2) {
                return currentPc + 8n; // Likely: skip delay slot
            }
            return currentPc + 4n;
        }

        if (sub === 0x00) { // MFC1
            this.gpr[rt] = BigInt.asIntN(32, BigInt(this.fprView.getUint32(fs * 8 + 4, false)));
        } else if (sub === 0x01) { // DMFC1
            this.gpr[rt] = this.fprView.getBigInt64(fs * 8, false);
        } else if (sub === 0x04) { // MTC1
            this.fprView.setUint32(fs * 8 + 4, Number(this.gpr[rt] & 0xFFFFFFFFn), false);
        } else if (sub === 0x05) { // DMTC1
            this.fprView.setBigInt64(fs * 8, this.gpr[rt], false);
        } else if (sub === 0x02) { // CFC1
            if (fs === 0) this.gpr[rt] = BigInt(this.fcr0);
            else if (fs === 31) this.gpr[rt] = BigInt(this.fcr31);
        } else if (sub === 0x06) { // CTC1
            if (fs === 31) this.fcr31 = Number(this.gpr[rt] & 0xFFFFFFFFn);
        } else if (sub >= 0x10) { // FPU Instructions
            const fmt = sub & 0x07;
            if (fmt === 0) { // Single precision
                const v1 = this.fprView.getFloat32(fs * 8 + 4, false);
                const v2 = this.fprView.getFloat32(rt * 8 + 4, false);
                if (funct === 0x00) this.fprView.setFloat32(fd * 8 + 4, v1 + v2, false); // ADD.S
                else if (funct === 0x01) this.fprView.setFloat32(fd * 8 + 4, v1 - v2, false); // SUB.S
                else if (funct === 0x02) this.fprView.setFloat32(fd * 8 + 4, v1 * v2, false); // MUL.S
                else if (funct === 0x03) this.fprView.setFloat32(fd * 8 + 4, v1 / v2, false); // DIV.S
                else if (funct === 0x04) this.fprView.setFloat32(fd * 8 + 4, Math.sqrt(v1), false); // SQRT.S
                else if (funct === 0x05) this.fprView.setFloat32(fd * 8 + 4, Math.abs(v1), false); // ABS.S
                else if (funct === 0x06) this.fprView.setFloat32(fd * 8 + 4, v1, false); // MOV.S
                else if (funct === 0x07) this.fprView.setFloat32(fd * 8 + 4, -v1, false); // NEG.S
                else if (funct === 0x0C) this.fprView.setInt32(fd * 8 + 4, Math.round(v1), false); // ROUND.W.S
                else if (funct === 0x0D) this.fprView.setInt32(fd * 8 + 4, Math.trunc(v1), false); // TRUNC.W.S
                else if (funct === 0x0E) this.fprView.setInt32(fd * 8 + 4, Math.ceil(v1), false);  // CEIL.W.S
                else if (funct === 0x0F) this.fprView.setInt32(fd * 8 + 4, Math.floor(v1), false); // FLOOR.W.S
                else if (funct === 0x21) this.fprView.setFloat64(fd * 8, v1, false); // CVT.D.S
                else if (funct === 0x24) this.fprView.setInt32(fd * 8 + 4, Math.trunc(v1), false); // CVT.W.S
                else if (funct === 0x25) this.fprView.setBigInt64(fd * 8, BigInt(Math.trunc(v1)), false); // CVT.L.S
                else if ((funct & 0x30) === 0x30) { // C.xx.S
                    let cond = false;
                    const nan = isNaN(v1) || isNaN(v2);
                    switch (funct & 0x0F) {
                        case 0x00: cond = false; break; // F
                        case 0x01: cond = nan; break; // UN
                        case 0x02: cond = !nan && (v1 === v2); break; // EQ
                        case 0x03: cond = nan || (v1 === v2); break; // UEQ
                        case 0x04: cond = !nan && (v1 < v2); break; // OLT
                        case 0x05: cond = nan || (v1 < v2); break; // ULT
                        case 0x06: cond = !nan && (v1 <= v2); break; // OLE
                        case 0x07: cond = nan || (v1 <= v2); break; // ULE
                        case 0x08: cond = false; break; // SF
                        case 0x09: cond = nan; break; // NGLE
                        case 0x0A: cond = !nan && (v1 === v2); break; // SEQ
                        case 0x0B: cond = nan || (v1 === v2); break; // NGL
                        case 0x0C: cond = !nan && (v1 < v2); break; // LT
                        case 0x0D: cond = nan || (v1 < v2); break; // NGE
                        case 0x0E: cond = !nan && (v1 <= v2); break; // LE
                        case 0x0F: cond = nan || (v1 <= v2); break; // NGT
                    }
                    if (cond) this.fcr31 |= 0x00800000; else this.fcr31 &= ~0x00800000;
                }
            } else if (fmt === 1) { // Double precision
                const v1 = this.fprView.getFloat64(fs * 8, false);
                const v2 = this.fprView.getFloat64(rt * 8, false);
                if (funct === 0x00) this.fprView.setFloat64(fd * 8, v1 + v2, false); // ADD.D
                else if (funct === 0x01) this.fprView.setFloat64(fd * 8, v1 - v2, false); // SUB.D
                else if (funct === 0x02) this.fprView.setFloat64(fd * 8, v1 * v2, false); // MUL.D
                else if (funct === 0x03) this.fprView.setFloat64(fd * 8, v1 / v2, false); // DIV.D
                else if (funct === 0x0C) this.fprView.setInt32(fd * 8 + 4, Math.round(v1), false); // ROUND.W.D
                else if (funct === 0x0D) this.fprView.setInt32(fd * 8 + 4, Math.trunc(v1), false); // TRUNC.W.D
                else if (funct === 0x0E) this.fprView.setInt32(fd * 8 + 4, Math.ceil(v1), false);  // CEIL.W.D
                else if (funct === 0x0F) this.fprView.setInt32(fd * 8 + 4, Math.floor(v1), false); // FLOOR.W.D
                else if (funct === 0x04) this.fprView.setFloat64(fd * 8, Math.sqrt(v1), false); // SQRT.D
                else if (funct === 0x05) this.fprView.setFloat64(fd * 8, Math.abs(v1), false); // ABS.D
                else if (funct === 0x06) this.fprView.setFloat64(fd * 8, v1, false); // MOV.D
                else if (funct === 0x07) this.fprView.setFloat64(fd * 8, -v1, false); // NEG.D
                else if (funct === 0x20) this.fprView.setFloat32(fd * 8 + 4, v1, false); // CVT.S.D
                else if (funct === 0x24) this.fprView.setInt32(fd * 8 + 4, Math.trunc(v1), false); // CVT.W.D
                else if (funct === 0x25) this.fprView.setBigInt64(fd * 8, BigInt(Math.trunc(v1)), false); // CVT.L.D
                else if ((funct & 0x30) === 0x30) { // C.xx.D
                    let cond = false;
                    const nan = isNaN(v1) || isNaN(v2);
                    switch (funct & 0x0F) {
                        case 0x00: cond = false; break; // F
                        case 0x01: cond = nan; break; // UN
                        case 0x02: cond = !nan && (v1 === v2); break; // EQ
                        case 0x03: cond = nan || (v1 === v2); break; // UEQ
                        case 0x04: cond = !nan && (v1 < v2); break; // OLT
                        case 0x05: cond = nan || (v1 < v2); break; // ULT
                        case 0x06: cond = !nan && (v1 <= v2); break; // OLE
                        case 0x07: cond = nan || (v1 <= v2); break; // ULE
                        case 0x08: cond = false; break; // SF
                        case 0x09: cond = nan; break; // NGLE
                        case 0x0A: cond = !nan && (v1 === v2); break; // SEQ
                        case 0x0B: cond = nan || (v1 === v2); break; // NGL
                        case 0x0C: cond = !nan && (v1 < v2); break; // LT
                        case 0x0D: cond = nan || (v1 < v2); break; // NGE
                        case 0x0E: cond = !nan && (v1 <= v2); break; // LE
                        case 0x0F: cond = nan || (v1 <= v2); break; // NGT
                    }
                    if (cond) this.fcr31 |= 0x00800000; else this.fcr31 &= ~0x00800000;
                }
            } else if (fmt === 4) { // Word
                const v1 = this.fprView.getInt32(fs * 8 + 4, false);
                if (funct === 0x20) this.fprView.setFloat32(fd * 8 + 4, v1, false); // CVT.S.W
                else if (funct === 0x21) this.fprView.setFloat64(fd * 8, v1, false); // CVT.D.W
            } else if (fmt === 5) { // Long
                const v1 = this.fprView.getBigInt64(fs * 8, false);
                if (funct === 0x20) this.fprView.setFloat32(fd * 8 + 4, Number(v1), false); // CVT.S.L
                else if (funct === 0x21) this.fprView.setFloat64(fd * 8, Number(v1), false); // CVT.D.L
            }
        }
    }
    opCOP0(instruction) {
        const sub = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const rd = (instruction >>> 11) & 0x1F;
        if (sub === 0x00) { // MFC0
            this.gpr[rt] = BigInt.asIntN(32, this.cp0Registers[rd]);
        } else if (sub === 0x04) { // MTC0
            this.cp0Registers[rd] = this.gpr[rt];
            if (rd === 11) { // Compare
                this.cp0Registers[13] &= ~0x00008000n; // Clear IP7
            }
        } else if (sub === 0x10) { // TLB / ERET
            const funct = instruction & 0x3F;
            if (funct === 0x18) { // ERET
                this.pc = this.cp0Registers[14]; // EPC
                this.cp0Registers[12] &= ~2n; // Clear EXL bit
                return true; // PC already updated
            }
        }
        return false;
    }

    decompressMIO0(input, offset) {
        const view = new DataView(input, offset);
        const magic = view.getUint32(0, false);
        if (magic !== 0x4D494F30) { // 'MIO0'
            console.error("MIO0: Invalid magic");
            return null;
        }

        const destSize = view.getUint32(4, false);
        const compOffset = view.getUint32(8, false);
        const uncompOffset = view.getUint32(12, false);

        const output = new Uint8Array(destSize);
        let outIdx = 0;
        let bitIdx = 0;
        let compIdx = compOffset;
        let uncompIdx = uncompOffset;
        let controlIdx = 16;

        while (outIdx < destSize) {
            const controlByte = view.getUint8(controlIdx + (bitIdx >> 3));
            const bit = (controlByte >> (7 - (bitIdx & 7))) & 1;
            bitIdx++;

            if (bit) {
                if (uncompIdx < view.byteLength) {
                    output[outIdx++] = view.getUint8(uncompIdx++);
                }
            } else {
                if (compIdx + 1 < view.byteLength) {
                    const pair = view.getUint16(compIdx, false);
                    compIdx += 2;
                    const lookbackLen = (pair >> 12) + 3;
                    const lookbackDist = (pair & 0xFFF) + 1;
                    let lookbackIdx = outIdx - lookbackDist;
                    for (let i = 0; i < lookbackLen; i++) {
                        if (outIdx < destSize) {
                            output[outIdx] = (lookbackIdx >= 0) ? output[lookbackIdx] : 0;
                            outIdx++;
                            lookbackIdx++;
                        }
                    }
                }
            }
            if (bitIdx === 8 * (compOffset - 16)) break; // Safety
        }
        return output;
    }

    raiseException(code, pc, isDelaySlot) {
        this.cp0Registers[13] = (BigInt(code) << 2n); // Cause
        if (isDelaySlot) {
            this.cp0Registers[13] |= 0x80000000n; // BD bit
            this.cp0Registers[14] = pc - 4n; // EPC
        } else {
            this.cp0Registers[14] = pc; // EPC
        }
        this.cp0Registers[12] |= 2n; // Set EXL bit
        this.pc = 0x80000180n; // General exception vector
        this.exceptionRaised = true;
        if (code !== 0) { // Only log non-interrupt exceptions to avoid spam
            const instruction = this.mmu.read32(Number(pc));
            console.warn(`Exception ${code} at PC 0x${BigInt.asUintN(32, pc).toString(16)} (Instr: 0x${instruction.toString(16).padStart(8, '0')})`);
        }
        return null;
    }
}
