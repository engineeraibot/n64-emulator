class RCP {
    constructor(mmu, framebuffer) {
        console.log("RCP Initialized");
        this.mmu = mmu;
        this.framebuffer = framebuffer;
        this.tmem = new Uint8Array(4096);
        this.reset();
    }

    reset() {
        console.log("RCP Reset");
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
        console.log(`RDP Commands: 0x${start.toString(16)} to 0x${end.toString(16)}`);

        const rdramView = new DataView(this.mmu.memory.rdram);
        for (let addr = start; addr < end; addr += 8) {
            const hi = rdramView.getUint32(addr, false);
            const lo = rdramView.getUint32(addr + 4, false);
            this.executeRdpCommand(hi, lo);
        }
    }

    executeRdpCommand(hi, lo) {
        const cmd = (hi >>> 24) & 0x3F;
        switch (cmd) {
            case 0x2F: // Set Other Modes
                break;
            case 0x3F: // Fill Triangle
                break;
            case 0x3E: // Fill Z-Buffer Triangle
                break;
            case 0x24: // Texture Rectangle
                break;
            case 0x25: // Texture Rectangle Flip
                break;
            case 0x27: // Sync Full
                this.mmu.miRegisters[2] |= 0x20; // DP Interrupt
                break;
            case 0x28: // Sync Pipe
            case 0x29: // Sync Tile
            case 0x2A: // Sync Load
                break;
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
        // OSTask structure is usually at SP_DMEM 0xFC0
        const taskPtr = 0xFC0;
        const type = this.mmu.spDmemView.getUint32(taskPtr + 0x00, false);
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
            textureScaleS: 1.0,
            textureScaleT: 1.0
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
                case 0x01: // G_VTX
                    this.handleG_VTX(hi, lo);
                    break;
                case 0xB0: // G_VTX (Variant)
                    this.handleG_VTX(hi, lo);
                    break;
                case 0xBF: // G_TRI1 (F3D)
                    this.handleG_TRI1(hi, lo);
                    break;
                case 0xB1: // G_TRI2 (F3D)
                    this.handleG_TRI2(hi, lo);
                    break;
                case 0xBC: // G_MOVEWORD
                    this.handleG_MOVEWORD(hi, lo);
                    break;
                case 0xBD: // G_MOVEMEM
                    this.handleG_MOVEMEM(hi, lo);
                    break;
                case 0xB1: // G_TRI2
                    this.handleG_TRI2(hi, lo);
                    break;
                case 0xB2: // G_MODIFYVTX
                    break;
                case 0xDB: // G_SETSEGMENT
                    const seg = (hi >>> 2) & 0xF;
                    this.rspState.segments[seg] = lo & 0xFFFFFF;
                    break;
                case 0xFD: // G_SETTIMG
                    this.rspState.textureImage = this.resolveAddress(lo);
                    break;
                case 0xFF: // G_SETCIMG
                    this.rspState.colorImage = this.resolveAddress(lo);
                    this.rspState.colorImageWidth = (hi & 0xFFF) + 1;
                    this.rspState.colorImageFormat = (hi >>> 21) & 0x7;
                    this.rspState.colorImageSize = (hi >>> 19) & 0x3;
                    break;
                case 0xFE: // G_SETZIMG
                    this.rspState.depthImage = this.resolveAddress(lo);
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
                    break;
                case 0xED: // G_SETSCISSOR
                    break;
                case 0xFA: // G_SETPRIMCOLOR
                    break;
                case 0xFB: // G_SETENVCOLOR
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
        const num = (hi >>> 12) & 0xFF;
        const dest = (hi & 0xFF) / 2; // Index in vertex buffer
        const addr = this.resolveAddress(lo);
        const rdramView = new DataView(this.mmu.memory.rdram);

        const mv = this.rspState.modelviewStack[this.rspState.modelviewStack.length - 1];
        const p = this.rspState.projectionMatrix;
        const mvp = this.multiplyMatrices(mv, p);

        for (let i = 0; i < num; i++) {
            const vAddr = (addr + i * 16) & 0x7FFFFF;
            const x = rdramView.getInt16(vAddr, false);
            const y = rdramView.getInt16(vAddr + 2, false);
            const z = rdramView.getInt16(vAddr + 4, false);

            // Transform
            const tx = x * mvp[0] + y * mvp[4] + z * mvp[8] + mvp[12];
            const ty = x * mvp[1] + y * mvp[5] + z * mvp[9] + mvp[13];
            const tz = x * mvp[2] + y * mvp[6] + z * mvp[10] + mvp[14];
            const tw = x * mvp[3] + y * mvp[7] + z * mvp[11] + mvp[15];

            // Simple Viewport Transformation (assuming 320x240)
            let screenX = 160;
            let screenY = 120;
            if (Math.abs(tw) > 0.0001) {
                screenX = (tx / tw) * 160 + 160;
                screenY = -(ty / tw) * 120 + 120;
            }

            const s = rdramView.getInt16(vAddr + 8, false);
            const t = rdramView.getInt16(vAddr + 10, false);
            const r = rdramView.getUint8(vAddr + 12);
            const g = rdramView.getUint8(vAddr + 13);
            const b = rdramView.getUint8(vAddr + 14);
            const a = rdramView.getUint8(vAddr + 15);

            this.rspState.vertices[dest + i] = { x: screenX, y: screenY, z: tz, r, g, b, a, s, t };
        }
    }

    handleG_TRI1(hi, lo) {
        const v1idx = (lo >>> 16) & 0xFF;
        const v2idx = (lo >>> 8) & 0xFF;
        const v3idx = (lo >>> 0) & 0xFF;

        const v1 = this.rspState.vertices[v1idx / 2];
        const v2 = this.rspState.vertices[v2idx / 2];
        const v3 = this.rspState.vertices[v3idx / 2];

        if (v1 && v2 && v3) {
            this.drawTriangle(v1, v2, v3);
        }
    }

    handleG_TRI2(hi, lo) {
        const v1idx = (hi >>> 16) & 0xFF;
        const v2idx = (hi >>> 8) & 0xFF;
        const v3idx = (hi >>> 0) & 0xFF;
        const v4idx = (lo >>> 16) & 0xFF;
        const v5idx = (lo >>> 8) & 0xFF;
        const v6idx = (lo >>> 0) & 0xFF;

        const v1 = this.rspState.vertices[v1idx / 2];
        const v2 = this.rspState.vertices[v2idx / 2];
        const v3 = this.rspState.vertices[v3idx / 2];
        if (v1 && v2 && v3) this.drawTriangle(v1, v2, v3);

        const v4 = this.rspState.vertices[v4idx / 2];
        const v5 = this.rspState.vertices[v5idx / 2];
        const v6 = this.rspState.vertices[v6idx / 2];
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
        if (index === 0x01) { // G_MV_VIEWPORT
            const vAddr = addr & 0x7FFFFF;
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
        const tile = lo >>> 24;
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

        const G_MTX_PUSH = 0x01;
        const G_MTX_LOAD = 0x02;
        const G_MTX_PROJECTION = 0x04;

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
        const size = (lrs + 1) * 8;

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
        const tile = lo >>> 24;
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
        if (!addr) return;

        const rdramView = new DataView(this.mmu.memory.rdram);
        const color = (this.rspState.fillColor >>> 16) & 0xFFFF;

        const startX = Math.floor(x1 / 4);
        const startY = Math.floor(y1 / 4);
        const endX = Math.floor(x2 / 4);
        const endY = Math.floor(y2 / 4);

        const width = this.rspState.colorImageWidth;
        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                const pAddr = (addr + (y * width + x) * 2) & 0x7FFFFF;
                if (pAddr + 2 <= this.mmu.memory.rdram.byteLength) {
                    rdramView.setUint16(pAddr, color, false);
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
        const tile = this.rspState.tiles[0]; // Simplified: assume tile 0
        const width = this.rspState.colorImageWidth;

        for (let y = minY; y <= maxY; y++) {
            if (y < 0 || y >= 240) continue;
            for (let x = minX; x <= maxX; x++) {
                if (x < 0 || x >= width) continue;
                const weights = this.getBarycentricWeights(x, y, x1, y1, x2, y2, x3, y3);
                if (weights) {
                    let r, g, b;

                    // Texture coordinates
                    const s = (v1.s * weights.s + v2.s * weights.t + v3.s * weights.u) * this.rspState.textureScaleS;
                    const t = (v1.t * weights.s + v2.t * weights.t + v3.t * weights.u) * this.rspState.textureScaleT;

                    // Simplified texture sampling (Point sampling, 16-bit RGBA)
                    const texS = Math.floor(s / 32.0);
                    const texT = Math.floor(t / 32.0);

                    const maskS = (tile.lrs - tile.uls) / 4 + 1;
                    const maskT = (tile.lrt - tile.ult) / 4 + 1;
                    const ts = Math.abs(texS) % (maskS || 32);
                    const tt = Math.abs(texT) % (maskT || 32);

                    const lineBytes = tile.line * 8;
                    const texAddr = (tile.tmem * 8) + (tt * lineBytes + ts * 2);

                    if (this.rspState.useTexture && texAddr + 2 <= 4096 && this.rspState.textureImage !== 0) {
                        const val = (this.tmem[texAddr] << 8) | this.tmem[texAddr + 1];
                        r = ((val >> 11) & 0x1F) << 3;
                        g = ((val >> 6) & 0x1F) << 3;
                        b = ((val >> 1) & 0x1F) << 3;
                    } else {
                        r = v1.r * weights.s + v2.r * weights.t + v3.r * weights.u;
                        g = v1.g * weights.s + v2.g * weights.t + v3.g * weights.u;
                        b = v1.b * weights.s + v2.b * weights.t + v3.b * weights.u;
                    }

                    const color16 = (((r >> 3) & 0x1F) << 11) | (((g >> 3) & 0x1F) << 6) | (((b >> 3) & 0x1F) << 1) | 1;

                    const pAddr = (addr + (y * width + x) * 2) & 0x7FFFFF;
                    if (pAddr + 2 <= this.mmu.memory.rdram.byteLength) {
                        rdramView.setUint16(pAddr, color16, false);
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
