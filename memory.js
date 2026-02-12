class Memory {
    constructor(rdramSize = 8 * 1024 * 1024) {
        console.log("Memory Initialized");
        this.rdram = new ArrayBuffer(rdramSize);
        this.rdramView = new DataView(this.rdram);
        this.rom = null;
        this.romView = null;
        this.romBytes = null;
    }

    read8(address) { return this.rdramView.getUint8(address & 0x7FFFFF); }
    write8(address, value) { this.rdramView.setUint8(address & 0x7FFFFF, value); }
    read16(address) { return this.rdramView.getUint16(address & 0x7FFFFF, false); }
    write16(address, value) { this.rdramView.setUint16(address & 0x7FFFFF, value, false); }
    read32(address) { return this.rdramView.getUint32(address & 0x7FFFFF, false); }
    write32(address, value) { this.rdramView.setUint32(address & 0x7FFFFF, value, false); }
    read64(address) { return this.rdramView.getBigUint64(address & 0x7FFFFF, false); }
    write64(address, value) { this.rdramView.setBigUint64(address & 0x7FFFFF, value, false); }

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
        this.romBytes = new Uint8Array(this.rom);
        console.log("ROM loaded and normalized. Size:", this.rom.byteLength);
    }

    readRom8(address) {
        if (!this.romBytes) return 0;
        return this.romBytes[(address >>> 0) % this.rom.byteLength];
    }
    readRom16(address) {
        if (!this.romView) return 0;
        const len = this.rom.byteLength;
        const offset = (address >>> 0) % len;
        if (offset <= len - 2) return this.romView.getUint16(offset, false);
        return (this.romBytes[offset] << 8) | this.romBytes[(offset + 1) % len];
    }
    readRom32(address) {
        if (!this.romView) return 0;
        const len = this.rom.byteLength;
        const offset = (address >>> 0) % len;
        if (offset <= len - 4) return this.romView.getUint32(offset, false);
        let val = 0;
        for (let i = 0; i < 4; i++) {
            val = (val << 8) | this.romBytes[(offset + i) % len];
        }
        return val >>> 0;
    }
    readRom64(address) {
        if (!this.romView) return 0n;
        const len = this.rom.byteLength;
        const offset = (address >>> 0) % len;
        if (offset <= len - 8) return this.romView.getBigUint64(offset, false);
        let val = 0n;
        for (let i = 0; i < 8; i++) {
            val = (val << 8n) | BigInt(this.romBytes[(offset + i) % len]);
        }
        return val;
    }
}
