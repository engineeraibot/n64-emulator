class MMU {
    constructor(memory) {
        this.memory = memory;
    }

    read32(address) {
        const physicalAddress = this.translateAddress(address);
        return this.memory.read32(physicalAddress);
    }

    write32(address, value) {
        const physicalAddress = this.translateAddress(address);
        this.memory.write32(physicalAddress, value);
    }

    translateAddress(address) {
        // N64 memory map is complex. This is a simplified version.
        // KSEG0 is the cached, direct-mapped RAM region.
        if (address >= 0x80000000 && address < 0xA0000000) {
            return address - 0x80000000;
        }
        // ROM region
        else if (address >= 0xB0000000 && address < 0xC0000000) {
            return address - 0xB0000000;
        }
        // Boot ROM
        else if (address >= 0xBFC00000 && address < 0xBFC007C0) {
            return address - 0xBFC00000;
        }

        console.error(`MMU: Unhandled address: 0x${address.toString(16)}`);
        return address;
    }
}
