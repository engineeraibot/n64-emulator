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
            this.mmu.dpcRegisters[3] = this.mmu.dpcRegisters[1]; // CURRENT = END
            this.mmu.miRegisters[2] |= 0x20; // DP Interrupt
            this.mmu.updateInterrupts();
        }
    }

    processRdpCommands() {
        let start = this.mmu.dpcRegisters[0] & 0xFFFFFF;
        let end = this.mmu.dpcRegisters[1] & 0xFFFFFF;
        if (end <= start) return;

        const rdramView = new DataView(this.mmu.memory.rdram);
        let addr = start;
        while (addr < end) {
            const hi = rdramView.getUint32(addr, false);
            const lo = rdramView.getUint32(addr + 4, false);
            const consumed = this.executeRdpCommand(hi, lo, addr);
            addr += consumed;
            if (consumed === 0) break; // Safety
        }
    }

    executeRdpCommand(hi, lo, addr) {
        this.rdpCommandCount++;
        const cmd = (hi >>> 24) & 0x3F;
        let consumed = 8;

        // Ensure we have rspState even for direct RDP commands
        if (!this.rspState) {
            this.rspState = {
                segments: new Uint32Array(16),
                vertices: new Array(32).fill(0).map(() => ({ x: 0, y: 0, z: 0, w: 1, r: 0, g: 0, b: 0, a: 0, s: 0, t: 0 })),
                modelviewStack: [this.createIdentityMatrix()],
                projectionMatrix: this.createIdentityMatrix(),
                tiles: new Array(8).fill(0).map(() => ({ format: 0, size: 0, line: 0, tmem: 0, palette: 0, uls: 0, ult: 0, lrs: 0, lrt: 0 })),
                combine: { hi: 0, lo: 0 },
                primColor: 0xFFFFFFFF,
                envColor: 0,
                fillColor: 0,
                colorImage: 0,
                colorImageWidth: 320,
                colorImageSize: 2,
                textureScaleS: 1.0,
                textureScaleT: 1.0,
                otherModeHi: 0,
                otherModeLo: 0,
                currentTile: 0,
                useTexture: false
            };
        }

        switch (cmd) {
            case 0x24: // Texture Rectangle
            case 0x25: // Texture Rectangle Flip
                consumed = 24;
                this.handleG_TEXRECT(hi, lo, addr, cmd === 0x25);
                break;
            case 0x2D: // Set Scissor
                break;
            case 0x2E: // Set Prim Depth
                break;
            case 0x2F: // Set Other Modes
                this.rspState.otherModeLo = lo;
                this.rspState.otherModeHi = hi & 0xFFFFFF;
                break;
            case 0x30: // Load TLUT
                break;
            case 0x32: // Set Tile Size
                this.handleG_SETTILESIZE(hi, lo);
                break;
            case 0x33: // Load Block
                this.handleG_LOADBLOCK(hi, lo);
                break;
            case 0x34: // Load Tile
                this.handleG_LOADTILE(hi, lo);
                break;
            case 0x35: // Set Tile
                this.handleG_SETTILE(hi, lo);
                break;
            case 0x36: // Fill Rectangle
                this.handleG_FILLRECT(hi, lo);
                break;
            case 0x37: // Set Fill Color
                this.rspState.fillColor = lo;
                break;
            case 0x38: // Set Fog Color
                this.rspState.fogColor = lo;
                break;
            case 0x39: // Set Blend Color
                this.rspState.blendColor = lo;
                break;
            case 0x3A: // Set Prim Color
                this.rspState.primColor = lo;
                break;
            case 0x3B: // Set Env Color
                this.rspState.envColor = lo;
                break;
            case 0x3C: // Set Combine
                this.rspState.combine.hi = hi & 0xFFFFFF;
                this.rspState.combine.lo = lo;
                this.rspState.useTexture = ((hi & 0x00F00000) !== 0) || ((lo & 0x000000F0) !== 0);
                break;
            case 0x3D: // Set Texture Image
                this.rspState.textureImage = lo & 0x7FFFFF;
                break;
            case 0x3E: // Set Mask Image (Z Image)
                this.rspState.depthImage = lo & 0x7FFFFF;
                break;
            case 0x3F: // Set Color Image
                this.rspState.colorImage = lo & 0x7FFFFF;
                this.rspState.colorImageWidth = (hi & 0xFFF) + 1;
                this.rspState.colorImageSize = (hi >>> 19) & 0x3;
                break;
            case 0x27: // Sync Full
                this.mmu.miRegisters[2] |= 0x20; // DP Interrupt
                this.mmu.updateInterrupts();
                break;
            case 0x28: // Sync Pipe
            case 0x29: // Sync Tile
            case 0x2A: // Sync Load
                break;
            default:
                if (cmd >= 0x08 && cmd <= 0x0F) { // Triangles
                    consumed = 32;
                    if (cmd & 4) consumed += 16; // Shade
                    if (cmd & 2) consumed += 16; // Texture
                    if (cmd & 1) consumed += 16; // Z
                }
                break;
        }
        return consumed;
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
            const output = this.mmu.cpu.decompressMIO0(this.mmu.memory.rdram, dataPtr & 0x7FFFFF);
            if (output) {
                const rdramView = new Uint8Array(this.mmu.memory.rdram);
                rdramView.set(output, yieldDataPtr & 0x7FFFFF);
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
                case 0xD7: // G_TEXTURE (Fast3D uses 0xD7 for some things?)
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
                case 0xB2: // G_MODIFYVTX
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
                case 0xFD: // G_SETTIMG
                    this.rspState.textureImage = lo & 0x7FFFFF;
                    break;
                case 0xFF: // G_SETCIMG
                    this.rspState.colorImage = lo & 0x7FFFFF;
                    this.rspState.colorImageWidth = (hi & 0xFFF) + 1;
                    this.rspState.colorImageFormat = (hi >>> 21) & 0x7;
                    this.rspState.colorImageSize = (hi >>> 19) & 0x3;
                    console.log(`G_SETCIMG: Addr=0x${this.rspState.colorImage.toString(16)} Width=${this.rspState.colorImageWidth} Format=${this.rspState.colorImageFormat} Size=${this.rspState.colorImageSize}`);
                    break;
                case 0xFE: // G_SETZIMG
                    this.rspState.depthImage = lo & 0x7FFFFF;
                    break;
                case 0xF5: // G_SETTILE
                    this.handleG_SETTILE(hi, lo);
                    break;
                case 0xF2: // G_SETTILESIZE
                    this.handleG_SETTILESIZE(hi, lo);
                    break;
                case 0xF4: // G_LOADTILE
                    this.handleG_LOADTILE(hi, lo);
                    break;
                case 0xF3: // G_LOADBLOCK
                    this.handleG_LOADBLOCK(hi, lo);
                    break;
                case 0xFC: // G_SETCOMBINE
                    this.rspState.combine.hi = hi & 0xFFFFFF;
                    this.rspState.combine.lo = lo;
                    // If any of the color sources is TEXEL0 or TEXEL1
                    this.rspState.useTexture = ((hi & 0x00F00000) !== 0) || ((lo & 0x000000F0) !== 0);
                    break;
                case 0xF6: // G_FILLRECT
                    this.handleG_FILLRECT(hi, lo);
                    // console.log(`G_FILLRECT: 0x${hi.toString(16)} 0x${lo.toString(16)}`);
                    break;
                case 0xF7: // G_SETFILLCOLOR
                    this.rspState.fillColor = lo;
                    break;
                case 0xE2: // G_SETOTHERMODE_L (Fast3D)
                case 0xB9: // G_SETOTHERMODE_L (F3DEX)
                    this.rspState.otherModeLo = lo;
                    break;
                case 0xE3: // G_SETOTHERMODE_H (Fast3D)
                case 0xBA: // G_SETOTHERMODE_H (F3DEX)
                    this.rspState.otherModeHi = lo;
                    break;
                case 0xBB: // G_TEXTURE
                    this.rspState.textureScaleS = (lo >>> 16) / 65536.0;
                    this.rspState.textureScaleT = (lo & 0xFFFF) / 65536.0;
                    this.rspState.currentTile = (hi >>> 8) & 0x7;
                    break;
                case 0xED: // G_SETSCISSOR
                    break;
                case 0xFA: // G_SETPRIMCOLOR
                    this.rspState.primColor = lo;
                    break;
                case 0xFB: // G_SETENVCOLOR
                    this.rspState.envColor = lo;
                    break;
                case 0xF9: // G_SETBLENDCOLOR
                    this.rspState.blendColor = lo;
                    break;
                case 0xF8: // G_SETFOGCOLOR
                    this.rspState.fogColor = lo;
                    break;
                case 0xE7: // G_DPPIPESYNC
                case 0xE6: // G_RDPLOADSYNC
                case 0xE8: // G_DPFULLSYNC
                case 0xE9: // G_DPTILESYNC
                    break;
                case 0xB3: // G_RDPHALF_1
                case 0xB4: // G_RDPHALF_2
                    break;
                default:
                    if (!this.warnedCommands.has(cmd)) {
                        console.warn(`Unknown RSP Command: 0x${cmd.toString(16).padStart(2, '0')}`);
                        this.warnedCommands.add(cmd);
                    }
                    break;
            }
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
            this.rspState.tiles[tile].format = (hi >>> 21) & 0x7;
            this.rspState.tiles[tile].size = (hi >>> 19) & 0x3;
            this.rspState.tiles[tile].line = (hi >>> 9) & 0x1FF;
            this.rspState.tiles[tile].tmem = hi & 0x1FF;
            this.rspState.tiles[tile].palette = (lo >>> 20) & 0xF;
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

    handleG_FILLRECT(hi, lo) {
        const x1 = (hi >>> 12) & 0xFFF;
        const y1 = (hi >>> 0) & 0xFFF;
        const x2 = (lo >>> 12) & 0xFFF;
        const y2 = (lo >>> 0) & 0xFFF;

        const addr = this.rspState.colorImage;
        if ((this.mmu.cpu.instructionCount & 0xFFF) === 0) {
             console.log(`G_FILLRECT: (0x${x1.toString(16)}, 0x${y1.toString(16)}) to (0x${x2.toString(16)}, 0x${y2.toString(16)}) Color=0x${this.rspState.fillColor.toString(16)} Addr=0x${addr ? addr.toString(16) : 'NULL'}`);
        }
        if (!addr) return;
        // console.log(`G_FILLRECT: (0x${x1.toString(16)}, 0x${y1.toString(16)}) to (0x${x2.toString(16)}, 0x${y2.toString(16)}) Color=0x${this.rspState.fillColor.toString(16)} Addr=0x${addr.toString(16)}`);

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

    drawTriangle(v1, v2, v3) {
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
                    // Z-Buffer check
                    const z = v1.z * weights.s + v2.z * weights.t + v3.z * weights.u;
                    if (zCmp && zAddr) {
                        const pzAddr = (zAddr + (y * width + x) * 2) & 0x7FFFFF;
                        const oldZ = rdramView.getUint16(pzAddr, false);
                        if (z < oldZ) { // Simplified Z-test
                            if (zUpd) rdramView.setUint16(pzAddr, Math.max(0, Math.min(0xFFFF, z)), false);
                        } else {
                            continue;
                        }
                    }

                    // Fragment Data
                    const shade = {
                        r: v1.r * weights.s + v2.r * weights.t + v3.r * weights.u,
                        g: v1.g * weights.s + v2.g * weights.t + v3.g * weights.u,
                        b: v1.b * weights.s + v2.b * weights.t + v3.b * weights.u,
                        a: v1.a * weights.s + v2.a * weights.t + v3.a * weights.u
                    };

                    const s = (v1.s * weights.s + v2.s * weights.t + v3.s * weights.u) * this.rspState.textureScaleS;
                    const t = (v1.t * weights.s + v2.t * weights.t + v3.t * weights.u) * this.rspState.textureScaleT;

                    const texel0 = this.sampleTexture(s, t, this.rspState.currentTile);

                    // Color Combiner
                    const color = this.combineColor(shade, texel0);

                    // Alpha Testing
                    if (color.a < 1 && (this.rspState.otherModeLo & 0x4000)) continue;

                    const r = color.r, g = color.g, b = color.b;
                    const size = this.rspState.colorImageSize;
                    if (size === 2) {
                        const color16 = (((r >> 3) & 0x1F) << 11) | (((g >> 3) & 0x1F) << 6) | (((b >> 3) & 0x1F) << 1) | ((color.a > 127) ? 1 : 0);
                        const pAddr = (addr + (y * width + x) * 2) & 0x7FFFFF;
                        if (pAddr + 2 <= this.mmu.memory.rdram.byteLength) {
                            rdramView.setUint16(pAddr, color16, false);
                        }
                    } else if (size === 3) {
                        const color32 = ((r & 0xFF) << 24) | ((g & 0xFF) << 16) | ((b & 0xFF) << 8) | (color.a & 0xFF);
                        const pAddr = (addr + (y * width + x) * 4) & 0x7FFFFF;
                        if (pAddr + 4 <= this.mmu.memory.rdram.byteLength) {
                            rdramView.setUint32(pAddr, color32, false);
                        }
                    }
                }
            }
        }
    }

    sampleTexture(s, t, tileIdx) {
        if (!this.rspState.useTexture || this.rspState.textureImage === 0) return { r: 255, g: 255, b: 255, a: 255 };
        const tile = this.rspState.tiles[tileIdx];

        // Improved texture sampling
        let texS = Math.floor(s / 32.0);
        let texT = Math.floor(t / 32.0);

        // Apply masking and shifting
        const maskS = (this.rspState.otherModeHi >> 14) & 0xF;
        const maskT = (this.rspState.otherModeHi >> 4) & 0xF;
        const shiftS = (this.rspState.otherModeHi >> 10) & 0xF;
        const shiftT = this.rspState.otherModeHi & 0xF;

        if (shiftS > 0) { if (shiftS < 11) texS >>= shiftS; else texS <<= (16 - shiftS); }
        if (shiftT > 0) { if (shiftT < 11) texT >>= shiftT; else texT <<= (16 - shiftT); }

        const wrapS = maskS ? (1 << maskS) : 1024;
        const wrapT = maskT ? (1 << maskT) : 1024;

        texS = Math.abs(texS) % wrapS;
        texT = Math.abs(texT) % wrapT;

        const lineBytes = tile.line * 8;
        const tmemAddr = (tile.tmem * 8);

        let r = 255, g = 255, b = 255, a = 255;

        if (tile.format === 0) { // RGBA
            if (tile.size === 2) { // 16-bit RGBA5551
                const addr = tmemAddr + (texT * lineBytes + texS * 2);
                if (addr + 2 <= 4096) {
                    const val = (this.tmem[addr] << 8) | this.tmem[addr + 1];
                    r = ((val >> 11) & 0x1F) << 3;
                    g = ((val >> 6) & 0x1F) << 3;
                    b = ((val >> 1) & 0x1F) << 3;
                    a = (val & 1) ? 255 : 0;
                }
            }
        } else if (tile.format === 4) { // I (Intensity)
            if (tile.size === 0) { // 4-bit I
                const addr = tmemAddr + (texT * lineBytes + (texS >> 1));
                if (addr < 4096) {
                    const byte = this.tmem[addr];
                    const val = (texS & 1) ? (byte & 0xF) : (byte >> 4);
                    r = g = b = a = (val << 4) | val;
                }
            } else if (tile.size === 1) { // 8-bit I
                const addr = tmemAddr + (texT * lineBytes + texS);
                if (addr < 4096) {
                    r = g = b = a = this.tmem[addr];
                }
            }
        } else if (tile.format === 3) { // IA (Intensity-Alpha)
            if (tile.size === 0) { // 4-bit IA (3 intensity, 1 alpha)
                const addr = tmemAddr + (texT * lineBytes + (texS >> 1));
                if (addr < 4096) {
                    const byte = this.tmem[addr];
                    const val = (texS & 1) ? (byte & 0xF) : (byte >> 4);
                    const intensity = ((val >> 1) & 0x7) << 5;
                    r = g = b = intensity;
                    a = (val & 1) ? 255 : 0;
                }
            } else if (tile.size === 1) { // 8-bit IA (4 intensity, 4 alpha)
                const addr = tmemAddr + (texT * lineBytes + texS);
                if (addr < 4096) {
                    const val = this.tmem[addr];
                    const intensity = (val >> 4) << 4;
                    r = g = b = intensity;
                    a = (val & 0xF) << 4;
                }
            }
        }
        return { r, g, b, a };
    }

    combineColor(shade, texel0) {
        const combineHi = this.rspState.combine.hi;
        const combineLo = this.rspState.combine.lo;

        // Simplified 1-cycle combiner: (A - B) * C + D
        // Extracting sources for RGB (Cycle 1)
        const aSrc = (combineHi >> 20) & 0xF;
        const bSrc = (combineHi >> 15) & 0x1F;
        const cSrc = (combineHi >> 10) & 0x1F;
        const dSrc = (combineHi >> 6) & 0x7;

        const getVal = (src, isAlpha) => {
            switch (src) {
                case 0: return isAlpha ? texel0.a : {r: texel0.r, g: texel0.g, b: texel0.b}; // TEXEL0
                case 4: return isAlpha ? shade.a : {r: shade.r, g: shade.g, b: shade.b};     // SHADE
                case 3: { // PRIMITIVE
                    const p = this.rspState.primColor;
                    return isAlpha ? (p & 0xFF) : {r: (p >> 24) & 0xFF, g: (p >> 16) & 0xFF, b: (p >> 8) & 0xFF};
                }
                case 5: { // ENV
                    const e = this.rspState.envColor;
                    return isAlpha ? (e & 0xFF) : {r: (e >> 24) & 0xFF, g: (e >> 16) & 0xFF, b: (e >> 8) & 0xFF};
                }
                case 6: return isAlpha ? 255 : {r: 255, g: 255, b: 255}; // 1.0
                case 7: return isAlpha ? 0 : {r: 0, g: 0, b: 0};         // 0.0
                default: return isAlpha ? 0 : {r: 0, g: 0, b: 0};
            }
        };

        const A = getVal(aSrc, false);
        const B = getVal(bSrc, false);
        const C = getVal(cSrc, false);
        const D = getVal(dSrc, false);

        // N64 C source is usually a multiplier. If it's TEXEL0, we use its components.
        // Simplified:
        const r = (A.r - B.r) * (C.r / 255.0) + D.r;
        const g = (A.g - B.g) * (C.g / 255.0) + D.g;
        const b = (A.b - B.b) * (C.b / 255.0) + D.b;

        // Alpha combiner
        const aASrc = (combineLo >> 12) & 0x7;
        const aBSrc = (combineLo >> 9) & 0x7;
        const aCSrc = (combineLo >> 6) & 0x7;
        const aDSrc = (combineLo >> 3) & 0x7;

        const aA = getVal(aASrc, true);
        const aB = getVal(aBSrc, true);
        const aC = getVal(aCSrc, true);
        const aD = getVal(aDSrc, true);

        const a = (aA - aB) * (aC / 255.0) + aD;

        return {
            r: Math.max(0, Math.min(255, r)),
            g: Math.max(0, Math.min(255, g)),
            b: Math.max(0, Math.min(255, b)),
            a: Math.max(0, Math.min(255, a))
        };
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

    handleG_TEXRECT(hi, lo, addr, flip) {
        // G_TEXRECT is 3 words (24 bytes)
        // Word 0: 24 XL YL (XL, YL are 10.2)
        // Word 1: ?? XH YH (XH, YH are 10.2)
        // Word 2: (G_RDPHALF_1) S T (S, T are 10.5)
        // Word 3: (G_RDPHALF_2) dSdT dSdT (10.5)
        // Actually in RDP direct it's 3 words.
        const rdramView = new DataView(this.mmu.memory.rdram);
        const w1hi = rdramView.getUint32(addr + 8, false);
        const w1lo = rdramView.getUint32(addr + 12, false);
        const w2hi = rdramView.getUint32(addr + 16, false);
        const w2lo = rdramView.getUint32(addr + 20, false);

        const x2 = (hi >>> 12) & 0xFFF;
        const y2 = hi & 0xFFF;
        const tile = (lo >>> 24) & 0x7;
        const x1 = (lo >>> 12) & 0xFFF;
        const y1 = lo & 0xFFF;

        const s = (w1hi >>> 16) & 0xFFFF;
        const t = w1hi & 0xFFFF;
        const dsdx = (w1lo >>> 16) & 0xFFFF;
        const dtdy = w1lo & 0xFFFF;

        // Simplified: draw as two triangles or just a rect
        const v1 = { x: x1/4, y: y1/4, z: 0, r: 255, g: 255, b: 255, a: 255, s: s, t: t };
        const v2 = { x: x2/4, y: y1/4, z: 0, r: 255, g: 255, b: 255, a: 255, s: s + (x2-x1)*dsdx/4, t: t };
        const v3 = { x: x1/4, y: y2/4, z: 0, r: 255, g: 255, b: 255, a: 255, s: s, t: t + (y2-y1)*dtdy/4 };
        const v4 = { x: x2/4, y: y2/4, z: 0, r: 255, g: 255, b: 255, a: 255, s: s + (x2-x1)*dsdx/4, t: t + (y2-y1)*dtdy/4 };

        this.rspState.currentTile = tile;
        this.drawTriangle(v1, v2, v3);
        this.drawTriangle(v2, v3, v4);
    }
}
