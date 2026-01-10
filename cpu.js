class CPU {
    constructor(mmu) {
        console.log("CPU Initialized");
        this.mmu = mmu;
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
        // Fetch the instruction from the address in the Program Counter
        console.log(`Fetching instruction from 0x${this.pc.toString(16)}`);
        const instruction = this.mmu.read32(Number(this.pc));

        // Decode and Execute the instruction
        this.decodeAndExecute(instruction);


        // Move to the next instruction (MIPS instructions are 4 bytes)
        this.pc += 4n;

        // In a real MIPS processor, the instruction in the delay slot would be
        this.logState();
    }

    decodeAndExecute(instruction) {
        const opcode = (instruction >> 26) & 0x3F;

        switch (opcode) {
            case 0b000100: // BEQ
                this.opBEQ(instruction);
                break;
            case 0b000101: // BNE
                this.opBNE(instruction);
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
                console.error(`Unknown opcode: 0b${opcode.toString(2)}`);
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

    opBEQ(instruction) {
        const rs = (instruction >> 21) & 0x1F;
        const rt = (instruction >> 16) & 0x1F;
        const offset = instruction & 0xFFFF;

        // The branch is taken if the values in the two registers are equal
        if (this.gpr[rs] === this.gpr[rt]) {
            // The offset is a signed 16-bit value, shifted left by 2
            const branchAddress = BigInt.asIntN(18, BigInt(offset << 2));
            // The PC is incremented by 4 (to the delay slot) before the branch is taken
            this.pc = this.pc + 4n + branchAddress - 4n;
            console.log(`BEQ: Branching to 0x${(this.pc + 4n).toString(16)}`);
        }
    }

    opBNE(instruction) {
        const rs = (instruction >> 21) & 0x1F;
        const rt = (instruction >> 16) & 0x1F;
        const offset = instruction & 0xFFFF;

        // The branch is taken if the values in the two registers are not equal
        if (this.gpr[rs] !== this.gpr[rt]) {
            // The offset is a signed 16-bit value, shifted left by 2
            const branchAddress = BigInt.asIntN(18, BigInt(offset << 2));
            // The PC is incremented by 4 (to the delay slot) before the branch is taken
            this.pc = this.pc + 4n + branchAddress - 4n;
            console.log(`BNE: Branching to 0x${(this.pc + 4n).toString(16)}`);
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

    logState() {
        console.log(`  PC: 0x${(this.pc).toString(16)}`);
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
