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
        this.warnedOpcodes = new Set();
        this.warnedSpecial = new Set();
        this.warnedExceptions = new Set();
    }

    run() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log("CPU is running...");

        if (!this.isHleBootDone) {
            this.performHleBoot();
        }

        const runLoop = () => {
            if (!this.isRunning) return;
            const startTime = performance.now();
            let count = 0;
            // Execute as many as possible within 16ms
            // Increased budget for faster boot in SM64
            while (count < 10000000 && (performance.now() - startTime < 16)) {
                for (let i = 0; i < 10000; i++) {
                    this.step();
                }
                count += 10000;
            }
            if (this.instructionCount % 100000 === 0) {
                const instr = this.mmu.read32(Number(this.pc & 0xFFFFFFFFn));
                console.log(`CPU PC: 0x${(this.pc & 0xFFFFFFFFn).toString(16)} Instr: 0x${instr.toString(16).padStart(8, '0')} (Count: ${this.instructionCount})`);
            }
            setTimeout(runLoop, 0);
        };
        runLoop();
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
        const segmentSize = Math.min(romView.length - 0x1000, rdramView.length - ramOffset);
        if (segmentSize > 0) {
            rdramView.set(romView.subarray(0x1000, 0x1000 + segmentSize), ramOffset);
            console.log(`HLE Boot: Loaded ${segmentSize} bytes to RAM 0x${ramOffset.toString(16)}`);
        }

        console.log(`HLE Boot: Entry Point=0x${entryPoint.toString(16)}, RAM Offset=0x${ramOffset.toString(16)}`);

        // Initialize registers as IPL3 would for CIC-6102
        this.gpr[29] = BigInt.asIntN(32, 0x80370000n); // sp
        this.gpr[31] = 0n; // ra: standard is 0
        this.gpr[16] = BigInt.asIntN(32, BigInt(romDataView.getUint32(0, false))); // s0: ROM Info
        this.gpr[17] = 0x00000001n; // s1: CIC type (1 for 6102)
        this.gpr[18] = BigInt.asIntN(32, 0x5D5886F0n); // s2: Checksum part 1
        this.gpr[11] = BigInt.asIntN(32, 0x27299D20n); // t3: Checksum part 2

        // Initial Status: CU0=1, CU1=1, BEV=0, EXL=0, IE=0
        this.cp0Registers[12] = 0x30000000n;

        // Set up basic exception vector pointers if necessary
        // Most games will overwrite these anyway.

        // Initialize PIF RAM for CIC-6102
        this.mmu.pifRam[0x24] = 0x00;
        this.mmu.pifRam[0x25] = 0x00;
        this.mmu.pifRam[0x26] = 0x3F;
        this.mmu.pifRam[0x27] = 0x3F;

        this.isHleBootDone = true;
    }

    stop() {
        this.isRunning = false;
        console.log("CPU stopped.");
    }

    step() {
        this.instructionCount++;

        // Instruction alignment check
        if (this.pc & 3n) {
            console.error(`AdEL exception: misaligned PC 0x${this.pc.toString(16)}`);
            this.raiseException(4, this.pc, false);
            return;
        }

        // Count register increments at half CPU frequency
        if ((this.instructionCount & 1) === 0) {
            this.cp0Registers[9] = (this.cp0Registers[9] + 1n) & 0xFFFFFFFFn;
            if (this.cp0Registers[9] === this.cp0Registers[11] && this.cp0Registers[11] !== 0n) {
                this.cp0Registers[13] |= 0x00008000n; // IP7 (Timer)
            }
        }

        // Check for interrupts periodically
        if ((this.instructionCount & 0x3F) === 0) {
            this.mmu.checkInternalEvents();

            // Update Cause IP2 from MI_INTR_REG & MI_INTR_MASK_REG
            const miIntr = this.mmu.miRegisters[2];
            const miMask = this.mmu.miRegisters[3];
            if (miIntr & miMask) {
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
        }

        const currentPc = this.pc;
        const instruction = this.mmu.read32(Number(currentPc));

        this.exceptionRaised = false;
        const nextPc = this.decodeAndExecute(instruction, currentPc, false);
        if (this.exceptionRaised || nextPc === null) return;

        if (this.branchTaken) {
            const delaySlotInstruction = this.mmu.read32(Number(currentPc + 4n));
            this.decodeAndExecute(delaySlotInstruction, currentPc + 4n, true);
            if (this.exceptionRaised) return;

            this.pc = BigInt.asIntN(32, this.branchTarget);
            this.branchTaken = false;
        } else {
            this.pc = BigInt.asIntN(32, nextPc);
        }

        this.gpr[0] = 0n;
    }

    decodeAndExecute(instruction, currentPc, isDelaySlot) {
        const opcode = (instruction >>> 26) & 0x3F;

        switch (opcode) {
            case 0x00: return this.opSPECIAL(instruction, currentPc, isDelaySlot);
            case 0x01: return this.opREGIMM(instruction, currentPc, isDelaySlot);
            case 0x02: return this.opJ(instruction, currentPc, isDelaySlot);
            case 0x03: return this.opJAL(instruction, currentPc, isDelaySlot);
            case 0x04: return this.opBEQ(instruction, currentPc, isDelaySlot);
            case 0x05: return this.opBNE(instruction, currentPc, isDelaySlot);
            case 0x06: return this.opBLEZ(instruction, currentPc, isDelaySlot);
            case 0x07: return this.opBGTZ(instruction, currentPc, isDelaySlot);
            case 0x14: return this.opBEQL(instruction, currentPc, isDelaySlot);
            case 0x15: return this.opBNEL(instruction, currentPc, isDelaySlot);
            case 0x16: return this.opBLEZL(instruction, currentPc, isDelaySlot);
            case 0x17: return this.opBGTZL(instruction, currentPc, isDelaySlot);
            case 0x12: return this.opCOP2(instruction, currentPc, isDelaySlot);
            case 0x1C: return this.opSPECIAL2(instruction, currentPc, isDelaySlot);
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
            case 0x11: { const pc = this.opCOP1(instruction, currentPc, isDelaySlot); if (pc !== undefined) return pc; break; }
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
                if (instruction !== 0 && !this.warnedOpcodes.has(opcode)) {
                    console.warn(`Unknown opcode: 0x${opcode.toString(16).padStart(2, '0')} (Instr: 0x${instruction.toString(16).padStart(8, '0')}) at PC 0x${BigInt.asUintN(32, currentPc).toString(16).padStart(8, '0')}`);
                    this.warnedOpcodes.add(opcode);
                }
                return this.raiseException(10, currentPc, isDelaySlot);
        }
        return currentPc + 4n;
    }
    opBEQL(instruction, currentPc, isDelaySlot) {
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
    opBNEL(instruction, currentPc, isDelaySlot) {
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
    opBLEZL(instruction, currentPc, isDelaySlot) {
        const rs = (instruction >>> 21) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] <= 0n) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
            return currentPc + 4n;
        }
        return currentPc + 8n;
    }
    opBGTZL(instruction, currentPc, isDelaySlot) {
        const rs = (instruction >>> 21) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] > 0n) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
            return currentPc + 4n;
        }
        return currentPc + 8n;
    }

    opCOP2(instruction, currentPc, isDelaySlot) {
        return currentPc + 4n;
    }

    opSPECIAL2(instruction, currentPc, isDelaySlot) {
        const funct = instruction & 0x3F;
        if (funct === 0x02) { // MUL
            const rs = (instruction >>> 21) & 0x1F;
            const rt = (instruction >>> 16) & 0x1F;
            const rd = (instruction >>> 11) & 0x1F;
            this.gpr[rd] = BigInt.asIntN(32, BigInt.asIntN(32, this.gpr[rs]) * BigInt.asIntN(32, this.gpr[rt]));
        }
        return currentPc + 4n;
    }

    opSPECIAL(instruction, currentPc, isDelaySlot) {
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
            case 0x0C: return this.raiseTrap(currentPc, isDelaySlot, 8); // SYSCALL
            case 0x0D: return this.raiseTrap(currentPc, isDelaySlot, 9); // BREAK
            case 0x0E: break; // Unknown NOP used in SM64 PAL
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
            case 0x30: if (this.gpr[rs] >= this.gpr[rt]) return this.raiseTrap(currentPc, isDelaySlot, 13); break; // TGE
            case 0x31: if (BigInt.asUintN(64, this.gpr[rs]) >= BigInt.asUintN(64, this.gpr[rt])) return this.raiseTrap(currentPc, isDelaySlot, 13); break; // TGEU
            case 0x32: if (this.gpr[rs] < this.gpr[rt]) return this.raiseTrap(currentPc, isDelaySlot, 13); break; // TLT
            case 0x33: if (BigInt.asUintN(64, this.gpr[rs]) < BigInt.asUintN(64, this.gpr[rt])) return this.raiseTrap(currentPc, isDelaySlot, 13); break; // TLTU
            case 0x34: if (this.gpr[rs] === this.gpr[rt]) return this.raiseTrap(currentPc, isDelaySlot, 13); break; // TEQ
            case 0x36: if (this.gpr[rs] !== this.gpr[rt]) return this.raiseTrap(currentPc, isDelaySlot, 13); break; // TNE
            case 0x38: this.gpr[rd] = BigInt.asIntN(64, this.gpr[rt] << BigInt(sa)); break; // DSLL
            case 0x3A: this.gpr[rd] = BigInt.asIntN(64, BigInt.asUintN(64, this.gpr[rt]) >> BigInt(sa)); break; // DSRL
            case 0x3B: this.gpr[rd] = BigInt.asIntN(64, BigInt.asIntN(64, this.gpr[rt]) >> BigInt(sa)); break; // DSRA
            case 0x3C: this.gpr[rd] = BigInt.asIntN(64, this.gpr[rt] << (BigInt(sa) + 32n)); break; // DSLL32
            case 0x3E: this.gpr[rd] = BigInt.asIntN(64, BigInt.asUintN(64, this.gpr[rt]) >> (BigInt(sa) + 32n)); break; // DSRL32
            case 0x3F: this.gpr[rd] = BigInt.asIntN(64, BigInt.asIntN(64, this.gpr[rt]) >> (BigInt(sa) + 32n)); break; // DSRA32
            default:
                if (instruction !== 0 && !this.warnedSpecial.has(funct)) {
                    console.warn(`Unknown SPECIAL funct: 0x${funct.toString(16).padStart(2, '0')} (Instr: 0x${instruction.toString(16).padStart(8, '0')}) at PC 0x${BigInt.asUintN(32, currentPc).toString(16).padStart(8, '0')}`);
                    this.warnedSpecial.add(funct);
                }
                return this.raiseException(10, currentPc, isDelaySlot);
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
    opBEQ(instruction, currentPc, isDelaySlot) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] === this.gpr[rt]) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
        }
        return currentPc + 4n;
    }
    opBNE(instruction, currentPc, isDelaySlot) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] !== this.gpr[rt]) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
        }
        return currentPc + 4n;
    }
    opBLEZ(instruction, currentPc, isDelaySlot) {
        const rs = (instruction >>> 21) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] <= 0n) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
        }
        return currentPc + 4n;
    }
    opBGTZ(instruction, currentPc, isDelaySlot) {
        const rs = (instruction >>> 21) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        if (this.gpr[rs] > 0n) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
        }
        return currentPc + 4n;
    }
    opJ(instruction, currentPc, isDelaySlot) {
        const target = BigInt(instruction & 0x03FFFFFF);
        this.branchTarget = BigInt.asIntN(32, (currentPc & 0xF0000000n) | (target << 2n));
        this.branchTaken = true;
        return currentPc + 4n;
    }
    opJAL(instruction, currentPc, isDelaySlot) {
        this.gpr[31] = BigInt.asIntN(32, currentPc + 8n);
        return this.opJ(instruction, currentPc);
    }
    opREGIMM(instruction, currentPc, isDelaySlot) {
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

            // Traps
            case 0x08: if (this.gpr[rs] >= imm) return this.raiseTrap(currentPc, isDelaySlot, 13); break; // TGEI
            case 0x09: if (BigInt.asUintN(64, this.gpr[rs]) >= BigInt.asUintN(64, imm)) return this.raiseTrap(currentPc, isDelaySlot, 13); break; // TGEIU
            case 0x0A: if (this.gpr[rs] < imm) return this.raiseTrap(currentPc, isDelaySlot, 13); break; // TLTI
            case 0x0B: if (BigInt.asUintN(64, this.gpr[rs]) < BigInt.asUintN(64, imm)) return this.raiseTrap(currentPc, isDelaySlot, 13); break; // TLTIU
            case 0x0C: if (this.gpr[rs] === imm) return this.raiseTrap(currentPc, isDelaySlot, 13); break; // TEQI
            case 0x0E: if (this.gpr[rs] !== imm) return this.raiseTrap(currentPc, isDelaySlot, 13); break; // TNEI
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
        const address = Number((this.gpr[base] + offset) & 0xFFFFFFFFn);
        const alignedAddr = address & ~3;
        const byteOffset = address & 3;
        const word = this.mmu.read32(alignedAddr);
        const rtVal = Number(this.gpr[rt] & 0xFFFFFFFFn);
        let result;
        if (byteOffset === 0) result = word;
        else if (byteOffset === 1) result = (rtVal & 0x000000FF) | (word << 8);
        else if (byteOffset === 2) result = (rtVal & 0x0000FFFF) | (word << 16);
        else result = (rtVal & 0x00FFFFFF) | (word << 24);
        this.gpr[rt] = BigInt.asIntN(32, BigInt(result | 0));
    }
    opLWR(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const address = Number((this.gpr[base] + offset) & 0xFFFFFFFFn);
        const alignedAddr = address & ~3;
        const byteOffset = address & 3;
        const word = this.mmu.read32(alignedAddr);
        const rtVal = Number(this.gpr[rt] & 0xFFFFFFFFn);
        let result;
        if (byteOffset === 0) result = (rtVal & 0xFFFFFF00) | (word >>> 24);
        else if (byteOffset === 1) result = (rtVal & 0xFFFF0000) | (word >>> 16);
        else if (byteOffset === 2) result = (rtVal & 0xFF000000) | (word >>> 8);
        else result = word;
        this.gpr[rt] = BigInt.asIntN(32, BigInt(result | 0));
    }
    opSWL(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const address = Number((this.gpr[base] + offset) & 0xFFFFFFFFn);
        const alignedAddr = address & ~3;
        const byteOffset = address & 3;
        const word = this.mmu.read32(alignedAddr);
        const rtVal = Number(this.gpr[rt] & 0xFFFFFFFFn);
        let result;
        if (byteOffset === 0) result = rtVal;
        else if (byteOffset === 1) result = (word & 0xFF000000) | (rtVal >>> 8);
        else if (byteOffset === 2) result = (word & 0xFFFF0000) | (rtVal >>> 16);
        else result = (word & 0xFFFFFF00) | (rtVal >>> 24);
        this.mmu.write32(alignedAddr, result >>> 0);
    }
    opSWR(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const address = Number((this.gpr[base] + offset) & 0xFFFFFFFFn);
        const alignedAddr = address & ~3;
        const byteOffset = address & 3;
        const word = this.mmu.read32(alignedAddr);
        const rtVal = Number(this.gpr[rt] & 0xFFFFFFFFn);
        let result;
        if (byteOffset === 0) result = (word & 0x00FFFFFF) | (rtVal << 24);
        else if (byteOffset === 1) result = (word & 0x0000FFFF) | (rtVal << 16);
        else if (byteOffset === 2) result = (word & 0x000000FF) | (rtVal << 8);
        else result = rtVal;
        this.mmu.write32(alignedAddr, result >>> 0);
    }
    opLDL(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const address = Number((this.gpr[base] + offset) & 0xFFFFFFFFFFFFFFFFn);
        const alignedAddr = address & ~7;
        const byteOffset = address & 7;
        const dword = this.mmu.read64(alignedAddr);
        const rtVal = BigInt.asUintN(64, this.gpr[rt]);
        let result;
        if (byteOffset === 0) result = dword;
        else result = (rtVal & ((1n << BigInt(byteOffset * 8)) - 1n)) | (dword << BigInt(byteOffset * 8));
        this.gpr[rt] = BigInt.asIntN(64, result);
    }
    opLDR(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const address = Number((this.gpr[base] + offset) & 0xFFFFFFFFFFFFFFFFn);
        const alignedAddr = address & ~7;
        const byteOffset = address & 7;
        const dword = this.mmu.read64(alignedAddr);
        const rtVal = BigInt.asUintN(64, this.gpr[rt]);
        let result;
        if (byteOffset === 7) result = dword;
        else result = (rtVal & ~((1n << BigInt((byteOffset + 1) * 8)) - 1n)) | (dword >> BigInt((7 - byteOffset) * 8));
        this.gpr[rt] = BigInt.asIntN(64, result);
    }
    opSDL(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const address = Number((this.gpr[base] + offset) & 0xFFFFFFFFFFFFFFFFn);
        const alignedAddr = address & ~7;
        const byteOffset = address & 7;
        const dword = this.mmu.read64(alignedAddr);
        const rtVal = BigInt.asUintN(64, this.gpr[rt]);
        let result;
        if (byteOffset === 0) result = rtVal;
        else result = (dword & ~((1n << BigInt((8 - byteOffset) * 8)) - 1n)) | (rtVal >> BigInt(byteOffset * 8));
        this.mmu.write64(alignedAddr, result);
    }
    opSDR(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const address = Number((this.gpr[base] + offset) & 0xFFFFFFFFFFFFFFFFn);
        const alignedAddr = address & ~7;
        const byteOffset = address & 7;
        const dword = this.mmu.read64(alignedAddr);
        const rtVal = BigInt.asUintN(64, this.gpr[rt]);
        let result;
        if (byteOffset === 7) result = rtVal;
        else result = (dword & ((1n << BigInt((byteOffset + 1) * 8)) - 1n)) | (rtVal << BigInt((7 - byteOffset) * 8));
        this.mmu.write64(alignedAddr, result);
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
    opCOP1(instruction, currentPc, isDelaySlot) {
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
        } else if (sub === 0x01) { // DMFC0
            this.gpr[rt] = this.cp0Registers[rd];
        } else if (sub === 0x04) { // MTC0
            this.cp0Registers[rd] = BigInt.asIntN(32, this.gpr[rt]);
            if (rd === 11) { // Compare
                this.cp0Registers[13] &= ~0x00008000n; // Clear IP7
            }
        } else if (sub === 0x05) { // DMTC0
            this.cp0Registers[rd] = this.gpr[rt];
            if (rd === 11) { // Compare
                this.cp0Registers[13] &= ~0x00008000n; // Clear IP7
            }
        } else if (sub >= 0x10) { // TLB / ERET
            const funct = instruction & 0x3F;
            if (funct === 0x18) { // ERET
                if (this.cp0Registers[12] & 4n) { // ERL
                    this.pc = this.cp0Registers[30]; // ErrorEPC
                    this.cp0Registers[12] &= ~4n;
                } else {
                    this.pc = this.cp0Registers[14]; // EPC
                    this.cp0Registers[12] &= ~2n; // EXL
                }
                return true; // PC already updated
            }
            return false; // Other TLB ops are NOPs for now
        }
        return false;
    }

    decompressMIO0(mmu, offset) {
        // MIO0 decompression supporting both RAM and ROM (Cartridge) source
        const read8 = (addr) => {
            // Handle cartridge mirrors common in SM64 PAL (0x01xxxxxx)
            if (addr < 0x08000000 && addr > 0x007FFFFF) {
                return mmu.memory.readRom8(addr & 0x0FFFFFFF);
            }
            return mmu.read8(addr);
        };
        const read16 = (addr) => {
            if (addr < 0x08000000 && addr > 0x007FFFFF) {
                return mmu.memory.readRom16(addr & 0x0FFFFFFF);
            }
            return mmu.read16(addr);
        };
        const read32 = (addr) => {
            if (addr < 0x08000000 && addr > 0x007FFFFF) {
                return mmu.memory.readRom32(addr & 0x0FFFFFFF);
            }
            return mmu.read32(addr);
        };

        const magic = read32(offset);
        if (magic !== 0x4D494F30) { // 'MIO0'
            console.error(`MIO0: Invalid magic 0x${magic.toString(16)} at 0x${offset.toString(16)}`);
            return null;
        }

        const destSize = read32(offset + 4);
        const compOffset = read32(offset + 8);
        const uncompOffset = read32(offset + 12);

        const output = new Uint8Array(destSize);
        let outIdx = 0;
        let bitIdx = 0;
        let compIdx = offset + compOffset;
        let uncompIdx = offset + uncompOffset;
        let controlIdx = offset + 16;

        while (outIdx < destSize) {
            const controlByte = read8(controlIdx + (bitIdx >> 3));
            const bit = (controlByte >> (7 - (bitIdx & 7))) & 1;
            bitIdx++;

            if (bit) {
                output[outIdx++] = read8(uncompIdx++);
            } else {
                const pair = read16(compIdx);
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
            // Safety break to prevent infinite loops if data is corrupt
            if (bitIdx > 1000000) break;
        }
        return output;
    }


    raiseTrap(pc, isDelaySlot, code) {
        const instruction = this.mmu.read32(Number(pc));
        const trapCode = (instruction >>> 6) & 0xFFFFF; // 20 bits for SYSCALL/BREAK, 10 for traps
        console.log(`TRAP/SYSCALL/BREAK: code=${code} trapCode=${trapCode} at PC=0x${pc.toString(16)}`);

        // Print registers for debugging
        let regStr = "";
        for (let i = 0; i < 32; i++) {
            regStr += `r${i}=0x${this.gpr[i].toString(16)} `;
            if ((i + 1) % 4 === 0) regStr += "\n";
        }
        console.log("Registers:\n" + regStr);

        return this.raiseException(code, pc, isDelaySlot);
    }

    raiseException(code, pc, isDelaySlot) {
        const status = this.cp0Registers[12];
        const bev = (status >> 22n) & 1n;
        const vector = bev ? 0xBFC00380n : 0x80000180n;

        // Cause.ExcCode is updated even if EXL is 1
        this.cp0Registers[13] = (this.cp0Registers[13] & ~0x7Cn) | (BigInt(code) << 2n);

        if (!(status & 2n)) { // EXL bit
            if (isDelaySlot) {
                this.cp0Registers[13] |= 0x80000000n; // BD bit
                this.cp0Registers[14] = pc - 4n; // EPC
            } else {
                this.cp0Registers[13] &= ~0x80000000n; // Clear BD bit
                this.cp0Registers[14] = pc; // EPC
            }
            this.cp0Registers[12] |= 2n; // Set EXL bit
        }
        this.pc = vector;
        this.exceptionRaised = true;
        if (code !== 0) {
            const instruction = this.mmu.read32(Number(pc));
            console.warn(`Exception ${code} at PC 0x${BigInt.asUintN(32, pc).toString(16)} (Instr: 0x${instruction.toString(16).padStart(8, '0')}) EXL=${status & 2n}`);
        }
        return null;
    }
}
