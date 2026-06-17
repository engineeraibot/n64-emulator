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
        this.aiQueuedDuration = 0;
        this.viNextInterrupt = Number.MAX_SAFE_INTEGER;

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
        this.audioSink = null;       // optional callback(Int16Array stereo PCM, dacRate)
        this.lastAiSamples = null;   // most recent AI DMA PCM (verification / browser pull)
        this.aiSamplesEmitted = 0;
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
        this.controllerDebug = {
            infoReads: 0,
            buttonReads: 0,
            lastButtons: 0,
            lastStickX: 0,
            lastStickY: 0,
            pifCmdCalls: 0,
            lastPifCmdByte: 0,
            lastPifHead: [],
            channel0Cmds: 0,
            lastChannel0Cmd: 0,
            lastChannel0Sl: 0,
            lastChannel0Rl: 0
        };
        this.joybusChannels = new Array(5).fill(null);
        this.siDmaDirection = 0; // 0 none, 1 WR64B (RDRAM->PIF), 2 RD64B (PIF->RDRAM), 3 direct PIF write
        this.siDramAddr = 0;
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
                this.cpu.cp0Registers[13] |= 0x0400;
            } else {
                this.cpu.cp0Registers[13] &= ~0x0400;
            }
        }
    }

    readPifRamWord(offset) {
        let value = 0;
        for (let i = 0; i < 4; i++) {
            const idx = offset + i;
            value = (value << 8) | (idx < this.pifRam.length ? this.pifRam[idx] : 0);
        }
        return value >>> 0;
    }

    writePifRamWord(offset, value) {
        for (let i = 0; i < 4; i++) {
            const idx = offset + i;
            if (idx < this.pifRam.length) {
                this.pifRam[idx] = (value >>> ((3 - i) * 8)) & 0xFF;
            }
        }
    }

    checkInternalEvents() {
        const now = this.cpu ? this.cpu.instructionCount : 0;
        // Post-DMA PC tracing
        if (this._postDmaTrace && this.cpu) {
            const pc = (this.cpu.pc >>> 0);
            if (pc !== 0x8019ab54 && !this._postDmaSeenPc.has(pc)) {
                this._postDmaSeenPc.add(pc);
                if (this._postDmaSeenPc.size <= 50) {
                    /* [post-dma-pc] silenced */
                }
            }
            this._postDmaTraceCount += 128;
            if (this._postDmaTraceCount >= 5000000) {
                this._postDmaTrace = false;
                const rd32 = (addr) => {
                    const a = addr & 0x7FFFFF;
                    const b = new Uint8Array(this.memory.rdram);
                    return ((b[a]<<24)|(b[a+1]<<16)|(b[a+2]<<8)|b[a+3])>>>0;
                };
                /* silenced */
            }
        }

        // PI DMA completion
        if (this.piBusyUntil > 0 && now >= this.piBusyUntil) {
            this.piRegisters[4] &= ~0x03;
            this.piRegisters[4] |= 0x08;
            this.miRegisters[2] |= 0x10;
            this.piBusyUntil = 0;
            this.updateInterrupts();
        }

        // SI DMA completion
        if (this.siBusyUntil > 0 && now >= this.siBusyUntil) {
            if (this.siDmaDirection === 1 || this.siDmaDirection === 3) {
                this.handlePifCommand();
            } else if (this.siDmaDirection === 2) {
                this.copyPifToRdram(this.siDramAddr & 0x007FFFFC);
            }
            this.siDmaDirection = 0;
            this.siRegisters[6] &= ~(0x0001 | 0x0002);
            this.siRegisters[6] |= 0x1000;
            this.miRegisters[2] |= 0x02;
            this.siBusyUntil = 0;
            this.updateInterrupts();
        }

        // AI DMA completion
        if (this.aiBusyUntil > 0 && now >= this.aiBusyUntil) {
            this.miRegisters[2] |= 0x04;
            if (this.aiQueuedDuration > 0) {
                this.aiBusyUntil = now + this.aiQueuedDuration;
                this.aiQueuedDuration = 0;
                this.aiRegisters[3] = 0x40000000; // BUSY
            } else {
                this.aiBusyUntil = 0;
                this.aiRegisters[3] = 0;
            }
            this.updateInterrupts();
        }

        // VI Interrupt
        if (this.viRegisters[6] !== 0 && now >= this.viNextInterrupt) {
            this.miRegisters[2] |= 0x08;
            this.updateInterrupts();
            // Capture the finished front buffer being scanned out (the actually-displayed frame).
            if (this.rcp && this.rcp.captureDisplayedFrame) this.rcp.captureDisplayedFrame();
            // PAL is 50Hz, NTSC is 60Hz. SM64 PAL uses ~50Hz.
            if (this.rcp && (this.rcp.f3dTaskCount|0) >= 96 && this._viLogCount === undefined) {
                this._viLogCount = 0;
            }
            if (this._viLogCount !== undefined && this._viLogCount < 5) {
                this._viLogCount++;
                const epc = this.cpu ? (this.cpu.cp0Registers[14] >>> 0) : 0;
                const pc = this.cpu ? (this.cpu.pc >>> 0) : 0;
                /* [vi] silenced */
            }
            this.viNextInterrupt = now + (this.viRegisters[6] > 0x240 ? 1875000 : 1562500);
        }
    }

    read32(a) {
        const p = this.translateAddress(a);

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
            const idx = (p - 0x04600000) >> 2;
            if (idx === 2 || idx === 3) return 0x7F; // RD/WR length reads are open-bus style on N64.
            if (idx === 1) return this.piRegisters[idx] & 0xFFFFFFFE;
            if (idx === 0) return this.piRegisters[idx] & 0x00FFFFFE;
            if (idx === 4) {
                let status = this.piRegisters[idx];
                if (this.miRegisters[2] & 0x10) status |= 0x08;
                return status >>> 0;
            }
            return this.piRegisters[idx];
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
            if (regIdx === 3) return this.aiRegisters[3] >>> 0; // AI_STATUS (BUSY/FULL)
            return this.aiRegisters[regIdx];
        }

        // PIF RAM
        if (p >= 0x1FC007C0 && p <= 0x1FC007FF) return this.readPifRamWord(p - 0x1FC007C0);

        return 0;
    }

    write32(a, v) {
        const p = this.translateAddress(a);

        if (p < 0x04000000) {
            const physAddr = p & 0x7FFFFF;
            // Watchpoints on critical game-state globals
            if (physAddr === 0x2F971C || physAddr === 0x2F9718 || physAddr === 0x2F9720) {
                const pc = this.cpu ? (this.cpu.pc >>> 0) : 0;
                const f3d = this.rcp ? (this.rcp.f3dTaskCount|0) : -1;
                /* [gvar-write32] silenced */
            }
            this.memory.write32(p & 0x7FFFFF, v);
            if (this.cpu) this.cpu.invalidateCache();
        } else if (p >= 0x04000000 && p <= 0x04000FFF) {
            this.spDmemView.setUint32(p - 0x04000000, v, false);
        } else if (p >= 0x04001000 && p <= 0x04001FFF) {
            this.spImemView.setUint32(p - 0x04001000, v, false);
        } else if (p >= 0x04400000 && p <= 0x04400037) {
            const idx = (p - 0x04400000) >> 2;
            this.viRegisters[idx] = v;
            if (idx === 6) { // VI_V_SYNC programs the VI interrupt cadence.
                const now = this.cpu ? this.cpu.instructionCount : 0;
                const vSync = v & 0x3FF;
                this.viNextInterrupt = vSync ? (now + (vSync > 0x240 ? 1875000 : 1562500)) : Number.MAX_SAFE_INTEGER;
            }
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
                if (regIdx === 1) { // AI_LEN queues an audio DMA.
                    const now = this.cpu ? this.cpu.instructionCount : 0;
                    const len = (v & ~0x7) >>> 0;
                    if (len > 0) {
                        this.emitAudioBuffer(this.aiRegisters[0] >>> 0, len);
                        // Approximate DMA duration; enough fidelity for libultra queue semantics.
                        const duration = Math.max(1, len << 6);
                        if (this.aiBusyUntil > now) {
                            this.aiQueuedDuration = duration;
                            this.aiRegisters[3] = 0xC0000000; // BUSY|FULL
                        } else {
                            this.aiBusyUntil = now + duration;
                            this.aiQueuedDuration = 0;
                            this.aiRegisters[3] = 0x40000000; // BUSY
                        }
                    }
                }
            }
        } else if (p >= 0x04040000 && p <= 0x0404001F) {
            const idx = (p - 0x04040000) >> 2;
            if (idx === 7) {
                this.spRegisters[7] = 0; // SP_SEMAPHORE write clears it
            } else if (this.rcp) {
                // RCP owns SP register side effects such as SP DMA and task start.
                this.rcp.handleSpWrite(p, v);
            } else {
                this.spRegisters[idx] = v;
            }
        } else if (p >= 0x04100000 && p <= 0x0410001F) {
            const idx = (p - 0x04100000) >> 2;
            if (this.rcp) this.rcp.handleDpcWrite(p, v);
            else this.dpcRegisters[idx] = v;
        } else if (p >= 0x1FC007C0 && p <= 0x1FC007FF) {
            const offset = p - 0x1FC007C0;
            this.writePifRamWord(offset, v >>> 0);
            if (offset <= 0x3F && offset + 3 >= 0x3F) {
                this.siRegisters[6] &= ~0x1000;
                this.siRegisters[6] |= 0x0001 | 0x0002;
                this.siDmaDirection = 3;
                this.siBusyUntil = (this.cpu ? this.cpu.instructionCount : 0) + 3200;
            }
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

    // Forward the PCM block the game just handed to AI (16-bit signed big-endian
    // stereo at AI_DRAM_ADDR) to the host audio sink, if any, and stash it for
    // verification / browser pull. The audio RSP task (HLE in rcp.runAudioTask)
    // is what fills this buffer; before that work the buffer was always silent.
    emitAudioBuffer(dramAddr, lenBytes) {
        const base = dramAddr & 0x7FFFFF;
        const lim = this.memory.rdram.byteLength;
        const n = Math.min(lenBytes, lim - base) & ~1;
        if (n <= 0) return;
        const view = new DataView(this.memory.rdram);
        const pcm = new Int16Array(n >> 1);
        for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(base + i * 2, false);
        this.lastAiSamples = pcm;
        this.aiSamplesEmitted += pcm.length;
        const dacRate = this.aiRegisters[4] >>> 0; // AI_DACRATE (reg 0x10; [2] is AI_CONTROL - Task #42 fix)
        if (typeof this.audioSink === 'function') {
            try { this.audioSink(pcm, dacRate); } catch (e) { /* sink errors must not break emulation */ }
        }
    }

    handlePiWrite(a, v) {
        const idx = (a - 0x04600000) >> 2;
        if (idx === 4) { // PI_STATUS
            if (v & 0x01) { // Reset PI
                this.piRegisters[4] = 0;
                this.piBusyUntil = 0;
            }
            if (v & 0x02) { // Clear PI Interrupt
                this.piRegisters[4] &= ~0x08;
                this.miRegisters[2] &= ~0x10;
            }
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
            this.siRegisters[6] &= ~0x1000;
            this.miRegisters[2] &= ~0x02;
            this.updateInterrupts();
        } else {
            this.siRegisters[idx] = v;
            if (idx === 1 || idx === 4) this.doSiDma(idx === 4);
        }
    }

    handlePifCommand() {
        const cmdByte = this.pifRam[0x3F];
        this.controllerDebug.pifCmdCalls++;
        this.controllerDebug.lastPifCmdByte = cmdByte & 0xFF;
        this.controllerDebug.lastPifHead = Array.from(this.pifRam.slice(0, 16));
        if (cmdByte === 0) return;

        let clearMask = 0;
        if (cmdByte & 0x01) {
            // Configure Joybus channel layout.
            this.parseJoybusChannels();
            clearMask |= 0x01;
        }
        if (cmdByte & 0x02) {
            // CIC challenge/response is not needed for the current boot path.
            clearMask |= 0x02;
        }
        if (cmdByte & 0x08) {
            // End of boot process.
            clearMask |= 0x08;
        }
        if (cmdByte & 0x10) {
            // ROM lockout request.
            this.pifRom.fill(0);
        }
        if (cmdByte & 0x20) {
            // Checksum acquire response.
            this.pifRam[0x3F] = 0x80;
        }
        this.pifRam[0x3F] &= (~clearMask) & 0xFF;
    }

    hasJoybusChannels(channels) {
        for (const ch of channels) {
            if (ch) return true;
        }
        return false;
    }

    decodeJoybusChannels() {
        const channels = new Array(5).fill(null);
        let i = 0;
        let channel = 0;
        while (i < 0x3F && channel < 5) {
            const entry = this.pifRam[i] & 0xFF;
            if (entry === 0x00) {
                // Skip channel.
                channel++;
                i++;
                continue;
            }
            if (entry === 0xFF) {
                // Dummy byte.
                i++;
                continue;
            }
            if (entry === 0xFE) {
                // End of channel setup.
                break;
            }
            if (entry === 0xFD) {
                // Channel reset marker.
                channel++;
                i++;
                continue;
            }
            if (i + 1 < 64 && this.pifRam[i + 1] === 0xFE) {
                // Some games emit a bogus byte before the terminator.
                i++;
                continue;
            }
            if (i + 2 >= 64) break;

            const sl = this.pifRam[i] & 0x3F;
            const rl = this.pifRam[i + 1] & 0x3F;
            const tx = i + 2;
            const rx = tx + sl;
            if (tx >= 64 || rx >= 64) break;
            channels[channel] = {
                channel,
                txLenOffset: i,
                rxLenOffset: i + 1,
                tx,
                rx,
                sl,
                rl
            };
            i += 2 + sl + rl;
            channel++;
        }
        return channels;
    }

    parseJoybusChannels() {
        const parsed = this.decodeJoybusChannels();
        if (this.hasJoybusChannels(parsed)) {
            this.joybusChannels = parsed;
        }
        return parsed;
    }

    processJoybusRead() {
        // Decode the packet layout on each transfer. If a malformed packet has no
        // channels, keep using the last valid deterministic layout.
        const parsed = this.parseJoybusChannels();
        const channels = this.hasJoybusChannels(parsed) ? parsed : this.joybusChannels;

        let activeChannels = 0;
        for (const ch of channels) {
            if (!ch) continue;
            this.pifRam[ch.txLenOffset] &= 0x3F;
            this.pifRam[ch.rxLenOffset] &= 0x3F;

            let success = false;
            const cmd = (ch.tx < 64 ? this.pifRam[ch.tx] : 0) & 0xFF;
            const res = ch.rx;
            let hasDevice = false;

            if (ch.channel === 0) {
                this.controllerDebug.channel0Cmds++;
                this.controllerDebug.lastChannel0Cmd = cmd;
                this.controllerDebug.lastChannel0Sl = ch.sl & 0x3F;
                this.controllerDebug.lastChannel0Rl = ch.rl & 0x3F;
            }

            if (ch.channel < 4) {
                if (ch.channel === 0) {
                    hasDevice = true;
                    if (cmd === 0x00 || cmd === 0xFF) {
                        if (res + 2 < 64) {
                            // Report standard controller type.
                            this.pifRam[res] = 0x00;
                            this.pifRam[res + 1] = 0x05;
                            // Controller present, no pak flags set.
                            this.pifRam[res + 2] = 0x00;
                            this.controllerDebug.infoReads++;
                            success = true;
                        }
                    } else if (cmd === 0x01) {
                        if (res + 3 < 64) {
                            this.pifRam[res] = (this.buttons >> 8) & 0xFF;
                            this.pifRam[res + 1] = this.buttons & 0xFF;
                            this.pifRam[res + 2] = this.stickX & 0xFF;
                            this.pifRam[res + 3] = this.stickY & 0xFF;
                            this.controllerDebug.buttonReads++;
                            this.controllerDebug.lastButtons = this.buttons & 0xFFFF;
                            this.controllerDebug.lastStickX = this.stickX | 0;
                            this.controllerDebug.lastStickY = this.stickY | 0;
                            success = true;
                        }
                    }
                }
            } else {
                hasDevice = true;
                if (cmd === 0x00 || cmd === 0xFF) {
                    if (res + 2 < 64) {
                        this.pifRam[res] = 0x00;
                        this.pifRam[res + 1] = 0x80;
                        this.pifRam[res + 2] = 0x00;
                        success = true;
                    }
                } else if (cmd === 0x04) {
                    const b = this.pifRam[ch.tx + 1] & 0xFF;
                    if (b < 64) {
                        for (let j = 0; j < 8 && (res + j) < 64; j++) {
                            this.pifRam[res + j] = this.eeprom[b * 8 + j];
                        }
                        success = true;
                    }
                } else if (cmd === 0x05) {
                    const b = this.pifRam[ch.tx + 1] & 0xFF;
                    if (b < 64) {
                        for (let j = 0; j < 8 && (ch.tx + 2 + j) < 64; j++) {
                            this.eeprom[b * 8 + j] = this.pifRam[ch.tx + 2 + j];
                        }
                        if (res < 64) this.pifRam[res] = 0x00;
                        success = true;
                    }
                }
            }

            if (hasDevice) activeChannels++;
            if (!success && ch.rl > 0) this.pifRam[ch.rxLenOffset] |= 0x80;
        }
        return activeChannels;
    }

    copyPifToRdram(dramAddr) {
        const rd = new Uint8Array(this.memory.rdram);
        for (let i = 0; i < 64; i++) {
            if (dramAddr + i < rd.length) rd[dramAddr + i] = this.pifRam[i];
        }
    }

    copyRdramToPif(dramAddr) {
        const rd = new Uint8Array(this.memory.rdram);
        for (let i = 0; i < 64; i++) {
            if (dramAddr + i < rd.length) this.pifRam[i] = rd[dramAddr + i];
        }
    }

    doPiDma(c2d) {
        if (c2d && this.cpu) this.cpu.invalidateCache();
        const ra = this.piRegisters[0] & 0x007FFFFE;
        const cartAddr = this.piRegisters[1] & 0x1FFFFFFE;
        const lenReg = c2d ? this.piRegisters[3] : this.piRegisters[2];
        let len = (lenReg & 0x00FFFFFF) + 1;

        // Match PI odd-length behavior used by libultra DMA setup.
        if (len >= 0x7F && (len & 1)) len++;
        if (c2d && len <= 0x80) len -= (ra & 0x7);
        if (len <= 0) len = 1;

        this.piRegisters[4] |= 0x01; // Busy
        this.piRegisters[4] &= ~0x08; // Clear PI interrupt latch while DMA is active.
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
        // PI increments DRAM/CART pointers after each DMA transfer.
        this.piRegisters[0] = (this.piRegisters[0] + len + 7) & ~7;
        this.piRegisters[1] = (this.piRegisters[1] + len + 1) & ~1;
        if (this.rcp && (this.rcp.f3dTaskCount|0) >= 96) {
            const pc2 = this.cpu ? (this.cpu.pc >>> 0) : 0;
            if (!this._piDmaCount) this._piDmaCount = 0;
            this._piDmaCount++;
            if (this._piDmaCount <= 200)
                /* silenced */
            if (this._piDmaCount === 126 && this.cpu && this.memory) {
                // After last DMA: enable PC tracing for next 200k instructions
                this._postDmaTrace = true;
                this._postDmaTraceCount = 0;
                this._postDmaSeenPc = new Set();
                const rd32 = (addr) => {
                    const a = addr & 0x7FFFFF;
                    const b = new Uint8Array(this.memory.rdram);
                    return ((b[a]<<24)|(b[a+1]<<16)|(b[a+2]<<8)|b[a+3])>>>0;
                };
                let seg = '';
                for (let ii=0; ii<16; ii+=4) seg += '0x' + rd32(0x16f000+ii).toString(16).padStart(8,'0') + ' ';
                /* silenced */
                /* silenced */
            }
        }
        this.piBusyUntil = (this.cpu ? this.cpu.instructionCount : 0) + len;

        // Log ALL PI DMAs from boot (first 300)
        if (!this._totalPiDmaCount) this._totalPiDmaCount = 0;
        this._totalPiDmaCount++;
        const pc2 = this.cpu ? (this.cpu.pc >>> 0) : 0;
        const f3d2 = this.rcp ? (this.rcp.f3dTaskCount|0) : -1;
        if (this._totalPiDmaCount <= 300) {
            /* [pidma-all] silenced */
        }
        if (this._totalPiDmaCount === 200) {
            console.log('[pidma-all] reached 200 DMAs, f3d=' + f3d2 + ' RDRAM[0x802F971C]=0x' + (()=>{
                const b = new Uint8Array(this.memory.rdram);
                const a = 0x2F971C;
                return (((b[a]<<24)|(b[a+1]<<16)|(b[a+2]<<8)|b[a+3])>>>0).toString(16);
            })());
        }
    }

    doSiDma(toPif) {
        if (!toPif && this.cpu) this.cpu.invalidateCache();
        const ra = this.siRegisters[0] & 0x007FFFFC;
        this.siRegisters[6] &= ~0x1000;
        this.siRegisters[6] |= 0x0001;
        this.siDramAddr = ra;

        let duration = 6000;
        if (toPif) {
            this.copyRdramToPif(ra);
            this.siDmaDirection = 1;
        } else {
            const activeChannels = this.processJoybusRead();
            this.siDmaDirection = 2;
            duration = 24000 + activeChannels * 30000;
        }
        this.siBusyUntil = (this.cpu ? this.cpu.instructionCount : 0) + duration;
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
        // kseg0/kseg1: direct (unmapped) physical mapping.
        if (addr >= 0x80000000 && addr <= 0xBFFFFFFF) return addr & 0x1FFFFFFF;
        // kuseg (and kseg2/kseg3): TLB-mapped. Goddard maps virtual 0x04000000+
        // (64K pages) onto physical RDRAM via osMapTLB. Consult the TLB; on a miss
        // fall back to identity (preserves prior behavior for direct register pokes).
        const tlb = this.cpu && this.cpu.tlbEntries;
        if (tlb) {
            for (let i = 0; i < 32; i++) {
                const e = tlb[i];
                if (!e) continue;
                const mask = (((e.pageMask & 0x01FFE000) | 0x1FFF) >>> 0);
                const vpnMask = (~mask) >>> 0;
                if (((addr & vpnMask) >>> 0) !== ((e.entryHi & vpnMask) >>> 0)) continue;
                const oddBit = ((mask + 1) >>> 1) >>> 0;
                const lo = (oddBit && (addr & oddBit)) ? e.entryLo1 : e.entryLo0;
                if (!(lo & 0x2)) continue; // V (valid) bit clear
                const pfn = (lo >>> 6) & 0xFFFFFF;
                const offMask = (oddBit ? (oddBit - 1) : mask) >>> 0;
                return (((pfn << 12) >>> 0) + (addr & offMask)) >>> 0;
            }
        }
        return addr;
    }
}
