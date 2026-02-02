class RCP {
    constructor(mmu, framebuffer) {
        console.log("RCP Initialized");
        this.mmu = mmu;
        this.framebuffer = framebuffer;
        this.reset();
    }

    reset() {
        console.log("RCP Reset");
        if (this.mmu) {
            this.mmu.spRegisters[4] = 0x01; // RSP Halted
            this.mmu.miRegisters[2] = 0;    // No interrupts
        }
    }

    handleSpWrite(address, value) {
        const regIdx = (address - 0x04040000) >> 2;
        if (regIdx === 4) { // SP_STATUS_REG
            if (value & 0x00000001) this.mmu.spRegisters[4] &= ~0x01; // Clear halt
            if (value & 0x00000002) this.mmu.spRegisters[4] |= 0x01;  // Set halt
            if (value & 0x00000004) this.mmu.spRegisters[4] &= ~0x02; // Clear broke
            if (value & 0x00000008) this.mmu.miRegisters[2] &= ~0x01; // Clear SP interrupt
            if (value & 0x00000010) this.mmu.miRegisters[2] |= 0x01;  // Set SP interrupt
            if (value & 0x00000020) this.mmu.spRegisters[4] &= ~0x00000004; // Clear smask? No, bit 5 is clear single step
            if (value & 0x00000040) this.mmu.spRegisters[4] |= 0x00000004;  // Set single step
            if (value & 0x00000080) this.mmu.spRegisters[4] &= ~0x00000008; // Clear interrupt on break
            if (value & 0x00000100) this.mmu.spRegisters[4] |= 0x00000008;  // Set interrupt on break
            if (value & 0x00000200) this.mmu.spRegisters[4] &= ~0x00000010; // Clear signal 0
            if (value & 0x00000400) this.mmu.spRegisters[4] |= 0x00000010;  // Set signal 0
            // ... more signals

            // Auto-complete RSP task for now (HLE)
            if (!(this.mmu.spRegisters[4] & 0x01)) {
                this.mmu.spRegisters[4] |= 0x03; // Halt and Broke
                this.mmu.miRegisters[2] |= 0x01; // SP Interrupt
            }
        } else {
            this.mmu.spRegisters[regIdx] = value;
        }
    }

    handleDpcWrite(address, value) {
        const regIdx = (address - 0x04100000) >> 2;
        this.mmu.dpcRegisters[regIdx] = value;
        if (regIdx === 1) { // DPC_END_REG
            // Auto-complete RDP task (HLE)
            this.mmu.dpcRegisters[3] = value; // STATUS = END? No, CURRENT = END
            this.mmu.miRegisters[2] |= 0x20; // DP Interrupt
        }
    }

    executeCommand(command) {
        // This is a placeholder for a real RCP command processor.
        // For now, we'll use a simple command to change the background color.
        const commandType = (command >> 24) & 0xFF;
        if (commandType === 0x01) { // Set background color
            const color = command & 0x00FFFFFF;
            const r = (color >> 16) & 0xFF;
            const g = (color >> 8) & 0xFF;
            const b = color & 0xFF;
            this.fillFramebuffer(r, g, b);
        }
    }

    fillFramebuffer(r, g, b) {
        for (let i = 0; i < this.framebuffer.length; i += 4) {
            this.framebuffer[i] = r;
            this.framebuffer[i + 1] = g;
            this.framebuffer[i + 2] = b;
            this.framebuffer[i + 3] = 255;
        }
    }
}
