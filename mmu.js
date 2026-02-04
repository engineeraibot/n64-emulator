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
        this.piBusyUntil = 0;
        this.siBusyUntil = 0;
        this.aiBusyUntil = 0;
        this.viNextInterrupt = 0;
        this.viRegisters = new Uint32Array(14);
        this.miRegisters = new Uint32Array(4);
        this.piRegisters = new Uint32Array(13);
        this.siRegisters = new Uint32Array(7);
        this.spRegisters = new Uint32Array(8);
        this.dpcRegisters = new Uint32Array(8);
        this.aiRegisters = new Uint32Array(6);
        this.riRegisters = new Uint32Array(8);
        this.riRegisters[0] = 0x0;       // RI_MODE
        this.riRegisters[1] = 0x0;       // RI_CONFIG
        this.riRegisters[2] = 0x0;       // RI_CURRENT_LOAD
        this.riRegisters[3] = 0x14;      // RI_SELECT (Indicates 8MB)
        this.riRegisters[4] = 0x63634;   // RI_REFRESH
        this.pifRom = new Uint8Array(2048); // 2KB PIF ROM
        this.pifRomView = new DataView(this.pifRom.buffer);
        this.pifRam = new Uint8Array(64);
        this.pifRamView = new DataView(this.pifRam.buffer);
        this.spDmem = new Uint8Array(0x1000);
        this.spDmemView = new DataView(this.spDmem.buffer);
        this.spImem = new Uint8Array(0x1000);
        this.spImemView = new DataView(this.spImem.buffer);
        this.buttons = 0;
        this.stickX = 0;
        this.stickY = 0;
        this.eeprom = new Uint8Array(512);
    }

    updateController(buttons, x, y) {
        this.buttons = buttons;
        this.stickX = x;
        this.stickY = y;
    }

    updateInterrupts() {
        if (this.cpu) {
            const mi_intr = this.miRegisters[2] & this.miRegisters[3];
            if (mi_intr) this.cpu.cp0Registers[13] |= 0x0400n;
            else this.cpu.cp0Registers[13] &= ~0x0400n;
        }
    }

    checkInternalEvents() {
        const now = this.cpu ? this.cpu.instructionCount : 0;
        let changed = false;
        if (this.piBusyUntil > 0 && now >= this.piBusyUntil) {
            this.piRegisters[4] &= ~0x03;
            this.miRegisters[2] |= 0x10; // Trigger interrupt
            this.piBusyUntil = 0;
            console.log(`PI DMA Completed (Event) MI_INTR=0x${this.miRegisters[2].toString(16)}`);
            changed = true;
        }
        if (this.siBusyUntil > 0 && now >= this.siBusyUntil) {
            this.siRegisters[6] &= ~0x01; // Not busy
            this.miRegisters[2] |= 0x02;  // SI Interrupt
            this.siBusyUntil = 0;
            console.log(`SI DMA Completed (Event) MI_INTR=0x${this.miRegisters[2].toString(16)}`);
            changed = true;
        }
        if (this.aiBusyUntil > 0 && now >= this.aiBusyUntil) {
            this.miRegisters[2] |= 0x04; // AI Interrupt
            this.aiBusyUntil = 0;
            console.log(`AI DMA Completed (Event) MI_INTR=0x${this.miRegisters[2].toString(16)}`);
            changed = true;
        }
        if (now >= this.viNextInterrupt) {
            if (!(this.miRegisters[2] & 0x08)) {
                this.miRegisters[2] |= 0x08; // VI Interrupt
                // console.log(`VI Interrupt Triggered at Count ${now}`);
                changed = true;
            }
            // Detect PAL vs NTSC for timing
            const isPal = (this.viRegisters[6] > 600); // Usually 625 for PAL
            const interval = isPal ? 1250000 : 1041666; // 50Hz or 60Hz
            this.viNextInterrupt = now + interval;
        }
        if (changed) this.updateInterrupts();
    }

    read8(address) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) return this.memory.read8(physicalAddress);
        else if (physicalAddress >= MMU.ROM_START && physicalAddress <= MMU.ROM_END) return this.memory.readRom8(physicalAddress - MMU.ROM_START);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) return this.spDmemView.getUint8(physicalAddress - MMU.SP_DMEM_START);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) return this.spImemView.getUint8(physicalAddress - MMU.SP_IMEM_START);
        else if (physicalAddress >= MMU.PIF_ROM_START && physicalAddress <= MMU.PIF_ROM_END) return this.pifRomView.getUint8(physicalAddress - MMU.PIF_ROM_START);
        else if (physicalAddress >= MMU.PIF_RAM_START && physicalAddress <= MMU.PIF_RAM_END) return this.pifRamView.getUint8(physicalAddress - MMU.PIF_RAM_START);
        return 0;
    }
    write8(address, value) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) this.memory.write8(physicalAddress, value);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) this.spDmemView.setUint8(physicalAddress - MMU.SP_DMEM_START, value);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) this.spImemView.setUint8(physicalAddress - MMU.SP_IMEM_START, value);
        else if (physicalAddress >= MMU.PIF_RAM_START && physicalAddress <= MMU.PIF_RAM_END) {
            this.pifRam[physicalAddress - MMU.PIF_RAM_START] = value;
            if (physicalAddress === MMU.PIF_RAM_END) this.handlePifCommand();
        }
        else {
            // Basic support for 8-bit register writes if needed
            const val32 = this.read32(address & ~3);
            const shift = (3 - (physicalAddress & 3)) * 8;
            const mask = ~(0xFF << shift);
            this.write32(address & ~3, (val32 & mask) | (value << shift));
        }
    }
    read16(address) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) return this.memory.read16(physicalAddress);
        else if (physicalAddress >= MMU.ROM_START && physicalAddress <= MMU.ROM_END) return this.memory.readRom16(physicalAddress - MMU.ROM_START);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) return this.spDmemView.getUint16(physicalAddress - MMU.SP_DMEM_START, false);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) return this.spImemView.getUint16(physicalAddress - MMU.SP_IMEM_START, false);
        else if (physicalAddress >= MMU.PIF_ROM_START && physicalAddress <= MMU.PIF_ROM_END) return this.pifRomView.getUint16(physicalAddress - MMU.PIF_ROM_START, false);
        else if (physicalAddress >= MMU.PIF_RAM_START && physicalAddress <= MMU.PIF_RAM_END) return this.pifRamView.getUint16(physicalAddress - MMU.PIF_RAM_START, false);
        return 0;
    }
    write16(address, value) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) this.memory.write16(physicalAddress, value);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) this.spDmemView.setUint16(physicalAddress - MMU.SP_DMEM_START, value, false);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) this.spImemView.setUint16(physicalAddress - MMU.SP_IMEM_START, value, false);
        else if (physicalAddress >= MMU.PIF_RAM_START && physicalAddress <= MMU.PIF_RAM_END) {
            this.pifRamView.setUint16(physicalAddress - MMU.PIF_RAM_START, value, false);
            if (physicalAddress >= MMU.PIF_RAM_END - 1) this.handlePifCommand();
        }
        else {
            // Basic support for 16-bit register writes
            const val32 = this.read32(address & ~3);
            if (physicalAddress & 2) {
                this.write32(address & ~3, (val32 & 0xFFFF0000) | (value & 0xFFFF));
            } else {
                this.write32(address & ~3, (val32 & 0x0000FFFF) | ((value & 0xFFFF) << 16));
            }
        }
    }
    read32(address) {
        const physicalAddress = this.translateAddress(address);
        if (physicalAddress >= 0x04000000 && physicalAddress <= 0x0480001B) {
            // Log hardware register reads, but not too frequently
            if ((this.cpu.instructionCount & 0xFFFF) === 0) {
                 // console.log(`MMU Read Reg: 0x${physicalAddress.toString(16)}`);
            }
        }
        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) return this.memory.read32(physicalAddress);
        else if (physicalAddress >= MMU.ROM_START && physicalAddress <= MMU.ROM_END) return this.memory.readRom32(physicalAddress - MMU.ROM_START);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) return this.spDmemView.getUint32(physicalAddress - MMU.SP_DMEM_START, false);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) return this.spImemView.getUint32(physicalAddress - MMU.SP_IMEM_START, false);
        else if (physicalAddress >= MMU.VI_REGS_START && physicalAddress <= MMU.VI_REGS_END) {
            const regIdx = (physicalAddress - MMU.VI_REGS_START) >> 2;
            if (regIdx === 4) { // VI_CURRENT_REG
                const sync = this.viRegisters[6] || 525;
                return (Math.floor((this.cpu ? this.cpu.instructionCount : 0) / 3000) % sync);
            }
            return this.viRegisters[regIdx];
        }
        else if (physicalAddress >= MMU.PI_REGS_START && physicalAddress <= MMU.PI_REGS_END) {
            const regIdx = (physicalAddress - MMU.PI_REGS_START) >> 2;
            if (regIdx === 4) {
                this.checkInternalEvents();
                let status = this.piRegisters[4];
                if (this.miRegisters[2] & 0x10) status |= 0x08; // Interrupt pending bit
                return status;
            }
            return this.piRegisters[regIdx];
        }
        else if (physicalAddress >= MMU.MI_REGS_START && physicalAddress <= MMU.MI_REGS_END) {
            const regIdx = (physicalAddress - MMU.MI_REGS_START) >> 2;
            if (regIdx === 1) return 0x02020102; // MI_VERSION
            if (regIdx === 2) {
                this.checkInternalEvents();
            }
            return this.miRegisters[regIdx];
        }
        else if (physicalAddress >= MMU.SI_REGS_START && physicalAddress <= MMU.SI_REGS_END) return this.siRegisters[(physicalAddress - MMU.SI_REGS_START) >> 2];
        else if (physicalAddress >= MMU.SP_REGS_START && physicalAddress <= MMU.SP_REGS_END) return this.spRegisters[(physicalAddress - MMU.SP_REGS_START) >> 2];
        else if (physicalAddress >= MMU.DPC_REGS_START && physicalAddress <= MMU.DPC_REGS_END) return this.dpcRegisters[(physicalAddress - MMU.DPC_REGS_START) >> 2];
        else if (physicalAddress >= MMU.AI_REGS_START && physicalAddress <= MMU.AI_REGS_START + 0x17) {
            const regIdx = (physicalAddress - MMU.AI_REGS_START) >> 2;
            if (regIdx === 1) { // AI_LEN_REG
                const now = this.cpu ? this.cpu.instructionCount : 0;
                if (this.aiBusyUntil > now) return Number(this.aiBusyUntil - now);
                return 0;
            }
            if (regIdx === 3) { // AI_STATUS_REG
                let status = 0;
                if (this.aiBusyUntil > (this.cpu ? this.cpu.instructionCount : 0)) {
                    status |= 0x40000000; // AI Busy (bit 30)
                }
                return status;
            }
            return this.aiRegisters[regIdx];
        }
        else if (physicalAddress >= MMU.RI_REGS_START && physicalAddress <= MMU.RI_REGS_START + 0x1F) return this.riRegisters[(physicalAddress - MMU.RI_REGS_START) >> 2];
        else if (physicalAddress >= MMU.PIF_ROM_START && physicalAddress <= MMU.PIF_ROM_END) return this.pifRomView.getUint32(physicalAddress - MMU.PIF_ROM_START, false);
        else if (physicalAddress >= MMU.PIF_RAM_START && physicalAddress <= MMU.PIF_RAM_END) return this.pifRamView.getUint32(physicalAddress - MMU.PIF_RAM_START, false);

        return 0;
    }
    write32(address, value) {
        const physicalAddress = this.translateAddress(address);

        // Detailed logging for hardware registers
        if (physicalAddress >= 0x04000000 && physicalAddress <= 0x048000FF) {
             console.log(`HW Write: 0x${physicalAddress.toString(16)} = 0x${value.toString(16)}`);
        }

        if (physicalAddress >= MMU.RDRAM_START && physicalAddress <= MMU.RDRAM_END) this.memory.write32(physicalAddress, value);
        else if (physicalAddress >= MMU.SP_DMEM_START && physicalAddress <= MMU.SP_DMEM_END) this.spDmemView.setUint32(physicalAddress - MMU.SP_DMEM_START, value, false);
        else if (physicalAddress >= MMU.SP_IMEM_START && physicalAddress <= MMU.SP_IMEM_END) this.spImemView.setUint32(physicalAddress - MMU.SP_IMEM_START, value, false);
        else if (physicalAddress >= MMU.VI_REGS_START && physicalAddress <= MMU.VI_REGS_END) {
            const regIdx = (physicalAddress - MMU.VI_REGS_START) >> 2;
            console.log(`VI Write: Reg ${regIdx} = 0x${value.toString(16)}`);
            this.viRegisters[regIdx] = value;
            if (regIdx === 4) { // VI_CURRENT_REG
                if (this.miRegisters[2] & 0x08) {
                    console.log("VI Interrupt Cleared");
                    this.miRegisters[2] &= ~0x08; // Clear VI Interrupt
                    this.updateInterrupts();
                }
            }
        }
        else if (physicalAddress >= MMU.PI_REGS_START && physicalAddress <= MMU.PI_REGS_END) this.handlePiWrite(physicalAddress, value);
        else if (physicalAddress >= MMU.MI_REGS_START && physicalAddress <= MMU.MI_REGS_END) this.handleMiWrite(physicalAddress, value);
        else if (physicalAddress >= MMU.SI_REGS_START && physicalAddress <= MMU.SI_REGS_END) this.handleSiWrite(physicalAddress, value);
        else if (physicalAddress >= MMU.SP_REGS_START && physicalAddress <= MMU.SP_REGS_END) {
            console.log(`SP Reg Write: 0x${physicalAddress.toString(16)} = 0x${value.toString(16)}`);
            if (this.rcp) this.rcp.handleSpWrite(physicalAddress, value);
            else this.spRegisters[(physicalAddress - MMU.SP_REGS_START) >> 2] = value;
        }
        else if (physicalAddress >= MMU.DPC_REGS_START && physicalAddress <= MMU.DPC_REGS_END) {
            console.log(`DPC Reg Write: 0x${physicalAddress.toString(16)} = 0x${value.toString(16)}`);
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
        this.updateInterrupts();
    }

    handlePiWrite(address, value) {
        const regIdx = (address - MMU.PI_REGS_START) >> 2;
        console.log(`PI Write: Reg ${regIdx} = 0x${value.toString(16)}`);
        if (regIdx === 4) { // PI_STATUS_REG
            if (value & 0x01) { /* reset controller */ }
            if (value & 0x02) {
                console.log("PI Interrupt Cleared");
                this.miRegisters[2] &= ~0x10; // Clear PI interrupt
            }
            this.updateInterrupts();
        } else {
            this.piRegisters[regIdx] = value;
            if (regIdx === 2) this.doPiDma(false); // DRAM -> Cart
            if (regIdx === 3) this.doPiDma(true);  // Cart -> DRAM
        }
    }

    handleSiWrite(address, value) {
        const regIdx = (address - MMU.SI_REGS_START) >> 2;
        console.log(`SI Write: Reg ${regIdx} = 0x${value.toString(16)}`);
        if (regIdx === 6) { // SI_STATUS_REG
             this.miRegisters[2] &= ~0x02; // Clear SI interrupt
             this.updateInterrupts();
             return;
        }
        this.siRegisters[regIdx] = value;
        if (regIdx === 1 || regIdx === 4) this.doSiDma(regIdx === 4);
    }

    handleAiWrite(address, value) {
        const regIdx = (address - MMU.AI_REGS_START) >> 2;
        if (regIdx === 3) { // AI_STATUS_REG
            this.miRegisters[2] &= ~0x04; // Clear AI Interrupt
            this.updateInterrupts();
            return;
        }
        this.aiRegisters[regIdx] = value;
        if (regIdx === 1) { // AI_LEN_REG
            // Simulate DMA completion with a delay
            this.aiBusyUntil = (this.cpu ? this.cpu.instructionCount : 0) + 50000;
        } else if (regIdx === 2) { // AI_CONTROL_REG
            if (value & 0x01) { /* DMA Enable */ }
        }
    }

    handlePifCommand() {
        console.log(`PIF Command Triggered: 0x${this.pifRam[0x3f].toString(16)}`);
        if (this.pifRam[0x3F] === 0x08) {
            console.log("PIF RAM: " + Array.from(this.pifRam.subarray(0, 16)).map(x => x.toString(16)).join(' '));
            // Some games use 0x08 for PIF status check
            this.pifRam[0x3F] = 0x00;
            return;
        }
        if (this.pifRam[0x3F] === 0x01) {
            // Basic HLE PIF command handling
            let i = 0;
            while (i < 0x3F) {
                if (this.pifRam[i] === 0xFF) { i++; continue; }
                if (this.pifRam[i] === 0x00 || this.pifRam[i] === 0xFE) break;

                const sendLen = this.pifRam[i] & 0x3F;
                const recvLen = this.pifRam[i+1] & 0x3F;
                if (sendLen === 0) { i += 2; continue; }
                const cmd = this.pifRam[i+2];
                const resIdx = i + 2 + sendLen;
                if (resIdx >= 64) break;

                console.log(`PIF CMD: 0x${cmd.toString(16)} send=${sendLen} recv=${recvLen}`);
                if (cmd === 0x01 || cmd === 0xFF || cmd === 0x00) { // Read Controller or Info
                    if (cmd === 0x00 || cmd === 0xFF) { // Info
                        if (resIdx < 64) this.pifRam[resIdx] = 0x05;
                        if (resIdx + 1 < 64) this.pifRam[resIdx+1] = 0x00;
                        if (resIdx + 2 < 64) this.pifRam[resIdx+2] = 0x01;
                    } else { // Read
                        if (resIdx < 64) this.pifRam[resIdx] = (this.buttons >> 8) & 0xFF;
                        if (resIdx + 1 < 64) this.pifRam[resIdx+1] = this.buttons & 0xFF;
                        if (resIdx + 2 < 64) this.pifRam[resIdx+2] = this.stickX & 0xFF;
                        if (resIdx + 3 < 64) this.pifRam[resIdx+3] = this.stickY & 0xFF;
                    }
                } else if (cmd === 0x04) { // EEPROM Read
                    const block = this.pifRam[i+3];
                    if (block < 64) {
                        for (let j = 0; j < 8; j++) {
                            if (resIdx + j < 64) this.pifRam[resIdx+j] = this.eeprom[block * 8 + j];
                        }
                    }
                } else if (cmd === 0x05) { // EEPROM Write
                    const block = this.pifRam[i+3];
                    if (block < 64) {
                        for (let j = 0; j < 8; j++) {
                            if (i+4+j < 64) this.eeprom[block * 8 + j] = this.pifRam[i+4+j];
                        }
                    }
                    if (resIdx < 64) this.pifRam[resIdx] = 0; // Success
                } else if (cmd === 0x02 || cmd === 0x03) { // Write/Read Status
                    for (let j = 0; j < recvLen; j++) {
                        if (resIdx + j < 64) this.pifRam[resIdx+j] = 0;
                    }
                } else {
                    // Unknown command, skip it to avoid getting stuck
                    console.warn(`Unknown PIF Joybus command: 0x${cmd.toString(16)}`);
                }
                // Support for end-of-block marker
                if (resIdx + recvLen < 64) {
                    this.pifRam[resIdx + recvLen] = 0xFE;
                }
                i += 2 + sendLen + recvLen;
            }
            this.pifRam[0x3F] = 0;
        }
    }

    doPiDma(cartToDram) {
        const ramAddr = this.piRegisters[0] & 0x007FFFFF; // Mask for 8MB RDRAM
        const cartAddr = this.piRegisters[1] & 0x1FFFFFFF;
        // Mask length to 24 bits
        const length = ((cartToDram ? (this.piRegisters[3] & 0x00FFFFFF) : (this.piRegisters[2] & 0x00FFFFFF))) + 1;

        const romOffsetBase = cartAddr & 0x0FFFFFFF;
        console.log(`PI DMA started: ${cartToDram ? 'ROM->RAM' : 'RAM->ROM'} RAM=0x${ramAddr.toString(16)} Cart=0x${cartAddr.toString(16)} (Offset: 0x${romOffsetBase.toString(16)}) Len=0x${length.toString(16)}`);
        this.piRegisters[4] |= 0x03; // DMA Busy and IO Busy

        if (cartToDram && this.memory.rom) {
            const rdramView = new Uint8Array(this.memory.rdram);
            const romView = new Uint8Array(this.memory.rom);
            const romSize = this.memory.rom.byteLength;

            // Use lower 28 bits as offset and apply mirroring by ROM size.
            // This handles standard Domain 1 (0x10000000) and various mirrors (Domain 2, etc.)
            const romOffsetBase = cartAddr & 0x0FFFFFFF;

            // Optimized copy loop: only iterate up to available RDRAM space
            const limit = Math.min(length, rdramView.length - ramAddr);
            for (let i = 0; i < limit; i++) {
                const dst = ramAddr + i;
                let src = (romOffsetBase + i) % romSize; // Apply mirroring
                rdramView[dst] = romView[src];
            }
            const firstBytes = Array.from(rdramView.subarray(ramAddr, Math.min(ramAddr + 16, rdramView.length))).map(x => x.toString(16).padStart(2, '0')).join(' ');
            console.log(`PI DMA Completed: copied ${limit} bytes (requested ${length}) to RAM 0x${ramAddr.toString(16)} (Offset: 0x${romOffsetBase.toString(16)}). First 16 bytes: ${firstBytes}`);
        }

        // Simulate DMA delay (More realistic timing for PI DMA)
        // 5MB/s -> ~18 bytes per instruction at 93.75MHz
        // We use a smaller factor to ensure the game doesn't wait too long in the emulator.
        this.piBusyUntil = (this.cpu ? this.cpu.instructionCount : 0) + (length >> 2);
    }

    doSiDma(isToPif) {
        const ramAddr = this.siRegisters[0] & 0x007FFFFF; // Mask to 8MB
        const rdramView = new Uint8Array(this.memory.rdram);
        this.siRegisters[6] |= 0x01; // Busy

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
        // SI DMA takes ~4k-10k instructions for 64 bytes
        this.siBusyUntil = (this.cpu ? this.cpu.instructionCount : 0) + 5000;
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
        if (typeof address === 'bigint') {
            address = Number(address & 0xFFFFFFFFn) >>> 0;
        } else {
            address = address >>> 0;
        }
        // KSEG0 & KSEG1 map to physical 0x00000000 - 0x1FFFFFFF
        if (address >= 0x80000000 && address <= 0xBFFFFFFF) {
            return address & 0x1FFFFFFF;
        }
        return address;
    }
}
