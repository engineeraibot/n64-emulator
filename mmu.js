class MMU {
    static RDRAM_START = 0x00000000;
    static RDRAM_END = 0x007FFFFF;

    constructor(memory) {
        this.memory = memory;
        this.rcp = null;
        this.cpu = null;

        this.piBusyUntil = 0;
        this.siBusyUntil = 0;
        this.aiBusyUntil = 0;
        this.viNextInterrupt = 0;

        this.viRegisters = new Uint32Array(14);
        this.miRegisters = new Uint32Array(4);
        this.piRegisters = new Uint32Array(13);

        // PI configuration defaults
        this.piRegisters[5] = 0x40;
        this.piRegisters[6] = 0x12;
        this.piRegisters[7] = 0x07;
        this.piRegisters[8] = 0x03;
        this.piRegisters[9] = 0x40;
        this.piRegisters[10] = 0x12;
        this.piRegisters[11] = 0x07;
        this.piRegisters[12] = 0x03;

        this.siRegisters = new Uint32Array(7);
        this.spRegisters = new Uint32Array(8);
        this.dpcRegisters = new Uint32Array(8);
        this.aiRegisters = new Uint32Array(6);
        this.riRegisters = new Uint32Array(8);

        this.riRegisters[3] = 0x14;
        this.riRegisters[4] = 0x63634;

        this.pifRom = new Uint8Array(2048);
        this.pifRam = new Uint8Array(64);

        this.spDmem = new Uint8Array(0x1000);
        this.spImem = new Uint8Array(0x1000);
        this.spDmemView = new DataView(this.spDmem.buffer);
        this.spImemView = new DataView(this.spImem.buffer);

        this.buttons = 0;
        this.stickX = 0;
        this.stickY = 0;
        this.eeprom = new Uint8Array(512);
    }

    updateController(b, x, y) {
        this.buttons = b;
        this.stickX = x;
        this.stickY = y;
    }

    updateInterrupts() {
        if (this.cpu) {
            const pending = this.miRegisters[2] & this.miRegisters[3];
            if (pending) {
                this.cpu.cp0Registers[13] |= 0x0400n;
            } else {
                this.cpu.cp0Registers[13] &= ~0x0400n;
            }
        }
    }

    checkInternalEvents() {
        const now = this.cpu ? this.cpu.instructionCount : 0;

        // PI DMA completion
        if (this.piBusyUntil > 0 && now >= this.piBusyUntil) {
            this.piRegisters[4] &= ~0x03;
            this.miRegisters[2] |= 0x10;
            this.piBusyUntil = 0;
            this.updateInterrupts();
        }

        // SI DMA completion
        if (this.siBusyUntil > 0 && now >= this.siBusyUntil) {
            this.siRegisters[6] &= ~0x01;
            this.miRegisters[2] |= 0x02;
            this.siBusyUntil = 0;
            this.updateInterrupts();
        }

        // AI DMA completion
        if (this.aiBusyUntil > 0 && now >= this.aiBusyUntil) {
            this.miRegisters[2] |= 0x04;
            this.aiBusyUntil = 0;
            this.updateInterrupts();
        }

        // VI Interrupt
        if (now >= this.viNextInterrupt) {
            this.miRegisters[2] |= 0x08;
            this.updateInterrupts();
            // PAL is 50Hz, NTSC is 60Hz. SM64 PAL uses ~50Hz.
            this.viNextInterrupt = now + (this.viRegisters[6] > 0x240 ? 1875000 : 1562500);
        }
    }

    read32(a) {
        const p = this.translateAddress(a);
        if (p >= 0x04000000 && p <= 0x04800000) {
            // Only log if it's not VI_CURRENT or SP_STATUS which are polled constantly
            if (p !== 0x04400010 && p !== 0x04040010 && (this.cpu && this.cpu.instructionCount % 1000 === 0)) {
                console.log(`MMIO Read: 0x${p.toString(16)} at PC=0x${this.cpu ? this.cpu.pc.toString(16) : '?'}`);
            }
        }

        if (p < 0x04000000) return this.memory.read32(p & 0x7FFFFF);

        // Handle ROM mirroring in Domain 1 and 2
        if ((p >= 0x10000000 && p <= 0x1FBFFFFF) || (p >= 0x08000000 && p <= 0x0FFFFFFF)) {
            const romSize = this.memory.rom ? this.memory.rom.byteLength : 0x4000000;
            return this.memory.readRom32((p & 0x0FFFFFFF) % romSize);
        }

        if (p >= 0x1FC00000 && p <= 0x1FC007BF) return 0; // PIF ROM returns 0 to satisfy anti-piracy

        // DMEM / IMEM
        if (p >= 0x04000000 && p <= 0x04000FFF) return this.spDmemView.getUint32(p - 0x04000000, false);
        if (p >= 0x04001000 && p <= 0x04001FFF) return this.spImemView.getUint32(p - 0x04001000, false);

        // VI Registers
        if (p >= 0x04400000 && p <= 0x04400037) {
            if (p === 0x04400010) { // VI_CURRENT
                const now = this.cpu ? this.cpu.instructionCount : 0;
                const vSync = this.viRegisters[6] & 0x3FF;
                return (Math.floor(now / 3000) % (vSync || 525)) & ~1; // Even values mostly
            }
            return this.viRegisters[(p - 0x04400000) >> 2];
        }

        // PI Registers
        if (p >= 0x04600000 && p <= 0x04600033) {
            this.checkInternalEvents();
            let s = this.piRegisters[(p - 0x04600000) >> 2];
            if (p === 0x04600010 && (this.miRegisters[2] & 0x10)) s |= 0x08;
            return s;
        }

        // MI Registers
        if (p >= 0x04300000 && p <= 0x0430000F) {
            if (p === 0x04300004) return 0x02020102; // MI_VERSION
            if (p === 0x04300008) this.checkInternalEvents();
            return this.miRegisters[(p - 0x04300000) >> 2];
        }

        // SI Registers
        if (p >= 0x04800000 && p <= 0x0480001B) {
            return this.siRegisters[(p - 0x04800000) >> 2];
        }

        // RI Registers
        if (p >= 0x04700000 && p <= 0x0470001F) {
            return this.riRegisters[(p - 0x04700000) >> 2];
        }

        // SP Registers
        if (p >= 0x04040000 && p <= 0x0404001F) {
            const idx = (p - 0x04040000) >> 2;
            if (idx === 7) { // SP_SEMAPHORE
                const v = this.spRegisters[7];
                this.spRegisters[7] = 1;
                return v;
            }
            return this.spRegisters[idx];
        }

        // DPC Registers
        if (p >= 0x04100000 && p <= 0x0410001F) {
            const idx = (p - 0x04100000) >> 2;
            if (idx === 3) return 0x80; // DPC_STATUS: Ready
            return this.dpcRegisters[idx];
        }

        // AI Registers
        if (p >= 0x04500000 && p <= 0x04500017) {
            const regIdx = (p - 0x04500000) >> 2;
            if (regIdx === 3) { // AI_STATUS
                const now = this.cpu ? this.cpu.instructionCount : 0;
                return (this.aiBusyUntil > now) ? 0xC0000000 : 0;
            }
            return this.aiRegisters[regIdx];
        }

        // PIF RAM
        if (p >= 0x1FC007C0 && p <= 0x1FC007FF) return new DataView(this.pifRam.buffer).getUint32(p - 0x1FC007C0, false);

        return 0;
    }

    write32(a, v) {
        const p = this.translateAddress(a);

        if (p < 0x04000000) {
            this.memory.write32(p & 0x7FFFFF, v);
            if (this.cpu) this.cpu.invalidateCache();
        } else if (p >= 0x04000000 && p <= 0x04000FFF) {
            this.spDmemView.setUint32(p - 0x04000000, v, false);
        } else if (p >= 0x04001000 && p <= 0x04001FFF) {
            this.spImemView.setUint32(p - 0x04001000, v, false);
        } else if (p >= 0x04400000 && p <= 0x04400037) {
            const idx = (p - 0x04400000) >> 2;
            if (idx === 1) console.log(`MMU: VI_ORIGIN Write 0x${v.toString(16)}`);
            this.viRegisters[idx] = v;
            if (idx === 4) { // VI_CURRENT clears interrupt
                this.miRegisters[2] &= ~0x08;
                this.updateInterrupts();
            }
        } else if (p >= 0x04600000 && p <= 0x04600033) {
            this.handlePiWrite(p, v);
        } else if (p >= 0x04300000 && p <= 0x0430000F) {
            this.handleMiWrite(p, v);
        } else if (p >= 0x04800000 && p <= 0x0480001B) {
            this.handleSiWrite(p, v);
        } else if (p >= 0x04700000 && p <= 0x0470001F) {
            this.riRegisters[(p - 0x04700000) >> 2] = v;
        } else if (p >= 0x04500000 && p <= 0x04500017) {
            const regIdx = (p - 0x04500000) >> 2;
            if (regIdx === 3) { // AI_STATUS write clears interrupt
                this.miRegisters[2] &= ~0x04;
                this.updateInterrupts();
            } else {
                this.aiRegisters[regIdx] = v;
                if (regIdx === 1) this.aiBusyUntil = (this.cpu ? this.cpu.instructionCount : 0) + 50000;
            }
        } else if (p >= 0x04040000 && p <= 0x0404001F) {
            const idx = (p - 0x04040000) >> 2;
            if (idx === 4) { if (this.rcp) this.rcp.handleSpWrite(p, v); }
            else if (idx === 7) this.spRegisters[7] = 0; // SP_SEMAPHORE write clears it
            else this.spRegisters[idx] = v;
        } else if (p >= 0x04100000 && p <= 0x0410001F) {
            const idx = (p - 0x04100000) >> 2;
            if (idx === 1) console.log(`MMU: DPC_END Write 0x${v.toString(16)}`);
            if (this.rcp) this.rcp.handleDpcWrite(p, v);
            else this.dpcRegisters[idx] = v;
        } else if (p >= 0x1FC007C0 && p <= 0x1FC007FF) {
            new DataView(this.pifRam.buffer).setUint32(p - 0x1FC007C0, v, false);
            if (p === 0x1FC007FC) this.handlePifCommand();
        }
    }

    handleMiWrite(a, v) {
        const idx = (a - 0x04300000) >> 2;
        if (idx === 0) {
            this.miRegisters[0] = (this.miRegisters[0] & ~0x7F) | (v & 0x7F);
            if (v & 0x0800) { this.miRegisters[2] &= ~0x20; this.updateInterrupts(); } // Clear DP Interrupt
        } else if (idx === 3) {
            const m = [
                [0x1, 0x2, 0x1], [0x4, 0x8, 0x2], [0x10, 0x20, 0x4],
                [0x40, 0x80, 0x8], [0x100, 0x200, 0x10], [0x400, 0x800, 0x20]
            ];
            for (let i = 0; i < 6; i++) {
                if (v & m[i][0]) this.miRegisters[3] &= ~m[i][2];
                if (v & m[i][1]) this.miRegisters[3] |= m[i][2];
            }
        } else {
            this.miRegisters[idx] = v;
        }
        this.updateInterrupts();
    }

    handlePiWrite(a, v) {
        const idx = (a - 0x04600000) >> 2;
        if (idx === 4) { // PI_STATUS
            if (v & 0x01) { this.piRegisters[4] &= ~0x03; this.piBusyUntil = 0; } // Reset PI
            if (v & 0x02) this.miRegisters[2] &= ~0x10; // Clear PI Interrupt
            this.updateInterrupts();
        } else {
            this.piRegisters[idx] = v;
            if (idx === 2) this.doPiDma(false); // PI_RD_LEN (0x08): RAM -> Cart
            if (idx === 3) this.doPiDma(true);  // PI_WR_LEN (0x0C): Cart -> RAM
        }
    }

    handleSiWrite(a, v) {
        const idx = (a - 0x04800000) >> 2;
        if (idx === 6) { // SI_STATUS
            this.miRegisters[2] &= ~0x02;
            this.updateInterrupts();
        } else {
            this.siRegisters[idx] = v;
            if (idx === 1 || idx === 4) this.doSiDma(idx === 4);
        }
    }

    handlePifCommand() {
        const cmdByte = this.pifRam[0x3F];
        if (cmdByte === 0) return;

        if (cmdByte === 0x08) { // PIF Reset
            this.pifRam.fill(0);
            this.pifRam[0x3F] = 0;
            return;
        }

        if (cmdByte === 0x01) { // Joybus
            let i = 0;
            let channel = 0;
            while (i < 0x3F) {
                if (this.pifRam[i] === 0xFF) { i++; continue; }
                if (this.pifRam[i] === 0x00 || this.pifRam[i] === 0xFE) break;

                const sl = this.pifRam[i] & 0x3F;
                const rl = this.pifRam[i + 1] & 0x3F;
                const cmd = this.pifRam[i + 2];
                const res = i + 2 + sl;

                if (res >= 64) break;

                let success = false;
                if (channel < 4) { // Controllers
                    if (channel === 0) {
                        if (cmd === 0x00 || cmd === 0xFF) { // Info / Reset
                            if (res + 2 < 64) {
                                this.pifRam[res] = 0x05;
                                this.pifRam[res + 1] = 0x00;
                                this.pifRam[res + 2] = 0x01;
                                success = true;
                            }
                        } else if (cmd === 0x01) { // Read
                            if (res + 3 < 64) {
                                this.pifRam[res] = (this.buttons >> 8);
                                this.pifRam[res + 1] = this.buttons;
                                this.pifRam[res + 2] = this.stickX;
                                this.pifRam[res + 3] = this.stickY;
                                success = true;
                            }
                        }
                    }
                } else { // EEPROM
                    if (cmd === 0x00 || cmd === 0xFF) {
                        if (res + 2 < 64) {
                            this.pifRam[res] = 0x00;
                            this.pifRam[res + 1] = 0x80;
                            this.pifRam[res + 2] = 0x00;
                            success = true;
                        }
                    } else if (cmd === 0x04) { // Read
                        const b = this.pifRam[i + 3];
                        if (b < 64) {
                            for (let j = 0; j < 8; j++) if (res + j < 64) this.pifRam[res + j] = this.eeprom[b * 8 + j];
                            success = true;
                        }
                    } else if (cmd === 0x05) { // Write
                        const b = this.pifRam[i + 3];
                        if (b < 64) {
                            for (let j = 0; j < 8; j++) if (i + 4 + j < 64) this.eeprom[b * 8 + j] = this.pifRam[i + 4 + j];
                            if (res < 64) this.pifRam[res] = 0x00;
                            success = true;
                        }
                    }
                }

                if (!success && rl > 0) this.pifRam[i + 1] |= 0x80;
                else this.pifRam[i + 1] &= 0x3F;

                i += 2 + sl + rl;
                channel++;
            }
        }
        this.pifRam[0x3F] = 0;
    }

    doPiDma(c2d) {
        if (c2d && this.cpu) this.cpu.invalidateCache();
        const ra = this.piRegisters[0] & 0x007FFFFE;
        const cartAddr = this.piRegisters[1] & 0x1FFFFFFC;
        const len = ((c2d ? this.piRegisters[3] : this.piRegisters[2]) & 0x00FFFFFF) + 1;

        console.log(`PI DMA: ${c2d ? 'ROM->RAM' : 'RAM->ROM'} src=0x${cartAddr.toString(16)} dst=0x${ra.toString(16)} len=0x${len.toString(16)}`);

        this.piRegisters[4] |= 0x01; // Busy
        if (c2d && this.memory.rom) {
            const rd = new Uint8Array(this.memory.rdram);
            const rv = new Uint8Array(this.memory.rom);
            const rs = rv.length;
            const romOffset = (cartAddr & 0x1FFFFFFF) % rs; // Support mirrors up to 512MB

            for (let i = 0; i < len; i++) {
                if (ra + i >= 0x800000) break;
                rd[ra + i] = rv[(romOffset + i) % rs];
            }
        }
        this.piBusyUntil = (this.cpu ? this.cpu.instructionCount : 0) + len;
    }

    doSiDma(toPif) {
        if (!toPif && this.cpu) this.cpu.invalidateCache();
        const ra = this.siRegisters[0] & 0x007FFFFC;
        const rd = new Uint8Array(this.memory.rdram);
        this.siRegisters[6] |= 0x01;

        if (toPif) {
            for (let i = 0; i < 64; i++) {
                if (ra + i < rd.length && i < 64) this.pifRam[i] = rd[ra + i];
            }
            this.handlePifCommand();
        } else {
            for (let i = 0; i < 64; i++) {
                if (ra + i < rd.length && i < 64) rd[ra + i] = this.pifRam[i];
            }
        }
        this.siBusyUntil = (this.cpu ? this.cpu.instructionCount : 0) + 1100;
    }

    read8(a) {
        const p = this.translateAddress(a);
        if (p < 0x04000000) return this.memory.read8(p & 0x7FFFFF);
        if ((p >= 0x10000000 && p <= 0x1FBFFFFF) || (p >= 0x08000000 && p <= 0x0FFFFFFF)) {
            const romSize = this.memory.rom ? this.memory.rom.byteLength : 0x4000000;
            return this.memory.readRom8((p & 0x0FFFFFFF) % romSize);
        }
        const v = this.read32(p & ~3);
        return (v >>> ((3 - (p & 3)) * 8)) & 0xFF;
    }

    write8(a, v) {
        const p = this.translateAddress(a);
        if (p < 0x04000000) {
            this.memory.write8(p & 0x7FFFFF, v);
            if (this.cpu) this.cpu.invalidateCache();
        } else {
            const wordAddr = p & ~3;
            let val = this.read32(wordAddr);
            const shift = (3 - (p & 3)) * 8;
            val = (val & ~(0xFF << shift)) | ((v & 0xFF) << shift);
            this.write32(wordAddr, val >>> 0);
        }
    }

    read16(a) {
        const p = this.translateAddress(a);
        if (p < 0x04000000) return this.memory.read16(p & 0x7FFFFF);
        if ((p >= 0x10000000 && p <= 0x1FBFFFFF) || (p >= 0x08000000 && p <= 0x0FFFFFFF)) {
            const romSize = this.memory.rom ? this.memory.rom.byteLength : 0x4000000;
            return this.memory.readRom16((p & 0x0FFFFFFF) % romSize);
        }
        const v = this.read32(p & ~3);
        return (p & 2) ? (v & 0xFFFF) : (v >>> 16);
    }

    write16(a, v) {
        const p = this.translateAddress(a);
        if (p < 0x04000000) {
            this.memory.write16(p & 0x7FFFFF, v);
            if (this.cpu) this.cpu.invalidateCache();
        } else {
            const wordAddr = p & ~3;
            let val = this.read32(wordAddr);
            const shift = (p & 2) ? 0 : 16;
            val = (val & ~(0xFFFF << shift)) | ((v & 0xFFFF) << shift);
            this.write32(wordAddr, val >>> 0);
        }
    }

    read64(a) {
        const p = this.translateAddress(a);
        if (p < 0x04000000) return this.memory.read64(p & 0x7FFFFF);
        if ((p >= 0x10000000 && p <= 0x1FBFFFFF) || (p >= 0x08000000 && p <= 0x0FFFFFFF)) {
            const romSize = this.memory.rom ? this.memory.rom.byteLength : 0x4000000;
            return this.memory.readRom64((p & 0x0FFFFFFF) % romSize);
        }
        const hi = this.read32(p);
        const lo = this.read32(p + 4);
        return (BigInt(hi) << 32n) | BigInt(lo >>> 0);
    }

    write64(a, v) {
        const p = this.translateAddress(a);
        if (p < 0x04000000) {
            this.memory.write64(p & 0x7FFFFF, v);
            if (this.cpu) this.cpu.invalidateCache();
            return;
        }
        this.write32(p, Number(v >> 32n));
        this.write32(p + 4, Number(v & 0xFFFFFFFFn));
    }

    translateAddress(a) {
        const addr = (typeof a === 'bigint' ? Number(a & 0xFFFFFFFFn) : a) >>> 0;
        return (addr >= 0x80000000 && addr <= 0xBFFFFFFF) ? (addr & 0x1FFFFFFF) : addr;
    }
}
