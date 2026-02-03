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
        if (regIdx === 2) { // SP_RD_LEN_REG
            this.mmu.spRegisters[2] = value;
            this.doSpDma(false);
        } else if (regIdx === 3) { // SP_WR_LEN_REG
            this.mmu.spRegisters[3] = value;
            this.doSpDma(true);
        } else if (regIdx === 4) { // SP_STATUS_REG
            if (value & 0x00000001) this.mmu.spRegisters[4] &= ~0x01; // Clear halt
            if (value & 0x00000002) this.mmu.spRegisters[4] |= 0x01;  // Set halt
            if (value & 0x00000004) this.mmu.spRegisters[4] &= ~0x02; // Clear broke
            if (value & 0x00000008) this.mmu.miRegisters[2] &= ~0x01; // Clear SP interrupt
            if (value & 0x00000010) this.mmu.miRegisters[2] |= 0x01;  // Set SP interrupt
            if (value & 0x00000020) this.mmu.spRegisters[4] &= ~0x00000004; // bit 5 is clear single step
            if (value & 0x00000040) this.mmu.spRegisters[4] |= 0x00000004;  // Set single step
            if (value & 0x00000080) this.mmu.spRegisters[4] &= ~0x00000008; // Clear interrupt on break
            if (value & 0x00000100) this.mmu.spRegisters[4] |= 0x00000008;  // Set interrupt on break
            if (value & 0x00000200) this.mmu.spRegisters[4] &= ~0x00000010; // Clear signal 0
            if (value & 0x00000400) this.mmu.spRegisters[4] |= 0x00000010;  // Set signal 0
            if (value & 0x00000800) this.mmu.spRegisters[4] &= ~0x00000020; // Clear signal 1
            if (value & 0x00001000) this.mmu.spRegisters[4] |= 0x00000020;  // Set signal 1
            if (value & 0x00002000) this.mmu.spRegisters[4] &= ~0x00000040; // Clear signal 2
            if (value & 0x00004000) this.mmu.spRegisters[4] |= 0x00000040;  // Set signal 2
            if (value & 0x00008000) this.mmu.spRegisters[4] &= ~0x00000080; // Clear signal 3
            if (value & 0x00010000) this.mmu.spRegisters[4] |= 0x00000080;  // Set signal 3
            if (value & 0x00020000) this.mmu.spRegisters[4] &= ~0x00000100; // Clear signal 4
            if (value & 0x00040000) this.mmu.spRegisters[4] |= 0x00000100;  // Set signal 4
            if (value & 0x00080000) this.mmu.spRegisters[4] &= ~0x00000200; // Clear signal 5
            if (value & 0x00100000) this.mmu.spRegisters[4] |= 0x00000200;  // Set signal 5
            if (value & 0x00200000) this.mmu.spRegisters[4] &= ~0x00000400; // Clear signal 6
            if (value & 0x00400000) this.mmu.spRegisters[4] |= 0x00000400;  // Set signal 6
            if (value & 0x00800000) this.mmu.spRegisters[4] &= ~0x00000800; // Clear signal 7
            if (value & 0x01000000) this.mmu.spRegisters[4] |= 0x00000800;  // Set signal 7

            // Auto-complete RSP task for now (HLE)
            if (!(this.mmu.spRegisters[4] & 0x01)) {
                this.runRspTask();
                this.mmu.spRegisters[4] |= 0x03; // Halt and Broke
                this.mmu.miRegisters[2] |= 0x01; // SP Interrupt
            }
        } else {
            this.mmu.spRegisters[regIdx] = value;
        }
    }

    doSpDma(isToDram) {
        const spAddr = this.mmu.spRegisters[0] & 0x1FFF;
        const dramAddr = this.mmu.spRegisters[1] & 0x00FFFFFF;
        const len = (this.mmu.spRegisters[isToDram ? 3 : 2] & 0xFFF) + 1;

        const rdramView = new Uint8Array(this.mmu.memory.rdram);
        const spMem = (spAddr & 0x1000) ? this.mmu.spImem : this.mmu.spDmem;
        const spOffset = spAddr & 0xFFF;

        if (isToDram) {
            for (let i = 0; i < len; i++) {
                if (dramAddr + i < rdramView.length) rdramView[dramAddr + i] = spMem[spOffset + i];
            }
        } else {
            for (let i = 0; i < len; i++) {
                if (dramAddr + i < rdramView.length) spMem[spOffset + i] = rdramView[dramAddr + i];
            }
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

    runRspTask() {
        const firstInstr = this.mmu.spImemView.getUint32(0, false);
        // console.log(`RSP Task Started. Microcode first instr: 0x${firstInstr.toString(16)}`);
    }
}
