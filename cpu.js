class CPU {
    constructor(memory) {
        console.log("CPU Initialized");
        this.memory = memory;
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
    }

    run() {
        console.log("CPU is running...");
        // We'll run a few steps for now to avoid an infinite loop in the browser
        for (let i = 0; i < 10; i++) {
            this.step();
        }
    }

    step() {
        // Fetch the instruction from the address in the Program Counter
        const address = Number(this.pc - 0xBFC00000n); // Adjust for our memory mapping
        console.log(`Fetching instruction from 0x${this.pc.toString(16)} (mapped to 0x${address.toString(16)})`);
        const instruction = this.memory.read32(address);

        // Decode and Execute the instruction
        this.decodeAndExecute(instruction);


        // Move to the next instruction (MIPS instructions are 4 bytes)
        this.pc += 4n;

        this.logState();
    }

    decodeAndExecute(instruction) {
        const opcode = (instruction >> 26) & 0x3F;

        switch (opcode) {
            case 0b001001: // ADDIU
                this.opADDIU(instruction);
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
