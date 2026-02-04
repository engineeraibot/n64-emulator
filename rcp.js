class RCP {
    constructor(mmu, framebuffer) {
        console.log("RCP Initialized");
        this.mmu = mmu;
        this.framebuffer = framebuffer;
        this.tmem = new Uint8Array(4096);
        this.rdpCommandCount = 0;
        this.reset();
    }

    reset() {
        console.log("RCP Reset");
        this.rdpCommandCount = 0;
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
            const oldStatus = this.mmu.spRegisters[4];
            console.log(`SP_STATUS Write: 0x${value.toString(16)} (Old: 0x${oldStatus.toString(16)}) PC=0x${this.mmu.cpu.pc.toString(16)}`);
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
            if ((oldStatus & 0x01) && !(this.mmu.spRegisters[4] & 0x01)) {
                console.log(`RSP Task Triggered: SP_STATUS write=0x${value.toString(16)}`);
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
            this.processRdpCommands();
            this.mmu.dpcRegisters[3] = value; // CURRENT = END
            this.mmu.miRegisters[2] |= 0x20; // DP Interrupt
        }
    }

    processRdpCommands() {
        let start = this.mmu.dpcRegisters[0] & 0xFFFFFF;
        let end = this.mmu.dpcRegisters[1] & 0xFFFFFF;
        if (end <= start) return;
        if ((this.rdpCommandCount & 0x3FF) === 0) {
            console.log(`RDP Commands: 0x${start.toString(16)} to 0x${end.toString(16)}`);
        }

        const rdramView = new DataView(this.mmu.memory.rdram);
        for (let addr = start; addr < end; addr += 8) {
            const hi = rdramView.getUint32(addr & 0x7FFFFF, false);
            const lo = rdramView.getUint32((addr + 4) & 0x7FFFFF, false);
            const cmd = (hi >>> 24) & 0x3F;
            this.executeDisplayListCommand(cmd | 0xC0, hi, lo, addr);
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
        console.log("RSP Task called!");
        // OSTask structure is usually at SP_DMEM 0xFC0
        const taskPtr = 0xFC0;
        const type = this.mmu.spDmemView.getUint32(taskPtr + 0x00, false);
        console.log(`RSP Task Triggered: Type=${type} (SP_STATUS=0x${this.mmu.spRegisters[4].toString(16)})`);
        const flags = this.mmu.spDmemView.getUint32(taskPtr + 0x04, false);
        const ucode = this.mmu.spDmemView.getUint32(taskPtr + 0x10, false);

        const dataPtr = this.mmu.spDmemView.getUint32(taskPtr + 0x30, false) & 0xFFFFFF;
        console.log(`RSP Task: Type=${type} Flags=0x${flags.toString(16)} ucode=0x${ucode.toString(16)} dataPtr=0x${dataPtr.toString(16)}`);
        const dataSize = this.mmu.spDmemView.getUint32(taskPtr + 0x34, false);
        const yieldDataPtr = this.mmu.spDmemView.getUint32(taskPtr + 0x38, false) & 0xFFFFFF;

        if (type === 4) { // Decompression Task HLE
            // For MIO0 task: dataPtr is compressed source, yieldDataPtr is destination
            const output = this.mmu.cpu.decompressMIO0(this.mmu.memory.rdram, dataPtr);
            if (output) {
                const rdramView = new Uint8Array(this.mmu.memory.rdram);
                rdramView.set(output, yieldDataPtr);
                console.log(`HLE: Decompressed MIO0 at 0x${dataPtr.toString(16)} to 0x${yieldDataPtr.toString(16)} (size: ${output.length})`);
            }
        } else if (type === 1) { // Graphics Task HLE
            this.processDisplayList(dataPtr | 0x80000000);
        }
    }

    createIdentityMatrix() {
        return [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ];
    }

    readMatrix(addr) {
        const rdramView = new DataView(this.mmu.memory.rdram);
        const matrix = new Array(16);
        for (let i = 0; i < 16; i++) {
            const intPart = rdramView.getInt16(addr + i * 2, false);
            const fracPart = rdramView.getUint16(addr + 32 + i * 2, false);
            matrix[i] = intPart + fracPart / 65536.0;
        }
        return matrix;
    }

    multiplyMatrices(a, b) {
        const res = new Array(16).fill(0);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                for (let k = 0; k < 4; k++) {
                    res[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
                }
            }
        }
        return res;
    }

    processDisplayList(addr) {
        console.log(`Processing Display List at 0x${addr.toString(16)}`);
        this.rspState = {
            segments: new Uint32Array(16),
            vertices: new Array(32).fill(0).map(() => ({ x: 0, y: 0, z: 0, w: 1, r: 0, g: 0, b: 0, a: 0, s: 0, t: 0 })),
            modelviewStack: [this.createIdentityMatrix()],
            projectionMatrix: this.createIdentityMatrix(),
            depthImage: 0,
            colorImage: 0,
            colorImageWidth: 320,
            colorImageFormat: 3,
            colorImageSize: 2,
            textureImage: 0,
            tiles: new Array(8).fill(0).map(() => ({ format: 0, size: 0, line: 0, tmem: 0, palette: 0, uls: 0, ult: 0, lrs: 0, lrt: 0 })),
            combine: { hi: 0, lo: 0 },
            useTexture: false,
            otherModeHi: 0,
            otherModeLo: 0,
            fillColor: 0,
            primColor: 0xFFFFFFFF,
            envColor: 0,
            textureScaleS: 1.0,
            textureScaleT: 1.0,
            currentTile: 0
        };
        this.warnedCommands = new Set();
        this.executeDisplayList(addr);
    }

    get cycleMode() {
        return (this.rspState.otherModeLo >>> 20) & 0x03;
    }

    executeDisplayList(addr) {
        const rdramView = new DataView(this.mmu.memory.rdram);
        let pc = addr;
        let depth = 0;
        const stack = [];

        while (pc >= 0x80000000 && pc < 0x80800000) {
            const hi = rdramView.getUint32(pc & 0x7FFFFF, false);
            const lo = rdramView.getUint32((pc + 4) & 0x7FFFFF, false);
            pc += 8;

            const cmd = (hi >>> 24) & 0xFF;
            switch (cmd) {
                case 0xDE: // G_DL
                    const branch = (hi >>> 16) & 0xFF;
                    const nextDl = this.resolveAddress(lo);
                    if (branch === 0) { // Branch
                        pc = nextDl;
                    } else { // Call
                        if (depth < 16) {
                            stack.push(pc);
                            depth++;
                            pc = nextDl;
                        }
                    }
                    break;
                case 0xDF: // G_ENDDL
                    if (depth > 0) {
                        depth--;
                        pc = stack.pop();
                    } else {
                        return;
                    }
                    break;
                case 0xDA: // G_MTX
                    this.handleG_MTX(hi, lo);
                    break;
                case 0xD8: // G_POPMTX
                    if (this.rspState.modelviewStack.length > 1) {
                        this.rspState.modelviewStack.pop();
                    }
                    break;
                case 0xD7: // G_TEXTURE
                    break;
                case 0x01: // G_VTX (F3DEX2)
                case 0x04: // G_VTX (F3D)
                case 0xB0: // G_VTX (Variant)
                    this.handleG_VTX(hi, lo);
                    break;
                case 0x05: // G_TRI1 (F3DEX2)
                case 0xBF: // G_TRI1 (F3D)
                    this.handleG_TRI1(hi, lo, cmd === 0x05);
                    break;
                case 0x06: // G_TRI2 (F3DEX2)
                case 0xB1: // G_TRI2 (F3D)
                    this.handleG_TRI2(hi, lo, cmd === 0x06);
                    break;
                case 0xBC: // G_MOVEWORD
                    this.handleG_MOVEWORD(hi, lo);
                    break;
                case 0xBD: // G_MOVEMEM
                    this.handleG_MOVEMEM(hi, lo);
                    break;
                case 0xDB: // G_SETSEGMENT
                    const seg = (hi >>> 2) & 0xF;
                    this.rspState.segments[seg] = lo & 0xFFFFFF;
                    break;
                case 0xB6: // G_MOVEWORD (F3DEX2)
                    this.handleG_MOVEWORD(hi, lo);
                    break;
                case 0xB7: // G_MOVEMEM (F3DEX2)
                    this.handleG_MOVEMEM(hi, lo);
                    break;
                default:
                    this.executeDisplayListCommand(cmd, hi, lo, pc - 8);
                    // Special case for multi-word commands in display list
                    if (cmd === 0xE4 || cmd === 0xE5) pc += 16;
                    break;
            }
        }
    }

    executeDisplayListCommand(cmd, hi, lo, pc) {
        const rdramView = new DataView(this.mmu.memory.rdram);
        this.rdpCommandCount++;
        switch (cmd) {
            case 0xFD: // G_SETTIMG
            case 0x3D: // RDP SETTIMG
                this.rspState.textureImage = this.resolveAddress(lo);
                break;
            case 0xFF: // G_SETCIMG
            case 0x3F: // RDP SETCIMG
                this.rspState.colorImage = this.resolveAddress(lo);
                this.rspState.colorImageWidth = (hi & 0xFFF) + 1;
                this.rspState.colorImageFormat = (hi >>> 21) & 0x7;
                this.rspState.colorImageSize = (hi >>> 19) & 0x3;
                if ((this.rdpCommandCount & 0xFF) === 0) {
                    console.log(`G_SETCIMG: Addr=0x${this.rspState.colorImage.toString(16)} Width=${this.rspState.colorImageWidth} Format=${this.rspState.colorImageFormat} Size=${this.rspState.colorImageSize}`);
                }
                break;
            case 0xFE: // G_SETZIMG
            case 0x3E: // RDP SETZIMG
                this.rspState.depthImage = this.resolveAddress(lo);
                break;
            case 0xF5: // G_SETTILE
            case 0x35: // RDP SETTILE
                this.handleG_SETTILE(hi, lo);
                break;
            case 0xF2: // G_SETTILESIZE
            case 0x32: // RDP SETTILESIZE
                this.handleG_SETTILESIZE(hi, lo);
                break;
            case 0xF4: // G_LOADTILE
            case 0x34: // RDP LOADTILE
                this.handleG_LOADTILE(hi, lo);
                break;
            case 0xF3: // G_LOADBLOCK
            case 0x33: // RDP LOADBLOCK
                this.handleG_LOADBLOCK(hi, lo);
                break;
            case 0xFC: // G_SETCOMBINE
            case 0x3C: // RDP SETCOMBINE
                this.rspState.combine.hi = hi & 0xFFFFFF;
                this.rspState.combine.lo = lo;
                // If any of the color sources is TEXEL0 or TEXEL1
                this.rspState.useTexture = ((hi & 0x00F00000) !== 0) || ((lo & 0x000000F0) !== 0);
                break;
            case 0xF6: // G_FILLRECT
            case 0x36: // RDP FILLRECT
                this.handleG_FILLRECT(hi, lo);
                if ((this.rdpCommandCount & 0xFF) === 0) {
                    console.log(`G_FILLRECT: x1=${(hi >>> 12) & 0xFFF} y1=${hi & 0xFFF} x2=${(lo >>> 12) & 0xFFF} y2=${lo & 0xFFF}`);
                }
                break;
            case 0xF7: // G_SETFILLCOLOR
            case 0x37: // RDP SETFILLCOLOR
                this.rspState.fillColor = lo;
                if ((this.rdpCommandCount & 0xFF) === 0) {
                    console.log(`G_SETFILLCOLOR: 0x${lo.toString(16)}`);
                }
                break;
            case 0xE2: // G_SETOTHERMODE_L
            case 0xB9: // G_SETOTHERMODE_L (F3DEX)
            case 0x2F: // RDP SETOTHERMODE
                this.rspState.otherModeLo = lo;
                break;
            case 0xE3: // G_SETOTHERMODE_H
            case 0xBA: // G_SETOTHERMODE_H (F3DEX)
                this.rspState.otherModeHi = lo;
                break;
            case 0xE4: // G_TEXRECT
            case 0xE5: // G_TEXRECTFLIP
            case 0x24: // RDP TEXRECT
            case 0x25: // RDP TEXRECTFLIP
                {
                    const x2 = (hi >>> 12) & 0xFFF;
                    const y2 = hi & 0xFFF;
                    const tile = (lo >>> 24) & 0x7;
                    const x1 = (lo >>> 12) & 0xFFF;
                    const y1 = lo & 0xFFF;

                    // Note: In RDP command stream, subsequent words are at pc+8, pc+16
                    // In RSP display list, they might be at pc+8, pc+16 too if it's a multi-word command.
                    const w2lo = rdramView.getUint32((pc + 12) & 0x7FFFFF, false);
                    const w3lo = rdramView.getUint32((pc + 20) & 0x7FFFFF, false);

                    const s = (w2lo >>> 16) & 0xFFFF;
                    const t = w2lo & 0xFFFF;
                    const dsdx = (w3lo >>> 16) & 0xFFFF;
                    const dtdy = w3lo & 0xFFFF;

                    this.drawTextureRect(x1/4.0, y1/4.0, x2/4.0, y2/4.0, s, t, dsdx, dtdy, tile, (cmd === 0xE5 || cmd === 0x25));
                }
                break;
            case 0xBB: // G_TEXTURE
                this.rspState.textureScaleS = (lo >>> 16) / 65536.0;
                this.rspState.textureScaleT = (lo & 0xFFFF) / 65536.0;
                this.rspState.currentTile = (hi >>> 8) & 0x7;
                break;
            case 0xFA: // G_SETPRIMCOLOR
            case 0x3A: // RDP SETPRIMCOLOR
                this.rspState.primColor = lo;
                break;
            case 0xFB: // G_SETENVCOLOR
            case 0x3B: // RDP SETENVCOLOR
                this.rspState.envColor = lo;
                break;
            case 0x27: // RDP Sync Full
            case 0xE8: // G_DPFULLSYNC
                this.mmu.miRegisters[2] |= 0x20; // DP Interrupt
                break;
            default:
                if (!this.warnedCommands.has(cmd)) {
                    console.warn(`Unknown RSP/RDP Command: 0x${cmd.toString(16).padStart(2, '0')}`);
                    this.warnedCommands.add(cmd);
                }
                break;
        }
    }

    resolveAddress(addr) {
        const seg = (addr >>> 24) & 0xF;
        return (this.rspState.segments[seg] & 0xFFFFFF) + (addr & 0xFFFFFF) + 0x80000000;
    }

    handleG_VTX(hi, lo) {
        let num, dest;
        const cmd = (hi >>> 24) & 0xFF;
        if (cmd === 0x04) { // Fast3D (SM64)
            num = (hi >>> 8) & 0xFF;
            dest = (hi >>> 16) & 0xFF;
        } else {
            num = (hi >>> 12) & 0xFF;
            dest = (hi & 0xFF) / 2;
        }
        const addr = this.resolveAddress(lo);
        const rdramView = new DataView(this.mmu.memory.rdram);

        const mv = this.rspState.modelviewStack[this.rspState.modelviewStack.length - 1];
        const p = this.rspState.projectionMatrix;
        const mvp = this.multiplyMatrices(p, mv);

        for (let i = 0; i < num; i++) {
            const vAddr = (addr + i * 16) & 0x7FFFFF;
            const x = rdramView.getInt16(vAddr, false);
            const y = rdramView.getInt16(vAddr + 2, false);
            const z = rdramView.getInt16(vAddr + 4, false);

            // Transform
            const tx = x * mvp[0] + y * mvp[1] + z * mvp[2] + mvp[3];
            const ty = x * mvp[4] + y * mvp[5] + z * mvp[6] + mvp[7];
            const tz = x * mvp[8] + y * mvp[9] + z * mvp[10] + mvp[11];
            const tw = x * mvp[12] + y * mvp[13] + z * mvp[14] + mvp[15];

            // Viewport Transformation
            let screenX = 160;
            let screenY = 120;
            let screenZ = tz;
            if (Math.abs(tw) > 0.0001) {
                if (this.rspState.viewport) {
                    const vp = this.rspState.viewport;
                    screenX = (tx / tw) * vp.scale[0] + vp.trans[0];
                    screenY = (-(ty / tw) * vp.scale[1] + vp.trans[1]);
                    screenZ = (tz / tw) * vp.scale[2] + vp.trans[2];
                } else {
                    screenX = (tx / tw) * 160 + 160;
                    screenY = -(ty / tw) * 120 + 120;
                }
            }

            const s = rdramView.getInt16(vAddr + 8, false);
            const t = rdramView.getInt16(vAddr + 10, false);
            const r = rdramView.getUint8(vAddr + 12);
            const g = rdramView.getUint8(vAddr + 13);
            const b = rdramView.getUint8(vAddr + 14);
            const a = rdramView.getUint8(vAddr + 15);

            this.rspState.vertices[dest + i] = { x: screenX, y: screenY, z: screenZ, r, g, b, a, s, t };
        }
    }

    handleG_TRI1(hi, lo, isF3DEX2) {
        let v1idx, v2idx, v3idx;
        if (isF3DEX2) {
            v1idx = (hi >>> 16) & 0xFF;
            v2idx = (hi >>> 8) & 0xFF;
            v3idx = (hi >>> 0) & 0xFF;
        } else {
            v1idx = (lo >>> 16) & 0xFF;
            v2idx = (lo >>> 8) & 0xFF;
            v3idx = (lo >>> 0) & 0xFF;
        }

        const scale = isF3DEX2 ? 2 : 16;
        const v1 = this.rspState.vertices[v1idx / scale];
        const v2 = this.rspState.vertices[v2idx / scale];
        const v3 = this.rspState.vertices[v3idx / scale];

        if (v1 && v2 && v3) {
            this.drawTriangle(v1, v2, v3);
        }
    }

    handleG_TRI2(hi, lo, isF3DEX2) {
        // Both F3D and F3DEX2 use the same format for TRI2 (indices in both hi and lo words)
        const v1idx = (hi >>> 16) & 0xFF;
        const v2idx = (hi >>> 8) & 0xFF;
        const v3idx = (hi >>> 0) & 0xFF;
        const v4idx = (lo >>> 16) & 0xFF;
        const v5idx = (lo >>> 8) & 0xFF;
        const v6idx = (lo >>> 0) & 0xFF;

        const scale = isF3DEX2 ? 2 : 16;
        const v1 = this.rspState.vertices[v1idx / scale];
        const v2 = this.rspState.vertices[v2idx / scale];
        const v3 = this.rspState.vertices[v3idx / scale];
        if (v1 && v2 && v3) this.drawTriangle(v1, v2, v3);

        const v4 = this.rspState.vertices[v4idx / scale];
        const v5 = this.rspState.vertices[v5idx / scale];
        const v6 = this.rspState.vertices[v6idx / scale];
        if (v4 && v5 && v6) this.drawTriangle(v4, v5, v6);
    }

    handleG_MOVEWORD(hi, lo) {
        const index = (hi >>> 16) & 0xFF;
        const offset = hi & 0xFFFF;
        if (index === 0x06) { // G_MW_SEGMENT
            const seg = (offset >> 2) & 0xF;
            this.rspState.segments[seg] = lo & 0xFFFFFF;
        }
    }

    handleG_MOVEMEM(hi, lo) {
        const index = (hi >>> 16) & 0xFF;
        const addr = this.resolveAddress(lo);
        const rdramView = new DataView(this.mmu.memory.rdram);
        if (index === 0x01 || index === 0x80) { // G_MV_VIEWPORT (0x01: F3DEX, 0x80: F3D)
            const vAddr = addr & 0x7FFFFF;
            console.log(`G_MOVEMEM: Viewport at 0x${addr.toString(16)}`);
            if (vAddr + 16 <= rdramView.byteLength) {
                this.rspState.viewport = {
                    scale: [
                        rdramView.getInt16(vAddr, false) / 4.0,
                        rdramView.getInt16(vAddr + 2, false) / 4.0,
                        rdramView.getInt16(vAddr + 4, false) / 512.0
                    ],
                    trans: [
                        rdramView.getInt16(vAddr + 8, false) / 4.0,
                        rdramView.getInt16(vAddr + 10, false) / 4.0,
                        rdramView.getInt16(vAddr + 12, false) / 512.0
                    ]
                };
            }
        }
    }

    handleG_SETTILE(hi, lo) {
        const tile = (lo >>> 24) & 0x7;
        if (tile < 8) {
            const t = this.rspState.tiles[tile];
            t.format = (hi >>> 21) & 0x7;
            t.size = (hi >>> 19) & 0x3;
            t.line = (hi >>> 9) & 0x1FF;
            t.tmem = hi & 0x1FF;
            t.palette = (lo >>> 20) & 0xF;
            t.maskT = (lo >>> 14) & 0x0F;
            t.shiftT = (lo >>> 10) & 0x0F;
            t.maskS = (lo >>> 4) & 0x0F;
            t.shiftS = (lo >>> 0) & 0x0F;
        }
    }

    handleG_MTX(hi, lo) {
        const flags = (hi >>> 16) & 0xFF;
        const addr = this.resolveAddress(lo);
        const m = this.readMatrix(addr & 0x7FFFFF);

        // Fast3D (SM64) flags:
        const G_MTX_PROJECTION = 0x01;
        const G_MTX_LOAD = 0x02;
        const G_MTX_PUSH = 0x04;

        if (flags & G_MTX_PROJECTION) {
            if (flags & G_MTX_LOAD) {
                this.rspState.projectionMatrix = m;
            } else {
                this.rspState.projectionMatrix = this.multiplyMatrices(m, this.rspState.projectionMatrix);
            }
        } else {
            let currentMtx = this.rspState.modelviewStack[this.rspState.modelviewStack.length - 1];
            let newMtx;
            if (flags & G_MTX_LOAD) {
                newMtx = m;
            } else {
                newMtx = this.multiplyMatrices(m, currentMtx);
            }

            if (flags & G_MTX_PUSH) {
                this.rspState.modelviewStack.push(newMtx);
            } else {
                this.rspState.modelviewStack[this.rspState.modelviewStack.length - 1] = newMtx;
            }
        }
    }

    handleG_LOADBLOCK(hi, lo) {
        const tile = (lo >>> 24) & 0x7;
        const lrs = (lo >>> 12) & 0xFFF;

        const addr = this.rspState.textureImage;
        const tmemAddr = this.rspState.tiles[tile].tmem * 8;

        // size depends on format, but usually G_LOADBLOCK is used for a raw copy
        // In 16-bit mode, it's (lrs+1) * 2 bytes.
        // But many games use it for 64-bit alignment.
        const size = (lrs + 1) * 8; // Approximation that works for most cases

        const rdramView = new Uint8Array(this.mmu.memory.rdram);
        for (let i = 0; i < size && (tmemAddr + i < 4096); i++) {
            const pAddr = (addr + i) & 0x7FFFFF;
            if (pAddr < rdramView.length) {
                this.tmem[tmemAddr + i] = rdramView[pAddr];
            }
        }
    }

    handleG_LOADTILE(hi, lo) {
        const tile = (lo >>> 24) & 0x7;
        const uls = (hi >>> 12) & 0xFFF;
        const ult = hi & 0xFFF;
        const lrs = (lo >>> 12) & 0xFFF;
        const lrt = lo & 0xFFF;

        const addr = this.rspState.textureImage;
        const tmemAddr = this.rspState.tiles[tile].tmem * 8;
        const line = this.rspState.tiles[tile].line * 8;

        const rdramView = new Uint8Array(this.mmu.memory.rdram);
        let srcOff = addr;
        let dstOff = tmemAddr;
        for (let y = ult / 4; y < lrt / 4; y++) {
            for (let x = 0; x < line && (dstOff < 4096); x++) {
                const pAddr = srcOff & 0x7FFFFF;
                if (pAddr < rdramView.length) this.tmem[dstOff++] = rdramView[pAddr];
                srcOff++;
            }
        }
    }

    handleG_SETTILESIZE(hi, lo) {
        const tile = (lo >>> 24) & 0x7;
        if (tile < 8) {
            this.rspState.tiles[tile].uls = (hi >>> 12) & 0xFFF;
            this.rspState.tiles[tile].ult = hi & 0xFFF;
            this.rspState.tiles[tile].lrs = (lo >>> 12) & 0xFFF;
            this.rspState.tiles[tile].lrt = lo & 0xFFF;
        }
    }

    drawTextureRect(x1, y1, x2, y2, s, t, dsdx, dtdy, tileIdx, flip) {
        if ((this.rdpCommandCount & 0x3FF) === 0) {
             console.log(`G_TEXRECT: (${x1},${y1}) to (${x2},${y2}) tile=${tileIdx} s=${s} t=${t} dsdx=${dsdx} dtdy=${dtdy}`);
        }
        const addr = this.rspState.colorImage;
        if (!addr) return;
        const width = this.rspState.colorImageWidth;
        const rdramView = new DataView(this.mmu.memory.rdram);
        const tile = this.rspState.tiles[tileIdx];

        const startX = Math.max(0, Math.floor(x1));
        const startY = Math.max(0, Math.floor(y1));
        const endX = Math.min(width, Math.ceil(x2));
        const endY = Math.min(240, Math.ceil(y2));

        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                const curS = s + (x - x1) * (dsdx / 1024.0);
                const curT = t + (y - y1) * (dtdy / 1024.0);

                const texel0 = this.sampleTexture(tile, curS, curT);
                if (texel0.a === 0 && (this.rspState.otherModeLo & 0x4000)) continue;

                let color;
                if (this.cycleMode === 3) {
                    color = texel0;
                } else {
                    color = this.combineColor({r:255,g:255,b:255,a:255}, texel0, {r:255,g:255,b:255,a:255});
                }

                const size = this.rspState.colorImageSize;
                const pAddr = (addr + (y * width + x) * (size === 3 ? 4 : 2)) & 0x7FFFFF;
                if (size === 2) {
                    const color16 = (((color.r >> 3) & 0x1F) << 11) | (((color.g >> 3) & 0x1F) << 6) | (((color.b >> 3) & 0x1F) << 1) | 1;
                    if (pAddr + 2 <= this.mmu.memory.rdram.byteLength) rdramView.setUint16(pAddr, color16, false);
                } else if (size === 3) {
                    const color32 = ((color.r & 0xFF) << 24) | ((color.g & 0xFF) << 16) | ((color.b & 0xFF) << 8) | 255;
                    if (pAddr + 4 <= this.mmu.memory.rdram.byteLength) rdramView.setUint32(pAddr, color32, false);
                }
            }
        }
    }

    handleG_FILLRECT(hi, lo) {
        let x1 = (hi >>> 12) & 0xFFF;
        let y1 = (hi >>> 0) & 0xFFF;
        let x2 = (lo >>> 12) & 0xFFF;
        let y2 = (lo >>> 0) & 0xFFF;

        // Coordinates are 10.2 fixed point for some RDP commands,
        // but for FILLRECT they are often reported as 12.0 in some docs.
        // Let's check if they seem to be 10.2 (i.e. > screen size)
        if (x2 > 1024 || y2 > 1024) {
             x1 /= 4.0; y1 /= 4.0; x2 /= 4.0; y2 /= 4.0;
        }

        const addr = this.rspState.colorImage;
        if (!addr) return;

        const rdramView = new DataView(this.mmu.memory.rdram);
        const size = this.rspState.colorImageSize; // 2: 16-bit, 3: 32-bit

        const startX = Math.floor(x1 / 4);
        const startY = Math.floor(y1 / 4);
        const endX = Math.floor(x2 / 4);
        const endY = Math.floor(y2 / 4);

        const width = this.rspState.colorImageWidth;
        if (size === 2) {
            const color = (this.rspState.fillColor >>> 16) & 0xFFFF;
            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const pAddr = (addr + (y * width + x) * 2) & 0x7FFFFF;
                    if (pAddr + 2 <= this.mmu.memory.rdram.byteLength) {
                        rdramView.setUint16(pAddr, color, false);
                    }
                }
            }
        } else if (size === 3) {
            const color = this.rspState.fillColor;
            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const pAddr = (addr + (y * width + x) * 4) & 0x7FFFFF;
                    if (pAddr + 4 <= this.mmu.memory.rdram.byteLength) {
                        rdramView.setUint32(pAddr, color, false);
                    }
                }
            }
        }
    }

    sampleTexture(tile, s, t) {
        // s and t are in 10.5 fixed point (units of 1/32 texel)
        let ss = Math.floor(s / 32.0);
        let tt = Math.floor(t / 32.0);

        // Apply shift
        if (tile.shiftS) {
            if (tile.shiftS > 10) ss <<= (16 - tile.shiftS);
            else ss >>= tile.shiftS;
        }
        if (tile.shiftT) {
            if (tile.shiftT > 10) tt <<= (16 - tile.shiftT);
            else tt >>= tile.shiftT;
        }

        // Apply mask
        if (tile.maskS) ss &= (1 << tile.maskS) - 1;
        if (tile.maskT) tt &= (1 << tile.maskT) - 1;

        const sizeBytes = [0.5, 1, 2, 4][tile.size];
        const lineBytes = tile.line * 8;
        const texelAddr = (tile.tmem * 8) + (tt * lineBytes);
        const ts = ss;

        let r=255, g=255, b=255, a=255;

        if (tile.format === 0) { // RGBA
            if (tile.size === 2) { // 16-bit
                const addr = texelAddr + ts * 2;
                if (addr + 2 <= 4096) {
                    const val = (this.tmem[addr] << 8) | this.tmem[addr + 1];
                    r = ((val >> 11) & 0x1F) << 3;
                    g = ((val >> 6) & 0x1F) << 3;
                    b = ((val >> 1) & 0x1F) << 3;
                    a = (val & 1) ? 255 : 0;
                }
            } else if (tile.size === 3) { // 32-bit
                const addr = texelAddr + ts * 4;
                if (addr + 4 <= 4096) {
                    r = this.tmem[addr]; g = this.tmem[addr+1]; b = this.tmem[addr+2]; a = this.tmem[addr+3];
                }
            }
        } else if (tile.format === 2) { // CI
            let idx = 0;
            if (tile.size === 1) { // 8-bit
                idx = this.tmem[texelAddr + ts] || 0;
            } else if (tile.size === 0) { // 4-bit
                idx = this.tmem[texelAddr + (ts >> 1)] || 0;
                if (!(ts & 1)) idx >>= 4;
                idx = (idx & 0x0F) + (tile.palette << 4);
            }
            const palAddr = 2048 + idx * 2;
            if (palAddr + 2 <= 4096) {
                const val = (this.tmem[palAddr] << 8) | this.tmem[palAddr+1];
                r = ((val >> 11) & 0x1F) << 3; g = ((val >> 6) & 0x1F) << 3; b = ((val >> 1) & 0x1F) << 3; a = (val & 1) ? 255 : 0;
            }
        } else if (tile.format === 3) { // IA
            if (tile.size === 1) { // 8-bit
                const val = this.tmem[texelAddr + ts] || 0;
                r = g = b = (val >> 4) * 17; a = (val & 0x0F) * 17;
            } else if (tile.size === 0) { // 4-bit
                let val = this.tmem[texelAddr + (ts >> 1)] || 0;
                if (!(ts & 1)) val >>= 4;
                r = g = b = (val >> 1) * 36; a = (val & 1) * 255;
            }
        } else if (tile.format === 4) { // I
            let val = 0;
            if (tile.size === 1) val = this.tmem[texelAddr + ts] || 0;
            else if (tile.size === 0) {
                val = this.tmem[texelAddr + (ts >> 1)] || 0;
                if (!(ts & 1)) val >>= 4;
                val = (val & 0x0F) * 17;
            }
            r = g = b = a = val;
        }
        return {r, g, b, a};
    }

    combineColor(shade, texel0, texel1) {
        const prim = {
            r: (this.rspState.primColor >>> 24) & 0xFF,
            g: (this.rspState.primColor >>> 16) & 0xFF,
            b: (this.rspState.primColor >>> 8) & 0xFF,
            a: this.rspState.primColor & 0xFF
        };
        const env = {
            r: (this.rspState.envColor >>> 24) & 0xFF,
            g: (this.rspState.envColor >>> 16) & 0xFF,
            b: (this.rspState.envColor >>> 8) & 0xFF,
            a: this.rspState.envColor & 0xFF
        };

        const hi = this.rspState.combine.hi;
        const lo = this.rspState.combine.lo;

        const a_src = (hi >>> 20) & 0x0F;
        const b_src = (hi >>> 15) & 0x1F;
        const c_src = (hi >>> 10) & 0x1F;
        const d_src = (hi >>> 6) & 0x0F;

        const aa_src = (lo >>> 18) & 0x07;
        const ab_src = (lo >>> 15) & 0x07;
        const ac_src = (lo >>> 12) & 0x07;
        const ad_src = (lo >>> 9) & 0x07;

        const getRGB = (src) => {
            switch(src) {
                case 1: return texel0;
                case 2: return texel1;
                case 3: return prim;
                case 4: return shade;
                case 5: return env;
                default: return { r: 0, g: 0, b: 0 };
            }
        };

        const getAlpha = (src) => {
            switch(src) {
                case 1: return texel0.a;
                case 2: return texel1.a;
                case 3: return prim.a;
                case 4: return shade.a;
                case 5: return env.a;
                default: return 0;
            }
        };

        const a = getRGB(a_src);
        const b = getRGB(b_src);
        const c = getRGB(c_src);
        const d = getRGB(d_src);

        const aa = getAlpha(aa_src);
        const ab = getAlpha(ab_src);
        const ac = getAlpha(ac_src);
        const ad = getAlpha(ad_src);

        return {
            r: Math.max(0, Math.min(255, (a.r - b.r) * (c.r / 255.0) + d.r)),
            g: Math.max(0, Math.min(255, (a.g - b.g) * (c.g / 255.0) + d.g)),
            b: Math.max(0, Math.min(255, (a.b - b.b) * (c.b / 255.0) + d.b)),
            a: Math.max(0, Math.min(255, (aa - ab) * (ac / 255.0) + ad))
        };
    }

    drawTriangle(v1, v2, v3) {
        if ((this.rdpCommandCount & 0x3FF) === 0) {
            console.log(`DrawTriangle: (${v1.x},${v1.y}) (${v2.x},${v2.y}) (${v3.x},${v3.y})`);
        }
        const addr = this.rspState.colorImage;
        if (!addr) return;

        const x1 = v1.x, y1 = v1.y;
        const x2 = v2.x, y2 = v2.y;
        const x3 = v3.x, y3 = v3.y;

        const minX = Math.floor(Math.min(x1, x2, x3));
        const maxX = Math.ceil(Math.max(x1, x2, x3));
        const minY = Math.floor(Math.min(y1, y2, y3));
        const maxY = Math.ceil(Math.max(y1, y2, y3));

        const rdramView = new DataView(this.mmu.memory.rdram);
        const tileIdx = this.rspState.currentTile;
        const tile = this.rspState.tiles[tileIdx];
        const isCopyMode = (this.cycleMode === 3);
        const width = this.rspState.colorImageWidth;
        const zAddr = this.rspState.depthImage;

        const zCmp = (this.rspState.otherModeLo & 0x10);
        const zUpd = (this.rspState.otherModeLo & 0x20);

        for (let y = minY; y <= maxY; y++) {
            if (y < 0 || y >= 240) continue;
            for (let x = minX; x <= maxX; x++) {
                if (x < 0 || x >= width) continue;
                const weights = this.getBarycentricWeights(x, y, x1, y1, x2, y2, x3, y3);
                if (weights) {
                    const z = v1.z * weights.s + v2.z * weights.t + v3.z * weights.u;
                    if (zCmp && zAddr) {
                        const pzAddr = (zAddr + (y * width + x) * 2) & 0x7FFFFF;
                        const oldZ = rdramView.getUint16(pzAddr, false);
                        if (z < oldZ) {
                            if (zUpd) rdramView.setUint16(pzAddr, Math.max(0, Math.min(0xFFFF, z)), false);
                        } else {
                            continue;
                        }
                    }

                    const shade = {
                        r: v1.r * weights.s + v2.r * weights.t + v3.r * weights.u,
                        g: v1.g * weights.s + v2.g * weights.t + v3.g * weights.u,
                        b: v1.b * weights.s + v2.b * weights.t + v3.b * weights.u,
                        a: v1.a * weights.s + v2.a * weights.t + v3.a * weights.u
                    };

                    let texel0 = { r: 255, g: 255, b: 255, a: 255 };
                    if (this.rspState.useTexture && this.rspState.textureImage !== 0) {
                        const s = (v1.s * weights.s + v2.s * weights.t + v3.s * weights.u) * this.rspState.textureScaleS;
                        const t = (v1.t * weights.s + v2.t * weights.t + v3.t * weights.u) * this.rspState.textureScaleT;
                        texel0 = this.sampleTexture(tile, s, t);
                        if (texel0.a === 0 && (this.rspState.otherModeLo & 0x4000)) continue;
                    }

                    let color;
                    if (isCopyMode) {
                        color = texel0;
                    } else {
                        color = this.combineColor(shade, texel0, {r:255,g:255,b:255,a:255});
                    }
                    const size = this.rspState.colorImageSize;
                    if (size === 2) {
                        const color16 = (((color.r >> 3) & 0x1F) << 11) | (((color.g >> 3) & 0x1F) << 6) | (((color.b >> 3) & 0x1F) << 1) | 1;
                        const pAddr = (addr + (y * width + x) * 2) & 0x7FFFFF;
                        if (pAddr + 2 <= this.mmu.memory.rdram.byteLength) rdramView.setUint16(pAddr, color16, false);
                    } else if (size === 3) {
                        const color32 = ((color.r & 0xFF) << 24) | ((color.g & 0xFF) << 16) | ((color.b & 0xFF) << 8) | 255;
                        const pAddr = (addr + (y * width + x) * 4) & 0x7FFFFF;
                        if (pAddr + 4 <= this.mmu.memory.rdram.byteLength) rdramView.setUint32(pAddr, color32, false);
                    }
                }
            }
        }
    }

    getBarycentricWeights(px, py, x1, y1, x2, y2, x3, y3) {
        const area = 0.5 * (-y2 * x3 + y1 * (-x2 + x3) + x1 * (y2 - y3) + x2 * y3);
        if (Math.abs(area) < 0.0001) return null;
        const s = 1 / (2 * area) * (y1 * x3 - x1 * y3 + (y3 - y1) * px + (x1 - x3) * py);
        const t = 1 / (2 * area) * (x1 * y2 - y1 * x2 + (y1 - y2) * px + (x2 - x1) * py);
        const u = 1 - s - t;
        if (s >= 0 && t >= 0 && u >= 0) return { s, t, u };
        return null;
    }
}
