class MMU {
    static RDRAM_START = 0x00000000;
    static RDRAM_END   = 0x007FFFFF; // Up to 8MB
    static SP_DMEM_START = 0x04000000;
    static SP_DMEM_END   = 0x04000FFF;
    static SP_IMEM_START = 0x04001000;
    static SP_IMEM_END   = 0x04001FFF;
    static SP_REGS_START = 0x04040000;
    static MI_REGS_START = 0x04300000;
    static VI_REGS_START = 0x04400000;
    static VI_REGS_END   = 0x04400037;
    static AI_REGS_START = 0x04500000;
    static PI_REGS_START = 0x04600000;
    static RI_REGS_START = 0x04700000;
    static SI_REGS_START = 0x04800000;
    static ROM_START     = 0x10000000;
    static ROM_END       = 0x1FBFFFFF;
    static PIF_ROM_START = 0x1FC00000;
    static PIF_ROM_END   = 0x1FC007BF;
    static PIF_RAM_START = 0x1FC007C0;
    static PIF_RAM_END   = 0x1FC007FF;

    constructor(memory) {
        this.memory = memory;
        this.viRegisters = new Uint32Array(14);
    }

    read8(address) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) return this.memory.read8(physicalAddress);
        else if (physicalAddress >= MMU.ROM_START && physicalAddress <= MMU.ROM_END) return this.memory.readRom8(physicalAddress - MMU.ROM_START);
        return 0;
    }
    write8(address, value) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) this.memory.write8(physicalAddress, value);
    }
    read16(address) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) return this.memory.read16(physicalAddress);
        else if (physicalAddress >= MMU.ROM_START && physicalAddress <= MMU.ROM_END) return this.memory.readRom16(physicalAddress - MMU.ROM_START);
        return 0;
    }
    write16(address, value) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) this.memory.write16(physicalAddress, value);
    }
    read32(address) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) return this.memory.read32(physicalAddress);
        else if (physicalAddress >= MMU.ROM_START && physicalAddress <= MMU.ROM_END) return this.memory.readRom32(physicalAddress - MMU.ROM_START);
        else if (physicalAddress >= MMU.VI_REGS_START && physicalAddress <= MMU.VI_REGS_END) return this.viRegisters[(physicalAddress - MMU.VI_REGS_START) >> 2];
        return 0;
    }
    write32(address, value) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) this.memory.write32(physicalAddress, value);
        else if (physicalAddress >= MMU.VI_REGS_START && physicalAddress <= MMU.VI_REGS_END) this.viRegisters[(physicalAddress - MMU.VI_REGS_START) >> 2] = value;
    }
    read64(address) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) return this.memory.read64(physicalAddress);
        else if (physicalAddress >= MMU.ROM_START && physicalAddress <= MMU.ROM_END) return this.memory.readRom64(physicalAddress - MMU.ROM_START);
        return 0n;
    }
    write64(address, value) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) this.memory.write64(physicalAddress, value);
    }

    translateAddress(address) {
        address = address >>> 0;
        if (address >= 0x80000000 && address <= 0x9FFFFFFF) return address - 0x80000000;
        else if (address >= 0xA0000000 && address <= 0xBFFFFFFF) return address - 0xA0000000;
        return address;
    }
}
