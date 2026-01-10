class Memory {
    constructor(size = 4 * 1024 * 1024) { // Default to 4MB of RAM
        console.log("Memory Initialized");
        this.ram = new ArrayBuffer(size);
        this.ramView = new DataView(this.ram);
    }

    read32(address) {
        // The N64 uses big-endian format
        const value = this.ramView.getUint32(address, false);
        console.log(`Reading 0x${value.toString(16)} from 0x${address.toString(16)}`);
        return value;
    }

    write32(address, value) {
        console.log(`Writing 0x${value.toString(16)} to 0x${address.toString(16)}`);
        // The N64 uses big-endian format
        this.ramView.setUint32(address, value, false);
    }

    loadRom(romBuffer) {
        const romView = new Uint8Array(romBuffer);
        const ramView = new Uint8Array(this.ram);
        // Copy the ROM into the beginning of our RAM array
        ramView.set(romView, 0);
        console.log("ROM copied to memory.");
    }
}
