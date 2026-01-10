class CPU {
    constructor(mmu, rcp) {
        console.log("CPU Initialized");
        this.mmu = mmu;
        this.rcp = rcp;
        this.reset();
    }

    reset() {
        console.log("CPU Reset");
        // General Purpose Registers (GPRs) - 32 64-bit registers
        this.gpr = new BigInt64Array(32);

        // Program Counter (PC) - 64-bit
        // N64 boot address is 0xBFC00000
        this.pc = 0xBFC00000n;

        // Special registers for multiplication and division results
        this.hi = 0n;
        this.lo = 0n;

        // MIPS architecture specifies that register 0 is always zero
        this.gpr[0] = 0n;

        this.isRunning = false;
    }

    run() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log("CPU is running...");

        const runFrame = () => {
            if (!this.isRunning) return;

            // Execute a batch of instructions. The number is chosen to balance
            // performance and responsiveness.
            for (let i = 0; i < 1000; i++) {
                this.step();
            }

            requestAnimationFrame(runFrame);
        };

        requestAnimationFrame(runFrame);
    }

    stop() {
        this.isRunning = false;
        console.log("CPU stopped.");
    }

    step() {
        const currentPc = this.pc;
        // Fetch the instruction from the address in the Program Counter
        console.log(`Fetching instruction from 0x${currentPc.toString(16)}`);
        const instruction = this.mmu.read32(Number(currentPc));

        // Default to the next instruction. Jumps and branches will override this.
        this.pc += 4n;

        // Decode and Execute the instruction
        this.decodeAndExecute(instruction, currentPc);

        this.logState();
    }

    decodeAndExecute(instruction, currentPc) {
        const opcode = (instruction >> 26) & 0x3F;

        switch (opcode) {
            case 0b010000: // COP0
                this.opCOP0(instruction);
                break;
            case 0b000010: // J
                this.opJ(instruction, currentPc);
                break;
            case 0b000011: // JAL
                this.opJAL(instruction, currentPc);
                break;
            case 0b000100: // BEQ
                this.opBEQ(instruction, currentPc);
                break;
            case 0b000101: // BNE
                this.opBNE(instruction, currentPc);
                break;
            case 0b001101: // ORI
                this.opORI(instruction);
                break;
            case 0b001111: // LUI
                this.opLUI(instruction);
                break;
            case 0b001001: // ADDIU
                this.opADDIU(instruction);
                break;
            case 0b100011: // LW
                this.opLW(instruction);
                break;
            case 0b101011: // SW
                this.opSW(instruction);
                break;
            default:
                console.error(`Unknown opcode: 0b${opcode.toString(2)} at PC 0x${currentPc.toString(16)}`);
        }
    }

    opADDIU(instruction) {
        const rs = (instruction >> 21) & 0x1F;
        const rt = (instruction >> 16) & 0x1F;
        const immediate = instruction & 0xFFFF;

        // Sign-extend the 16-bit immediate value to 64 bits
        const imm64 = BigInt.asIntN(16, BigInt(immediate));

        const result = this.gpr[rs] + imm64;

        // In MIPS, register 0 is always 0.
        if (rt !== 0) {
            this.gpr[rt] = result;
        }

        console.log(`ADDIU: gpr[${rt}] = gpr[${rs}] + ${immediate}`);
    }

    opBEQ(instruction, currentPc) {
        const rs = (instruction >> 21) & 0x1F;
        const rt = (instruction >> 16) & 0x1F;
        const offset = instruction & 0xFFFF;

        if (this.gpr[rs] === this.gpr[rt]) {
            const branchAddress = BigInt.asIntN(18, BigInt(offset << 2));
            this.pc = (currentPc + 4n) + branchAddress;
            console.log(`BEQ: Branching to 0x${this.pc.toString(16)}`);
        }
    }

    opBNE(instruction, currentPc) {
        const rs = (instruction >> 21) & 0x1F;
        const rt = (instruction >> 16) & 0x1F;
        const offset = instruction & 0xFFFF;

        if (this.gpr[rs] !== this.gpr[rt]) {
            const branchAddress = BigInt.asIntN(18, BigInt(offset << 2));
            this.pc = (currentPc + 4n) + branchAddress;
            console.log(`BNE: Branching to 0x${this.pc.toString(16)}`);
        }
    }

    opLW(instruction) {
        const base = (instruction >> 21) & 0x1F;
        const rt = (instruction >> 16) & 0x1F;
        const offset = instruction & 0xFFFF;

        const addr = this.gpr[base] + BigInt.asIntN(16, BigInt(offset));
        const value = this.mmu.read32(Number(addr));

        if (rt !== 0) {
            this.gpr[rt] = BigInt.asIntN(32, BigInt(value));
        }

        console.log(`LW: gpr[${rt}] = memory[0x${addr.toString(16)}]`);
    }

    opSW(instruction) {
        const base = (instruction >> 21) & 0x1F;
        const rt = (instruction >> 16) & 0x1F;
        const offset = instruction & 0xFFFF;

        const addr = this.gpr[base] + BigInt.asIntN(16, BigInt(offset));
        const value = Number(this.gpr[rt] & 0xFFFFFFFFn);

        this.mmu.write32(Number(addr), value);

        console.log(`SW: memory[0x${addr.toString(16)}] = gpr[${rt}]`);
    }

    opLUI(instruction) {
        const rt = (instruction >> 16) & 0x1F;
        const immediate = instruction & 0xFFFF;

        if (rt !== 0) {
            // LUI places the immediate in the upper 16 bits of the register
            this.gpr[rt] = BigInt.asIntN(32, BigInt(immediate << 16));
        }
        console.log(`LUI: gpr[${rt}] = 0x${(immediate << 16).toString(16)}`);
    }

    opORI(instruction) {
        const rs = (instruction >> 21) & 0x1F;
        const rt = (instruction >> 16) & 0x1F;
        const immediate = instruction & 0xFFFF;

        if (rt !== 0) {
            this.gpr[rt] = this.gpr[rs] | BigInt(immediate);
        }
        console.log(`ORI: gpr[${rt}] = gpr[${rs}] | 0x${immediate.toString(16)}`);
    }

    opJ(instruction, currentPc) {
        const target = instruction & 0x03FFFFFF;
        this.pc = (currentPc & 0xF0000000n) | BigInt(target << 2);
        console.log(`J: Jumping to 0x${this.pc.toString(16)}`);
    }

    opJAL(instruction, currentPc) {
        // Store the return address (the instruction after the delay slot)
        this.gpr[31] = currentPc + 8n;

        const target = instruction & 0x03FFFFFF;
        this.pc = (currentPc & 0xF0000000n) | BigInt(target << 2);
        console.log(`JAL: Jumping to 0x${this.pc.toString(16)}, RA = 0x${this.gpr[31].toString(16)}`);
    }

    opCOP0(instruction) {
        const funct = (instruction >> 21) & 0x1F;
        switch (funct) {
            case 0b00100: // MTC0
                this.opMTC0(instruction);
                break;
            default:
                console.error(`Unknown COP0 function: 0b${funct.toString(2)}`);
        }
    }

    opMTC0(instruction) {
        const rt = (instruction >> 16) & 0x1F;
        const rd = (instruction >> 11) & 0x1F;

        console.log(`MTC0: Moving gpr[${rt}] to cop0r[${rd}]`);
        // For now, we'll assume any MTC0 is a command for the RCP
        this.rcp.executeCommand(Number(this.gpr[rt]));
    }

    logState() {
        console.log(`  PC: 0x${this.pc.toString(16)}`);
        const nonZeroRegisters = [];
        for (let i = 1; i < 32; i++) {
            if (this.gpr[i] !== 0n) {
                nonZeroRegisters.push(`R${i}: ${this.gpr[i]}`);
            }
        }
        if (nonZeroRegisters.length > 0) {
            console.log(`  GPRs: ${nonZeroRegisters.join(', ')}`);
        }
    }
}
