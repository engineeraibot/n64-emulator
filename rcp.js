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
            // ... more bits
        } else {
            this.mmu.spRegisters[regIdx] = value;
        }
    }

    handleDpcWrite(address, value) {
        const regIdx = (address - 0x04100000) >> 2;
        this.mmu.dpcRegisters[regIdx] = value;
        if (regIdx === 0) { // DPC_START_REG
            // Trigger RDP command processing?
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
