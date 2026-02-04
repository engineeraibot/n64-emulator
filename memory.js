class Memory {
    constructor(rdramSize = 8 * 1024 * 1024) {
        console.log("Memory Initialized");
        this.rdram = new ArrayBuffer(rdramSize);
        this.rdramView = new DataView(this.rdram);
        this.rom = null;
        this.romView = null;
    }

    read8(address) { return this.rdramView.getUint8(address); }
    write8(address, value) { this.rdramView.setUint8(address, value); }
    read16(address) { return this.rdramView.getUint16(address, false); }
    write16(address, value) { this.rdramView.setUint16(address, value, false); }
    read32(address) { return this.rdramView.getUint32(address, false); }
    write32(address, value) { this.rdramView.setUint32(address, value, false); }
    read64(address) { return this.rdramView.getBigUint64(address, false); }
    write64(address, value) { this.rdramView.setBigUint64(address, value, false); }

    loadRom(romBuffer) {
        let view = new Uint8Array(romBuffer);
        if (view.length < 4) {
            console.error("ROM buffer too small.");
            return;
        }

        const magic = ((view[0] << 24) | (view[1] << 16) | (view[2] << 8) | view[3]) >>> 0;

        if (magic === 0x80371240) {
            console.log("ROM is Big Endian (z64)");
        } else if (magic === 0x37804012) {
            console.log("ROM is Byte Swapped (v64). Normalizing...");
            for (let i = 0; i < view.length; i += 2) {
                const tmp = view[i];
                view[i] = view[i + 1];
                view[i + 1] = tmp;
            }
        } else if (magic === 0x40123780) {
            console.log("ROM is Little Endian (n64). Normalizing...");
            for (let i = 0; i < view.length; i += 4) {
                const tmp0 = view[i];
                const tmp1 = view[i + 1];
                const tmp2 = view[i + 2];
                const tmp3 = view[i + 3];
                view[i] = tmp3;
                view[i + 1] = tmp2;
                view[i + 2] = tmp1;
                view[i + 3] = tmp0;
            }
        } else {
            console.warn("Unknown ROM format magic: 0x" + (magic >>> 0).toString(16).padStart(8, '0'));
        }

        this.rom = romBuffer;
        this.romView = new DataView(this.rom);
        console.log("ROM loaded and normalized.");

        // Find all MIO0 blocks in the normalized ROM
        const romBytes = new Uint8Array(this.rom);
        const mio0Blocks = [];
        const romDataView = new DataView(this.rom);
        for (let i = 0; i < romBytes.length - 16; i++) {
            if (romBytes[i] === 0x4D && romBytes[i+1] === 0x49 && romBytes[i+2] === 0x4F && romBytes[i+3] === 0x30) {
                const destSize = romDataView.getUint32(i + 4, false);
                mio0Blocks.push(`0x${i.toString(16)} (size: ${destSize})`);
            }
        }
        console.log("MIO0 Blocks in normalized ROM: " + mio0Blocks.join(", "));
        const lastBytes = Array.from(romBytes.slice(-16)).map(x => x.toString(16).padStart(2, '0')).join(' ');
        console.log("Last 16 bytes of normalized ROM: " + lastBytes);
    }

    readRom8(address) {
        if (!this.romView || address < 0 || address >= this.rom.byteLength) return 0;
        return this.romView.getUint8(address);
    }
    readRom16(address) {
        if (!this.romView || address < 0 || address + 2 > this.rom.byteLength) return 0;
        return this.romView.getUint16(address, false);
    }
    readRom32(address) {
        if (!this.romView || address < 0 || address + 4 > this.rom.byteLength) return 0;
        return this.romView.getUint32(address, false);
    }
    readRom64(address) {
        if (!this.romView || address < 0 || address + 8 > this.rom.byteLength) return 0n;
        return this.romView.getBigUint64(address, false);
    }
}
