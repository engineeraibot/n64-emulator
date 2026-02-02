class CPU {
    constructor(mmu, rcp) {
        console.log("CPU Initialized");
        this.mmu = mmu;
        this.rcp = rcp;
        this.reset();
    }

    reset() {
        console.log("CPU Reset");
        this.gpr = new BigInt64Array(32);
        this.pc = 0xBFC00000n;
        this.hi = 0n;
        this.lo = 0n;
        this.gpr[0] = 0n;
        this.cp0Registers = new BigInt64Array(32);
        this.isRunning = false;
        this.branchTaken = false;
        this.branchTarget = 0n;
        this.isHleBootDone = false;
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
            for (let i = 0; i < 10000; i++) {
                this.step();
            }
            requestAnimationFrame(runFrame);
        };
        requestAnimationFrame(runFrame);
    }

    performHleBoot() {
        console.log("Performing HLE Boot...");
        const memory = this.mmu.memory;
        if (!memory.rom) {
            console.error("HLE Boot: No ROM loaded!");
            return;
        }

        const entryPoint = memory.readRom32(0x08);
        console.log(`HLE Boot: Entry Point = 0x${entryPoint.toString(16)}`);
        this.pc = BigInt(entryPoint) & 0xFFFFFFFFn;

        this.gpr[29] = 0x80370000n; // SP
        this.gpr[31] = 0x80000000n; // RA

        const bootSize = Math.min(1024 * 1024, memory.rom.byteLength - 0x1000);
        const romView = new Uint8Array(memory.rom, 0x1000, bootSize);
        const rdramView = new Uint8Array(memory.rdram, 0x400, bootSize);
        rdramView.set(romView);

        console.log(`HLE Boot: Copied ${bootSize} bytes to RDRAM @ 0x400`);
        this.isHleBootDone = true;
    }

    stop() {
        this.isRunning = false;
        console.log("CPU stopped.");
    }

    step() {
        this.cp0Registers[9] = (this.cp0Registers[9] + 1n) & 0xFFFFFFFFn; // Count

        const currentPc = this.pc;
        const instruction = this.mmu.read32(Number(currentPc));

        const nextPc = this.decodeAndExecute(instruction, currentPc);
        if (nextPc === null) return; // PC already updated (e.g., ERET)

        if (this.branchTaken) {
            const delaySlotInstruction = this.mmu.read32(Number(currentPc + 4n));
            this.decodeAndExecute(delaySlotInstruction, currentPc + 4n);
            this.pc = this.branchTarget;
            this.branchTaken = false;
        } else {
            this.pc = nextPc;
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
            case 0x20: this.opLB(instruction); break;
            case 0x21: this.opLH(instruction); break;
            case 0x23: this.opLW(instruction); break;
            case 0x24: this.opLBU(instruction); break;
            case 0x25: this.opLHU(instruction); break;
            case 0x27: this.opLWU(instruction); break;
            case 0x28: this.opSB(instruction); break;
            case 0x29: this.opSH(instruction); break;
            case 0x2B: this.opSW(instruction); break;
            case 0x37: this.opLD(instruction); break;
            case 0x3F: this.opSD(instruction); break;
            default:
                console.warn(`Unknown opcode: 0x${opcode.toString(16)} at PC 0x${currentPc.toString(16)}`);
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

    opSPECIAL(instruction, currentPc) {
        const rs = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const rd = (instruction >>> 11) & 0x1F;
        const sa = (instruction >>> 6) & 0x1F;
        const funct = instruction & 0x3F;

        switch (funct) {
            case 0x00: this.gpr[rd] = BigInt.asIntN(32, (this.gpr[rt] & 0xFFFFFFFFn) << BigInt(sa)); break;
            case 0x02: this.gpr[rd] = BigInt.asIntN(32, (BigInt.asUintN(32, this.gpr[rt]) >> BigInt(sa))); break;
            case 0x03: this.gpr[rd] = BigInt.asIntN(32, (BigInt.asIntN(32, this.gpr[rt]) >> BigInt(sa))); break;
            case 0x04: this.gpr[rd] = BigInt.asIntN(32, (this.gpr[rt] & 0xFFFFFFFFn) << (this.gpr[rs] & 0x1Fn)); break;
            case 0x06: this.gpr[rd] = BigInt.asIntN(32, (BigInt.asUintN(32, this.gpr[rt]) >> (this.gpr[rs] & 0x1Fn))); break;
            case 0x07: this.gpr[rd] = BigInt.asIntN(32, (BigInt.asIntN(32, this.gpr[rt]) >> (this.gpr[rs] & 0x1Fn))); break;
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
            case 0x38: this.gpr[rd] = BigInt.asIntN(64, this.gpr[rt] << BigInt(sa)); break; // DSLL
            case 0x3A: this.gpr[rd] = BigInt.asIntN(64, BigInt.asUintN(64, this.gpr[rt]) >> BigInt(sa)); break; // DSRL
            case 0x3B: this.gpr[rd] = BigInt.asIntN(64, BigInt.asIntN(64, this.gpr[rt]) >> BigInt(sa)); break; // DSRA
            case 0x3C: this.gpr[rd] = BigInt.asIntN(64, this.gpr[rt] << (BigInt(sa) + 32n)); break; // DSLL32
            case 0x3E: this.gpr[rd] = BigInt.asIntN(64, BigInt.asUintN(64, this.gpr[rt]) >> (BigInt(sa) + 32n)); break; // DSRL32
            case 0x3F: this.gpr[rd] = BigInt.asIntN(64, BigInt.asIntN(64, this.gpr[rt]) >> (BigInt(sa) + 32n)); break; // DSRA32
            default:
                console.warn(`Unknown SPECIAL funct: 0x${funct.toString(16)}`);
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
        switch (sub) {
            case 0x00: if (this.gpr[rs] < 0n) taken = true; break;
            case 0x01: if (this.gpr[rs] >= 0n) taken = true; break;
        }
        if (taken) {
            this.branchTarget = currentPc + 4n + (imm << 2n);
            this.branchTaken = true;
        }
        return currentPc + 4n;
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
    opSD(instruction) {
        const base = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const offset = BigInt.asIntN(16, BigInt(instruction & 0xFFFF));
        const addr = this.gpr[base] + offset;
        this.mmu.write64(Number(addr), this.gpr[rt]);
    }
    opCOP0(instruction) {
        const sub = (instruction >>> 21) & 0x1F;
        const rt = (instruction >>> 16) & 0x1F;
        const rd = (instruction >>> 11) & 0x1F;
        if (sub === 0x00) { // MFC0
            this.gpr[rt] = BigInt.asIntN(32, this.cp0Registers[rd]);
        } else if (sub === 0x04) { // MTC0
            this.cp0Registers[rd] = this.gpr[rt];
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
        console.warn(`Exception ${code} at PC 0x${pc.toString(16)}`);
    }
}
