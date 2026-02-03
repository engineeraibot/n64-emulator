class MMU {
    static RDRAM_START = 0x00000000;
    static RDRAM_END   = 0x007FFFFF; // Up to 8MB
    static SP_DMEM_START = 0x04000000;
    static SP_DMEM_END   = 0x04000FFF;
    static SP_IMEM_START = 0x04001000;
    static SP_IMEM_END   = 0x04001FFF;
    static SP_REGS_START = 0x04040000;
    static SP_REGS_END   = 0x0404001F;
    static DPC_REGS_START = 0x04100000;
    static DPC_REGS_END   = 0x0410001F;
    static MI_REGS_START = 0x04300000;
    static MI_REGS_END   = 0x0430000F;
    static VI_REGS_START = 0x04400000;
    static VI_REGS_END   = 0x04400037;
    static AI_REGS_START = 0x04500000;
    static PI_REGS_START = 0x04600000;
    static PI_REGS_END   = 0x04600033;
    static RI_REGS_START = 0x04700000;
    static SI_REGS_START = 0x04800000;
    static SI_REGS_END   = 0x0480001B;
    static ROM_START     = 0x10000000;
    static ROM_END       = 0x1FBFFFFF;
    static PIF_ROM_START = 0x1FC00000;
    static PIF_ROM_END   = 0x1FC007BF;
    static PIF_RAM_START = 0x1FC007C0;
    static PIF_RAM_END   = 0x1FC007FF;

    constructor(memory) {
        this.memory = memory;
        this.rcp = null; // Set after RCP is created
        this.cpu = null; // Set after CPU is created
        this.viRegisters = new Uint32Array(14);
        this.miRegisters = new Uint32Array(4);
        this.piRegisters = new Uint32Array(13);
        this.siRegisters = new Uint32Array(7);
        this.spRegisters = new Uint32Array(8);
        this.dpcRegisters = new Uint32Array(8);
        this.aiRegisters = new Uint32Array(6);
        this.riRegisters = new Uint32Array(8);
        this.pifRam = new Uint8Array(64);
        this.pifRamView = new DataView(this.pifRam.buffer);
        this.spDmem = new Uint8Array(0x1000);
        this.spDmemView = new DataView(this.spDmem.buffer);
        this.spImem = new Uint8Array(0x1000);
        this.spImemView = new DataView(this.spImem.buffer);
        this.buttons = 0;
        this.stickX = 0;
        this.stickY = 0;
    }

    updateController(buttons, x, y) {
        this.buttons = buttons;
        this.stickX = x;
        this.stickY = y;
    }

    read8(address) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) return this.memory.read8(physicalAddress);
        else if (physicalAddress >= MMU.ROM_START && physicalAddress <= MMU.ROM_END) return this.memory.readRom8(physicalAddress - MMU.ROM_START);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) return this.spDmemView.getUint8(physicalAddress - MMU.SP_DMEM_START);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) return this.spImemView.getUint8(physicalAddress - MMU.SP_IMEM_START);
        return 0;
    }
    write8(address, value) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) this.memory.write8(physicalAddress, value);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) this.spDmemView.setUint8(physicalAddress - MMU.SP_DMEM_START, value);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) this.spImemView.setUint8(physicalAddress - MMU.SP_IMEM_START, value);
    }
    read16(address) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) return this.memory.read16(physicalAddress);
        else if (physicalAddress >= MMU.ROM_START && physicalAddress <= MMU.ROM_END) return this.memory.readRom16(physicalAddress - MMU.ROM_START);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) return this.spDmemView.getUint16(physicalAddress - MMU.SP_DMEM_START, false);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) return this.spImemView.getUint16(physicalAddress - MMU.SP_IMEM_START, false);
        return 0;
    }
    write16(address, value) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) this.memory.write16(physicalAddress, value);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) this.spDmemView.setUint16(physicalAddress - MMU.SP_DMEM_START, value, false);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) this.spImemView.setUint16(physicalAddress - MMU.SP_IMEM_START, value, false);
    }
    read32(address) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) return this.memory.read32(physicalAddress);
        else if (physicalAddress >= MMU.ROM_START && physicalAddress <= MMU.ROM_END) return this.memory.readRom32(physicalAddress - MMU.ROM_START);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) return this.spDmemView.getUint32(physicalAddress - MMU.SP_DMEM_START, false);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) return this.spImemView.getUint32(physicalAddress - MMU.SP_IMEM_START, false);
        else if (physicalAddress >= MMU.VI_REGS_START && physicalAddress <= MMU.VI_REGS_END) return this.viRegisters[(physicalAddress - MMU.VI_REGS_START) >> 2];
        else if (physicalAddress >= MMU.PI_REGS_START && physicalAddress <= MMU.PI_REGS_END) {
            const regIdx = (physicalAddress - MMU.PI_REGS_START) >> 2;
            if (regIdx === 4) return 0; // PI_STATUS: not busy
            return this.piRegisters[regIdx];
        }
        else if (physicalAddress >= MMU.MI_REGS_START && physicalAddress <= MMU.MI_REGS_END) {
            const regIdx = (physicalAddress - MMU.MI_REGS_START) >> 2;
            if (regIdx === 1) return 0x02020102; // MI_VERSION
            return this.miRegisters[regIdx];
        }
        else if (physicalAddress >= MMU.SI_REGS_START && physicalAddress <= MMU.SI_REGS_END) return this.siRegisters[(physicalAddress - MMU.SI_REGS_START) >> 2];
        else if (physicalAddress >= MMU.SP_REGS_START && physicalAddress <= MMU.SP_REGS_END) return this.spRegisters[(physicalAddress - MMU.SP_REGS_START) >> 2];
        else if (physicalAddress >= MMU.DPC_REGS_START && physicalAddress <= MMU.DPC_REGS_END) return this.dpcRegisters[(physicalAddress - MMU.DPC_REGS_START) >> 2];
        else if (physicalAddress >= MMU.AI_REGS_START && physicalAddress <= MMU.AI_REGS_START + 0x17) return this.aiRegisters[(physicalAddress - MMU.AI_REGS_START) >> 2];
        else if (physicalAddress >= MMU.RI_REGS_START && physicalAddress <= MMU.RI_REGS_START + 0x1F) return this.riRegisters[(physicalAddress - MMU.RI_REGS_START) >> 2];
        else if (physicalAddress >= MMU.PIF_RAM_START && physicalAddress <= MMU.PIF_RAM_END) return this.pifRamView.getUint32(physicalAddress - MMU.PIF_RAM_START, false);

        return 0;
    }
    write32(address, value) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) this.memory.write32(physicalAddress, value);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) this.spDmemView.setUint32(physicalAddress - MMU.SP_DMEM_START, value, false);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) this.spImemView.setUint32(physicalAddress - MMU.SP_IMEM_START, value, false);
        else if (physicalAddress >= MMU.VI_REGS_START && physicalAddress <= MMU.VI_REGS_END) {
            const regIdx = (physicalAddress - MMU.VI_REGS_START) >> 2;
            this.viRegisters[regIdx] = value;
            if (regIdx === 4) { // VI_CURRENT_REG
                this.miRegisters[2] &= ~0x08; // Clear VI Interrupt
            }
        }
        else if (physicalAddress >= MMU.PI_REGS_START && physicalAddress <= MMU.PI_REGS_END) this.handlePiWrite(physicalAddress, value);
        else if (physicalAddress >= MMU.MI_REGS_START && physicalAddress <= MMU.MI_REGS_END) this.handleMiWrite(physicalAddress, value);
        else if (physicalAddress >= MMU.SI_REGS_START && physicalAddress <= MMU.SI_REGS_END) this.handleSiWrite(physicalAddress, value);
        else if (physicalAddress >= MMU.SP_REGS_START && physicalAddress <= MMU.SP_REGS_END) {
            if (this.rcp) this.rcp.handleSpWrite(physicalAddress, value);
            else this.spRegisters[(physicalAddress - MMU.SP_REGS_START) >> 2] = value;
        }
        else if (physicalAddress >= MMU.DPC_REGS_START && physicalAddress <= MMU.DPC_REGS_END) {
            if (this.rcp) this.rcp.handleDpcWrite(physicalAddress, value);
            else this.dpcRegisters[(physicalAddress - MMU.DPC_REGS_START) >> 2] = value;
        }
        else if (physicalAddress >= MMU.AI_REGS_START && physicalAddress <= MMU.AI_REGS_START + 0x17) this.handleAiWrite(physicalAddress, value);
        else if (physicalAddress >= MMU.RI_REGS_START && physicalAddress <= MMU.RI_REGS_START + 0x1F) this.riRegisters[(physicalAddress - MMU.RI_REGS_START) >> 2] = value;
        else if (physicalAddress >= MMU.PIF_RAM_START && physicalAddress <= MMU.PIF_RAM_END) {
            this.pifRamView.setUint32(physicalAddress - MMU.PIF_RAM_START, value, false);
            if (physicalAddress === MMU.PIF_RAM_END - 3) this.handlePifCommand();
        }
    }

    handleMiWrite(address, value) {
        const regIdx = (address - MMU.MI_REGS_START) >> 2;
        if (regIdx === 0) { // MI_MODE_REG
            this.miRegisters[0] = (this.miRegisters[0] & ~0x7F) | (value & 0x7F);
            if (value & 0x0800) this.miRegisters[2] &= ~0x01; // Clear SP interrupt
        } else if (regIdx === 3) { // MI_INTR_MASK_REG
            if (value & 0x0001) this.miRegisters[3] &= ~0x01; if (value & 0x0002) this.miRegisters[3] |= 0x01; // SP
            if (value & 0x0004) this.miRegisters[3] &= ~0x02; if (value & 0x0008) this.miRegisters[3] |= 0x02; // SI
            if (value & 0x0010) this.miRegisters[3] &= ~0x04; if (value & 0x0020) this.miRegisters[3] |= 0x04; // AI
            if (value & 0x0040) this.miRegisters[3] &= ~0x08; if (value & 0x0080) this.miRegisters[3] |= 0x08; // VI
            if (value & 0x0100) this.miRegisters[3] &= ~0x10; if (value & 0x0200) this.miRegisters[3] |= 0x10; // PI
            if (value & 0x0400) this.miRegisters[3] &= ~0x20; if (value & 0x0800) this.miRegisters[3] |= 0x20; // DP
        } else {
            this.miRegisters[regIdx] = value;
        }
    }

    handlePiWrite(address, value) {
        const regIdx = (address - MMU.PI_REGS_START) >> 2;
        if (regIdx === 4) { // PI_STATUS_REG
            if (value & 0x01) { /* reset controller */ }
            if (value & 0x02) this.miRegisters[2] &= ~0x10; // Clear PI interrupt
        } else {
            this.piRegisters[regIdx] = value;
            if (regIdx === 2) this.doPiDma(false); // DRAM -> Cart
            if (regIdx === 3) this.doPiDma(true);  // Cart -> DRAM
        }
    }

    handleSiWrite(address, value) {
        const regIdx = (address - MMU.SI_REGS_START) >> 2;
        this.siRegisters[regIdx] = value;
        if (regIdx === 1 || regIdx === 4) this.doSiDma(regIdx === 4);
    }

    handleAiWrite(address, value) {
        const regIdx = (address - MMU.AI_REGS_START) >> 2;
        this.aiRegisters[regIdx] = value;
        if (regIdx === 1) { // AI_LEN_REG
            // Simulate DMA completion
            this.miRegisters[2] |= 0x04; // AI Interrupt
        } else if (regIdx === 2) { // AI_CONTROL_REG
            if (value & 0x01) { /* DMA Enable */ }
        }
    }

    handlePifCommand() {
        if (this.pifRam[0x3F] === 0x01) {
            // Basic HLE PIF command handling
            let i = 0;
            while (i < 0x3F) {
                if (this.pifRam[i] === 0xFF) { i++; continue; }
                if (this.pifRam[i] === 0x00) break;

                const sendLen = this.pifRam[i] & 0x3F;
                const recvLen = this.pifRam[i+1] & 0x3F;
                const cmd = this.pifRam[i+2];

                if (cmd === 0x01 || cmd === 0xFF || cmd === 0x00) { // Read Controller or Info
                    if (cmd === 0x00 || cmd === 0xFF) { // Info
                        this.pifRam[i+2] = 0x05; this.pifRam[i+3] = 0x00; this.pifRam[i+4] = 0x01;
                    } else { // Read
                        this.pifRam[i+2] = (this.buttons >> 8) & 0xFF;
                        this.pifRam[i+3] = this.buttons & 0xFF;
                        this.pifRam[i+4] = this.stickX & 0xFF;
                        this.pifRam[i+5] = this.stickY & 0xFF;
                    }
                } else if (cmd === 0x04 || cmd === 0x05) { // EEPROM Read/Write
                    // Return 0 (Success) for both
                    for (let j = 0; j < recvLen; j++) this.pifRam[i+2+j] = 0;
                } else if (cmd === 0x02 || cmd === 0x03) { // Write/Read Status
                    for (let j = 0; j < recvLen; j++) this.pifRam[i+2+j] = 0;
                } else {
                    // Unknown command, skip it to avoid getting stuck
                    i += 1;
                    continue;
                }
                i += 2 + sendLen + recvLen;
            }
            this.pifRam[0x3F] = 0;
        }
    }

    doPiDma(cartToDram) {
        const ramAddr = this.piRegisters[0] & 0x00FFFFFF;
        const cartAddr = this.piRegisters[1] & 0x1FFFFFFF;
        const length = ((cartToDram ? this.piRegisters[3] : this.piRegisters[2]) & 0x00FFFFFF) + 1;

        if (cartToDram) {
            const rdramView = new Uint8Array(this.memory.rdram);
            const romOffset = cartAddr - 0x10000000;
            console.log(`PI DMA: ROM 0x${cartAddr.toString(16)} -> RAM 0x${ramAddr.toString(16)} (len: 0x${length.toString(16)})`);
            for (let i = 0; i < length; i++) {
                if (ramAddr + i < rdramView.length) {
                    rdramView[ramAddr + i] = this.memory.readRom8(romOffset + i);
                }
            }
        }
        this.piRegisters[4] &= ~0x01; // Not busy
        this.miRegisters[2] |= 0x10;  // PI Interrupt
    }

    doSiDma(isToPif) {
        const ramAddr = this.siRegisters[0] & 0x00FFFFFF;
        const rdramView = new Uint8Array(this.memory.rdram);
        if (isToPif) {
            // DRAM to PIF RAM
            for (let i = 0; i < 64; i++) {
                if (ramAddr + i < rdramView.length) this.pifRam[i] = rdramView[ramAddr + i];
            }
            this.handlePifCommand();
        } else {
            // PIF RAM to DRAM
            for (let i = 0; i < 64; i++) {
                if (ramAddr + i < rdramView.length) rdramView[ramAddr + i] = this.pifRam[i];
            }
        }
        this.siRegisters[6] &= ~0x01; // Not busy
        this.miRegisters[2] |= 0x02;  // SI Interrupt
    }
    read64(address) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) return this.memory.read64(physicalAddress);
        else if (physicalAddress >= MMU.ROM_START && physicalAddress <= MMU.ROM_END) return this.memory.readRom64(physicalAddress - MMU.ROM_START);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) return this.spDmemView.getBigUint64(physicalAddress - MMU.SP_DMEM_START, false);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) return this.spImemView.getBigUint64(physicalAddress - MMU.SP_IMEM_START, false);
        return 0n;
    }
    write64(address, value) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) this.memory.write64(physicalAddress, value);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) this.spDmemView.setBigUint64(physicalAddress - MMU.SP_DMEM_START, value, false);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) this.spImemView.setBigUint64(physicalAddress - MMU.SP_IMEM_START, value, false);
    }

    translateAddress(address) {
        address = address >>> 0;
        if (address >= 0x80000000 && address <= 0x9FFFFFFF) return address - 0x80000000;
        else if (address >= 0xA0000000 && address <= 0xBFFFFFFF) return address - 0xA0000000;
        return address;
    }
}
