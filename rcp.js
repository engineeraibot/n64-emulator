class RCP {
    constructor(mmu, framebuffer) {
        this.mmu = mmu;
        this.framebuffer = framebuffer;
        this.tmem = new Uint8Array(4096);
        this.rdpCommandCount = 0;
        this.reset();
    }

    reset() {
        this.rdpCommandCount = 0;
        this.rspState = null;
        if (this.mmu) {
            this.mmu.spRegisters[4] |= 0x01; // HALT
            this.mmu.miRegisters[2] = 0;
        }
    }

    handleSpWrite(address, value) {
        const regIdx = (address - 0x04040000) >> 2;
        if (regIdx === 2) {
            this.mmu.spRegisters[2] = value;
            this.doSpDma(false);
        } else if (regIdx === 3) {
            this.mmu.spRegisters[3] = value;
            this.doSpDma(true);
        } else if (regIdx === 4) { // SP_STATUS
            const oldStatus = this.mmu.spRegisters[4];
            if (value & 0x00000001) this.mmu.spRegisters[4] &= ~0x01; // Clear Halt
            if (value & 0x00000002) this.mmu.spRegisters[4] |= 0x01;  // Set Halt
            if (value & 0x00000004) this.mmu.spRegisters[4] &= ~0x02; // Clear Broke
            if (value & 0x00000008) { this.mmu.miRegisters[2] &= ~0x01; this.mmu.updateInterrupts(); } // Clear SP Interrupt
            if (value & 0x00000010) { this.mmu.miRegisters[2] |= 0x01; this.mmu.updateInterrupts(); } // Set SP Interrupt
            if (value & 0x00000020) this.mmu.spRegisters[4] &= ~0x00000004; // Clear Single Step
            if (value & 0x00000040) this.mmu.spRegisters[4] |= 0x00000004;  // Set Single Step
            if (value & 0x00000200) this.mmu.spRegisters[4] &= ~0x00000010; // Clear Sig0
            if (value & 0x00000400) this.mmu.spRegisters[4] |= 0x00000010; // Set Sig0
            if (value & 0x00000800) this.mmu.spRegisters[4] &= ~0x00000020; // Clear Sig1
            if (value & 0x00001000) this.mmu.spRegisters[4] |= 0x00000020; // Set Sig1

            // If Halt bit is cleared, trigger task
            if ((oldStatus & 0x01) && !(this.mmu.spRegisters[4] & 0x01)) {
                this.runRspTask();
                this.mmu.spRegisters[4] |= 0x03; // HALT and BROKE
                this.mmu.miRegisters[2] |= 0x01; // SP Interrupt
                this.mmu.updateInterrupts();
            }
        } else {
            this.mmu.spRegisters[regIdx] = value;
        }
    }

    doSpDma(isToDram) {
        const spAddr = this.mmu.spRegisters[0] & 0x1FFF;
        const dramAddr = this.mmu.spRegisters[1] & 0x007FFFFF;
        const len = (this.mmu.spRegisters[isToDram ? 3 : 2] & 0xFFF) + 1;
        const rdramView = new Uint8Array(this.mmu.memory.rdram);
        const spMem = (spAddr & 0x1000) ? this.mmu.spImem : this.mmu.spDmem;
        const spOff = spAddr & 0xFFF;
        for (let i = 0; i < len; i++) {
            if (isToDram) rdramView[dramAddr + i] = spMem[spOff + i];
            else spMem[spOff + i] = rdramView[dramAddr + i];
        }
    }

    handleDpcWrite(address, value) {
        const regIdx = (address - 0x04100000) >> 2;
        this.mmu.dpcRegisters[regIdx] = value;
        if (regIdx === 1) { // DPC_END
            this.processRdpCommands();
            this.mmu.dpcRegisters[3] = this.mmu.dpcRegisters[1]; // DPC_CURRENT = DPC_END
            this.mmu.miRegisters[2] |= 0x20; // DP Interrupt
            this.mmu.updateInterrupts();
        }
    }

    processRdpCommands() {
        let addr = this.mmu.dpcRegisters[0] & 0x7FFFFF;
        let end = this.mmu.dpcRegisters[1] & 0x7FFFFF;
        const rdramView = new DataView(this.mmu.memory.rdram);
        while (addr < end) {
            const hi = rdramView.getUint32(addr, false);
            const lo = rdramView.getUint32(addr + 4, false);
            const consumed = this.executeRdpCommand(hi, lo, addr);
            addr += consumed;
            if (consumed === 0) break;
        }
    }

    executeRdpCommand(hi, lo, addr) {
        this.rdpCommandCount++;
        const cmd = (hi >>> 24) & 0x3F;
        if (!this.rspState) this.initRspState();
        let consumed = 8;
        switch (cmd) {
            case 0x24: case 0x25: // TEXRECT
                this.handleG_TEXRECT(hi, lo, addr, cmd === 0x25);
                consumed = 24;
                break;
            case 0x2F: // SETOTHERMODE
                this.rspState.otherModeLo = lo;
                this.rspState.otherModeHi = hi & 0xFFFFFF;
                break;
            case 0x32: this.handleG_SETTILESIZE(hi, lo); break;
            case 0x33: this.handleG_LOADBLOCK(hi, lo); break;
            case 0x34: this.handleG_LOADTILE(hi, lo); break;
            case 0x35: this.handleG_SETTILE(hi, lo); break;
            case 0x36: this.handleG_FILLRECT(hi, lo); break;
            case 0x37: this.rspState.fillColor = lo; break;
            case 0x3A: this.rspState.primColor = lo; break;
            case 0x3B: this.rspState.envColor = lo; break;
            case 0x3C:
                this.rspState.combine.hi = hi & 0xFFFFFF;
                this.rspState.combine.lo = lo;
                this.updateUseTexture(hi, lo);
                break;
            case 0x3D:
                this.rspState.textureImage = this.resolvePhysicalAddress(lo);
                this.rspState.textureImageWidth = (hi & 0xFFF) + 1;
                this.rspState.textureImageSize = (hi >>> 19) & 0x3;
                break;
            case 0x3E: this.rspState.depthImage = this.resolvePhysicalAddress(lo) & 0x7FFFFF; break;
            case 0x3F:
                this.rspState.colorImage = this.resolvePhysicalAddress(lo) & 0x7FFFFF;
                this.rspState.colorImageWidth = (hi & 0xFFF) + 1;
                this.rspState.colorImageSize = (hi >>> 19) & 0x3;
                break;
            case 0x27: // FULLSYNC stub
                this.mmu.miRegisters[2] |= 0x20;
                this.mmu.updateInterrupts();
                break;
        }
        return consumed;
    }

    initRspState() {
        this.rspState = {
            segments: new Uint32Array(16),
            vertices: new Array(64).fill(0).map(() => ({ x: 0, y: 0, z: 0, w: 1, r: 0, g: 0, b: 0, a: 0, s: 0, t: 0 })),
            modelviewStack: [this.createIdentityMatrix()],
            projectionMatrix: this.createIdentityMatrix(),
            tiles: new Array(8).fill(0).map(() => ({
                format: 0, size: 0, line: 0, tmem: 0, palette: 0,
                uls: 0, ult: 0, lrs: 0, lrt: 0,
                maskS: 0, shiftS: 0, mirrorS: 0, wrapS: 0,
                maskT: 0, shiftT: 0, mirrorT: 0, wrapT: 0
            })),
            combine: { hi: 0, lo: 0 },
            primColor: 0xFFFFFFFF, envColor: 0, fillColor: 0, colorImage: 0, colorImageWidth: 320, colorImageSize: 2,
            textureImage: 0, textureImageWidth: 0, textureImageSize: 2,
            textureScaleS: 1.0, textureScaleT: 1.0, otherModeHi: 0, otherModeLo: 0, currentTile: 0, useTexture: false,
            geometryMode: 0
        };
    }

    runRspTask() {
        const taskPtr = 0xFC0;
        const type = this.mmu.spDmemView.getUint32(taskPtr + 0x00, false);
        const dataPtr = this.mmu.spDmemView.getUint32(taskPtr + 0x30, false);
        const yieldDataPtr = this.mmu.spDmemView.getUint32(taskPtr + 0x38, false) & 0x7FFFFF;

        console.log(`RSP Task: type=${type} dataPtr=0x${dataPtr.toString(16)}`);

        try {
            if (type === 4) { // MIO0 Decompression
                let input = this.mmu.memory.rdram;
                let offset = dataPtr & 0x7FFFFF;
                if ((dataPtr >= 0x10000000 && dataPtr <= 0x1FBFFFFF) || (dataPtr >= 0x08000000 && dataPtr <= 0x0FFFFFFF)) {
                    input = this.mmu.memory.rom;
                    offset = (dataPtr & 0x0FFFFFFF) % this.mmu.memory.rom.byteLength;
                }
                const out = this.mmu.cpu.decompressMIO0(input, offset);
                if (out) {
                    const dest = new Uint8Array(this.mmu.memory.rdram);
                    const len = Math.min(out.length, 0x800000 - yieldDataPtr);
                    if (len > 0) dest.set(out.subarray(0, len), yieldDataPtr);
                }
            } else if (type === 1) { // Graphics
                let startAddr = (dataPtr & 0x7FFFFF) | 0x80000000;
                if ((dataPtr >= 0x10000000 && dataPtr <= 0x1FBFFFFF) || (dataPtr >= 0x08000000 && dataPtr <= 0x0FFFFFFF)) {
                    startAddr = (dataPtr & 0x1FFFFFFF) | 0x80000000;
                }
                this.processDisplayList(startAddr);
            }
        } catch (e) {
            console.error("RSP Task Error:", e);
        }
    }

    processDisplayList(addr) {
        if (!this.rspState) this.initRspState();
        let pc = addr, depth = 0, stack = [];
        console.log(`RSP: Starting Display List at 0x${addr.toString(16)}`);

        let cmdCount = 0;
        while (pc !== 0 && cmdCount < 50000) {
            cmdCount++;
            const hi = this.mmu.read32(Number(pc));
            const lo = this.mmu.read32(Number(pc + 4));
            const cmd = (hi >>> 24) & 0xFF;
            if (cmdCount < 100) console.log(`RSP: CMD=0x${cmd.toString(16).padStart(2, '0')} HI=0x${hi.toString(16).padStart(8, '0')} LO=0x${lo.toString(16).padStart(8, '0')}`);
            pc += 8;
            this.rdpCommandCount++;

            switch (cmd) {
                case 0x05: this.handleG_TRI1(hi, lo, true); break;
                case 0x06: // G_DL (F3D) or G_TRI2 (F3DEX2)
                    if (this.rspState.isF3DEX2) {
                        this.handleG_TRI2(hi, lo, true);
                    } else {
                        this.rspState.isF3DEX2 = false;
                        const nextDlF3D = this.resolveAddress(lo);
                        if ((hi >>> 16) & 0xFF) {
                            if (depth < 16) { stack.push(pc); depth++; pc = nextDlF3D; }
                        } else pc = nextDlF3D;
                    }
                    break;
                case 0xDE: // G_DL (F3DEX2)
                    this.rspState.isF3DEX2 = true;
                    const nextDl = this.resolveAddress(lo);
                    if ((hi >>> 16) & 0xFF) {
                        if (depth < 16) { stack.push(pc); depth++; pc = nextDl; }
                    } else pc = nextDl;
                    break;
                case 0xB8: // G_ENDDL (F3D)
                case 0xDF: // G_ENDDL (F3DEX2)
                    if (depth > 0) { depth--; pc = stack.pop(); }
                    else return;
                    break;
                case 0x01: // G_MTX (F3D)
                case 0xDA: // G_MTX (F3DEX2)
                    this.handleG_MTX(hi, lo);
                    break;
                case 0xD8: if (this.rspState.modelviewStack.length > 1) this.rspState.modelviewStack.pop(); break;
                case 0x04: this.handleG_VTX(hi, lo); break;
                case 0xBF: this.handleG_TRI1(hi, lo, false); break;
                case 0xB1: this.handleG_TRI2(hi, lo, false); break;
                case 0xBC: this.handleG_MOVEWORD(hi, lo); break;
                case 0xB6: this.rspState.geometryMode &= ~lo; break; // G_CLRGEOMETRYMODE
                case 0xB7: this.rspState.geometryMode |= lo; break;  // G_SETGEOMETRYMODE
                case 0x03: // G_MOVEMEM (F3D)
                case 0xBD: // G_MOVEMEM (F3DEX2)
                    this.handleG_MOVEMEM(hi, lo);
                    break;
                case 0xDB: this.rspState.segments[(hi >> 2) & 0xF] = lo & 0x00FFFFFF; break;
                case 0xFD:
                    this.rspState.textureImage = this.resolvePhysicalAddress(lo);
                    this.rspState.textureImageWidth = (hi & 0xFFF) + 1;
                    this.rspState.textureImageSize = (hi >>> 19) & 0x3;
                    break;
                case 0xFF:
                    this.rspState.colorImage = this.resolvePhysicalAddress(lo) & 0x7FFFFF;
                    this.rspState.colorImageWidth = (hi & 0xFFF) + 1;
                    this.rspState.colorImageSize = (hi >>> 19) & 0x3;
                    break;
                case 0xFE: this.rspState.depthImage = this.resolvePhysicalAddress(lo) & 0x7FFFFF; break;
                case 0xF5: this.handleG_SETTILE(hi, lo); break;
                case 0xF2: this.handleG_SETTILESIZE(hi, lo); break;
                case 0xF4: this.handleG_LOADTILE(hi, lo); break;
                case 0xF3: this.handleG_LOADBLOCK(hi, lo); break;
                case 0xFC:
                    this.rspState.combine.hi = hi & 0xFFFFFF;
                    this.rspState.combine.lo = lo;
                    this.updateUseTexture(hi, lo);
                    break;
                case 0xF6: this.handleG_FILLRECT(hi, lo); break;
                case 0xF7: this.rspState.fillColor = lo; break;
                case 0xE4: // G_TEXRECT
                    this.handleG_TEXRECT(hi, lo, pc - 8, false);
                    pc += 16;
                    break;
                case 0xE5: // G_TEXRECTFLIP
                    this.handleG_TEXRECT(hi, lo, pc - 8, true);
                    pc += 16;
                    break;
                case 0xB9: this.rspState.otherModeLo = lo; break;
                case 0xBA: this.rspState.otherModeHi = lo; break;
                case 0xBB: // G_TEXTURE
                    this.rspState.textureScaleS = (lo >>> 16) / 65536.0;
                    this.rspState.textureScaleT = (lo & 0xFFFF) / 65536.0;
                    this.rspState.currentTile = (hi >>> 8) & 0x7;
                    this.rspState.useTexture = (hi & 1) !== 0;
                    break;
                case 0xFA: this.rspState.primColor = lo; break;
                case 0xFB: this.rspState.envColor = lo; break;
                case 0xF9: this.rspState.blendColor = lo; break;
                case 0xF8: this.rspState.fogColor = lo; break;
                case 0xD9: // G_GEOMETRYMODE (F3DEX2)
                    this.rspState.geometryMode = (this.rspState.geometryMode & ~(hi & 0xFFFFFF)) | lo;
                    break;
                case 0xE7: case 0xE6: case 0xE8: break; // Syncs
                case 0xE9: // FULLSYNC
                    this.mmu.miRegisters[2] |= 0x20;
                    this.mmu.updateInterrupts();
                    break;
                case 0xF0: // G_LOADTLUT stub
                    break;
            }
        }
    }

    createIdentityMatrix() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }

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

    readMatrix(addr) {
        const m = new Array(16);
        for (let i = 0; i < 16; i++) {
            const hi = this.mmu.read16(addr + i * 2);
            const lo = this.mmu.read16(addr + 32 + i * 2);
            const hiSigned = (hi << 16) >> 16;
            m[i] = hiSigned + lo / 65536.0;
        }
        return m;
    }

    resolveAddress(addr) {
        const seg = (addr >>> 24) & 0xF;
        const base = this.rspState.segments[seg];
        // If segment base looks like a virtual or physical address with mirroring, preserve it
        if ((base & 0xF8000000) !== 0) {
            return (base + (addr & 0x00FFFFFF)) | 0x80000000;
        }
        return ((base & 0x00FFFFFF) + (addr & 0x00FFFFFF)) | 0x80000000;
    }

    resolvePhysicalAddress(addr) {
        const seg = (addr >>> 24) & 0xF;
        const base = this.rspState.segments[seg];
        if ((base & 0x10000000) || (base & 0x08000000)) {
            return (base + (addr & 0x00FFFFFF)) & 0x1FFFFFFF;
        }
        return (base & 0x00FFFFFF) + (addr & 0x00FFFFFF);
    }

    handleG_VTX(hi, lo) {
        let num, dest;
        if (this.rspState.isF3DEX2) {
            num = (hi >>> 16) & 0xFF;
            dest = (hi >> 1) & 0x7F;
        } else {
            num = ((hi >> 10) & 0x3F) + 1;
            dest = (hi & 0x3FF) / 16;
        }
        const addr = this.resolveAddress(lo);
        const mv = this.rspState.modelviewStack[this.rspState.modelviewStack.length - 1];
        const p = this.rspState.projectionMatrix;
        const mvp = this.multiplyMatrices(mv, p);

        for (let i = 0; i < num; i++) {
            const v = addr + i * 16;
            const x = (this.mmu.read16(v) << 16) >> 16;
            const y = (this.mmu.read16(v + 2) << 16) >> 16;
            const z = (this.mmu.read16(v + 4) << 16) >> 16;
            const tx = x * mvp[0] + y * mvp[4] + z * mvp[8] + mvp[12];
            const ty = x * mvp[1] + y * mvp[5] + z * mvp[9] + mvp[13];
            const tz = x * mvp[2] + y * mvp[6] + z * mvp[10] + mvp[14];
            const tw = x * mvp[3] + y * mvp[7] + z * mvp[11] + mvp[15];

            let sx = 160, sy = 120, sz = tz;
            if (Math.abs(tw) > 0.0001) {
                if (this.rspState.viewport) {
                    const vp = this.rspState.viewport;
                    sx = (tx / tw) * vp.scale[0] + vp.trans[0];
                    sy = (-(ty / tw) * vp.scale[1] + vp.trans[1]);
                    sz = (tz / tw) * vp.scale[2] + vp.trans[2];
                } else {
                    sx = (tx / tw) * 160 + 160;
                    sy = -(ty / tw) * 120 + 120;
                }
            }
            this.rspState.vertices[dest + i] = {
                x: sx, y: sy, z: sz,
                r: this.mmu.read8(v + 12), g: this.mmu.read8(v + 13), b: this.mmu.read8(v + 14), a: this.mmu.read8(v + 15),
                s: (this.mmu.read16(v + 8) << 16) >> 16, t: (this.mmu.read16(v + 10) << 16) >> 16
            };
        }
    }

    handleG_TRI1(hi, lo, isEX2) {
        const s = isEX2 ? 2 : 16;
        const v1 = this.rspState.vertices[((isEX2 ? hi >> 16 : lo >> 16) & 0xFF) / s];
        const v2 = this.rspState.vertices[((isEX2 ? hi >> 8 : lo >> 8) & 0xFF) / s];
        const v3 = this.rspState.vertices[((isEX2 ? hi : lo) & 0xFF) / s];
        if (v1 && v2 && v3) this.drawTriangle(v1, v2, v3);
    }

    handleG_TRI2(hi, lo, isEX2) {
        const s = isEX2 ? 2 : 16;
        const v1 = this.rspState.vertices[((hi >> 16) & 0xFF) / s];
        const v2 = this.rspState.vertices[((hi >> 8) & 0xFF) / s];
        const v3 = this.rspState.vertices[(hi & 0xFF) / s];
        if (v1 && v2 && v3) this.drawTriangle(v1, v2, v3);

        const v4 = this.rspState.vertices[((lo >> 16) & 0xFF) / s];
        const v5 = this.rspState.vertices[((lo >> 8) & 0xFF) / s];
        const v6 = this.rspState.vertices[(lo & 0xFF) / s];
        if (v4 && v5 && v6) this.drawTriangle(v4, v5, v6);
    }

    handleG_MOVEMEM(hi, lo) {
        const idx = (hi >>> 16) & 0xFF;
        const addr = this.resolveAddress(lo);
        if (idx === 0x01 || idx === 0x80) {
            this.rspState.viewport = {
                scale: [((this.mmu.read16(addr) << 16) >> 16) / 4.0, ((this.mmu.read16(addr + 2) << 16) >> 16) / 4.0, ((this.mmu.read16(addr + 4) << 16) >> 16) / 512.0],
                trans: [((this.mmu.read16(addr + 8) << 16) >> 16) / 4.0, ((this.mmu.read16(addr + 10) << 16) >> 16) / 4.0, ((this.mmu.read16(addr + 12) << 16) >> 16) / 512.0]
            };
        }
    }

    handleG_MTX(hi, lo) {
        const f = (hi >>> 16) & 0xFF, m = this.readMatrix(this.resolveAddress(lo));
        if (f & 0x01) {
            if (f & 0x02) this.rspState.projectionMatrix = m;
            else this.rspState.projectionMatrix = this.multiplyMatrices(m, this.rspState.projectionMatrix);
        } else {
            let cur = this.rspState.modelviewStack[this.rspState.modelviewStack.length - 1];
            let next = (f & 0x02) ? m : this.multiplyMatrices(m, cur);
            if (f & 0x04) this.rspState.modelviewStack.push(next);
            else this.rspState.modelviewStack[this.rspState.modelviewStack.length - 1] = next;
        }
    }

    handleG_FILLRECT(hi, lo) {
        const x2 = (hi >>> 12) & 0xFFF, y2 = hi & 0xFFF, x1 = (lo >>> 12) & 0xFFF, y1 = lo & 0xFFF;
        const addr = this.rspState.colorImage;
        if (!addr) return;
        const rd = new DataView(this.mmu.memory.rdram);
        const sz = this.rspState.colorImageSize;
        const w = this.rspState.colorImageWidth;

        const bpp = (sz === 3) ? 4 : (sz === 2 ? 2 : 1);
        const fillVal = (sz === 2) ? (this.rspState.fillColor >>> 16) & 0xFFFF : this.rspState.fillColor;

        for (let y = Math.floor(y1 / 4); y < Math.floor(y2 / 4); y++) {
            if (y < 0 || y >= 240) continue;
            for (let x = Math.floor(x1 / 4); x < Math.floor(x2 / 4); x++) {
                if (x < 0 || x >= w) continue;
                const p = (addr + (y * w + x) * bpp) & 0x7FFFFF;
                if (sz === 3) rd.setUint32(p, fillVal, false);
                else if (sz === 2) rd.setUint16(p, fillVal, false);
                else rd.setUint8(p, fillVal & 0xFF);
            }
        }
    }

    drawTriangle(v1, v2, v3) {
        const addr = this.rspState.colorImage;
        if (!addr) return;
        if (this.rdpCommandCount < 100) console.log(`RDP: Drawing Triangle at 0x${addr.toString(16)}`);
        const x1 = v1.x, y1 = v1.y, x2 = v2.x, y2 = v2.y, x3 = v3.x, y3 = v3.y;
        const minX = Math.floor(Math.min(x1, x2, x3)), maxX = Math.ceil(Math.max(x1, x2, x3));
        const minY = Math.floor(Math.min(y1, y2, y3)), maxY = Math.ceil(Math.max(y1, y2, y3));
        const rd = new DataView(this.mmu.memory.rdram), w = this.rspState.colorImageWidth, zAddr = this.rspState.depthImage;

        for (let y = minY; y <= maxY; y++) {
            if (y < 0 || y >= 240) continue;
            for (let x = minX; x <= maxX; x++) {
                if (x < 0 || x >= w) continue;
                const weights = this.getBarycentricWeights(x, y, x1, y1, x2, y2, x3, y3);
                if (weights) {
                    const z = v1.z * weights.s + v2.z * weights.t + v3.z * weights.u;
                    if (zAddr && (this.rspState.otherModeLo & 0x10)) {
                        const pz = (zAddr + (y * w + x) * 2) & 0x7FFFFF;
                        if (z >= rd.getUint16(pz, false)) continue;
                        if (this.rspState.otherModeLo & 0x20) rd.setUint16(pz, Math.max(0, Math.min(0xFFFF, z)), false);
                    }
                    const shade = {
                        r: v1.r * weights.s + v2.r * weights.t + v3.r * weights.u,
                        g: v1.g * weights.s + v2.g * weights.t + v3.g * weights.u,
                        b: v1.b * weights.s + v2.b * weights.t + v3.b * weights.u,
                        a: v1.a * weights.s + v2.a * weights.t + v3.a * weights.u
                    };
                    const s = (v1.s * weights.s + v2.s * weights.t + v3.s * weights.u) * this.rspState.textureScaleS;
                    const t = (v1.t * weights.s + v2.t * weights.t + v3.t * weights.u) * this.rspState.textureScaleT;
                    const tex = this.sampleTexture(s, t, this.rspState.currentTile);
                    const color = this.combineColor(shade, tex);
                    if (color.a < 1 && (this.rspState.otherModeLo & 0x4000)) continue;
                    const p = (addr + (y * w + x) * (this.rspState.colorImageSize === 3 ? 4 : 2)) & 0x7FFFFF;
                    if (this.rspState.colorImageSize === 2) {
                        rd.setUint16(p, (((color.r >> 3) & 0x1F) << 11) | (((color.g >> 3) & 0x1F) << 6) | (((color.b >> 3) & 0x1F) << 1) | (color.a > 127 ? 1 : 0), false);
                    } else {
                        rd.setUint32(p, (color.r << 24) | (color.g << 16) | (color.b << 8) | color.a, false);
                    }
                }
            }
        }
    }

    getBarycentricWeights(px, py, x1, y1, x2, y2, x3, y3) {
        const det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
        if (Math.abs(det) < 0.0001) return null;
        const s = ((y2 - y3) * (px - x3) + (x3 - x2) * (py - y3)) / det;
        const t = ((y3 - y1) * (px - x3) + (x1 - x3) * (py - y3)) / det;
        const u = 1 - s - t;
        return (s >= 0 && t >= 0 && u >= 0) ? { s, t, u } : null;
    }

    sampleTexture(s, t, tileIdx) {
        if (!this.rspState.useTexture) return { r: 255, g: 255, b: 255, a: 255 };
        const tile = this.rspState.tiles[tileIdx];
        let ts = s / 32.0, tt = t / 32.0;

        const applyParams = (v, mask, shift, mirror, wrap) => {
            if (shift > 0 && shift <= 10) v /= (1 << shift);
            if (shift > 10) v *= (1 << (16 - shift));
            let iv = Math.floor(v);
            if (mask > 0) {
                const size = 1 << mask;
                if (mirror && (iv & size)) iv = (size - 1) - (iv & (size - 1));
                else iv = iv & (size - 1);
            }
            return iv;
        };

        const finalS = applyParams(ts, tile.maskS, tile.shiftS, tile.mirrorS, tile.wrapS);
        const finalT = applyParams(tt, tile.maskT, tile.shiftT, tile.mirrorT, tile.wrapT);

        if (tile.format === 0 && tile.size === 2) { // RGBA 16-bit
            const p = (tile.tmem * 8 + finalT * tile.line * 8 + finalS * 2);
            if (p + 1 >= 4096) return { r: 255, g: 255, b: 255, a: 255 };
            const v = (this.tmem[p] << 8) | this.tmem[p + 1];
            return { r: ((v >> 11) & 0x1F) << 3, g: ((v >> 6) & 0x1F) << 3, b: ((v >> 1) & 0x1F) << 3, a: (v & 1) ? 255 : 0 };
        } else if (tile.format === 2) { // CI
            const p = (tile.tmem * 8 + finalT * tile.line * 8 + (tile.size === 1 ? finalS : finalS >> 1));
            if (p >= 4096) return { r: 255, g: 255, b: 255, a: 255 };
            const idx = (tile.size === 1) ? this.tmem[p] : (finalS & 1 ? this.tmem[p] & 0xF : this.tmem[p] >> 4);
            const palOff = 2048 + (tile.palette * 16 + idx) * 2;
            const v = (this.tmem[palOff] << 8) | this.tmem[palOff + 1];
            return { r: ((v >> 11) & 0x1F) << 3, g: ((v >> 6) & 0x1F) << 3, b: ((v >> 1) & 0x1F) << 3, a: (v & 1) ? 255 : 0 };
        } else if (tile.format === 3 && tile.size === 1) { // IA 8-bit
            const p = (tile.tmem * 8 + finalT * tile.line * 8 + finalS);
            if (p >= 4096) return { r: 255, g: 255, b: 255, a: 255 };
            const v = this.tmem[p];
            const i = (v >> 4) << 4;
            return { r: i, g: i, b: i, a: (v & 0xF) << 4 };
        } else if (tile.format === 4) { // I
            const p = (tile.tmem * 8 + finalT * tile.line * 8 + (tile.size === 1 ? finalS : finalS >> 1));
            if (p >= 4096) return { r: 255, g: 255, b: 255, a: 255 };
            const v = (tile.size === 1) ? this.tmem[p] : (finalS & 1 ? (this.tmem[p] & 0xF) << 4 : this.tmem[p] & 0xF0);
            return { r: v, g: v, b: v, a: 255 };
        }
        return { r: 255, g: 255, b: 255, a: 255 };
    }

    combineColor(shade, tex) {
        const hi = this.rspState.combine.hi, lo = this.rspState.combine.lo;
        const get = (src, alpha) => {
            if (alpha) {
                switch (src) {
                    case 0: return tex.a;
                    case 3: return shade.a;
                    case 4: return (this.rspState.envColor & 0xFF);
                    case 5: return (this.rspState.primColor & 0xFF);
                    case 6: return 255;
                    case 7: return 0;
                    default: return 0;
                }
            } else {
                switch (src) {
                    case 0: return { r: tex.r, g: tex.g, b: tex.b };
                    case 3: return { r: shade.r, g: shade.g, b: shade.b };
                    case 4: const e = this.rspState.envColor; return { r: (e >> 24) & 0xFF, g: (e >> 16) & 0xFF, b: (e >> 8) & 0xFF };
                    case 5: const p = this.rspState.primColor; return { r: (p >> 24) & 0xFF, g: (p >> 16) & 0xFF, b: (p >> 8) & 0xFF };
                    case 6: return { r: 255, g: 255, b: 255 };
                    case 7: return { r: 0, g: 0, b: 0 };
                    default: return { r: 0, g: 0, b: 0 };
                }
            }
        };
        const A = get((hi >> 20) & 0xF, false), B = get((hi >> 15) & 0x1F, false), C = get((hi >> 10) & 0x1F, false), D = get((hi >> 6) & 0x7, false);
        const aA = get((lo >> 12) & 0x7, true), aB = get((lo >> 9) & 0x7, true), aC = get((lo >> 6) & 0x7, true), aD = get((lo >> 3) & 0x7, true);
        return {
            r: Math.max(0, Math.min(255, (A.r - B.r) * (C.r / 255) + D.r)),
            g: Math.max(0, Math.min(255, (A.g - B.g) * (C.g / 255) + D.g)),
            b: Math.max(0, Math.min(255, (A.b - B.b) * (C.b / 255) + D.b)),
            a: Math.max(0, Math.min(255, (aA - aB) * (aC / 255) + aD))
        };
    }

    updateUseTexture(hi, lo) {
        const is = (s) => s === 0 || s === 1;
        this.rspState.useTexture = is((hi >> 20) & 0xF) || is((hi >> 15) & 0x1F) || is((hi >> 10) & 0x1F) || is((hi >> 6) & 0x7) || is((lo >> 12) & 0x7) || is((lo >> 9) & 0x7) || is((lo >> 6) & 0x7) || is((lo >> 3) & 0x7);
    }

    handleG_SETTILE(hi, lo) {
        const t = (lo >> 24) & 0x7;
        if (t < 8) {
            const tile = this.rspState.tiles[t];
            tile.format = (hi >> 21) & 0x7;
            tile.size = (hi >> 19) & 0x3;
            tile.line = (hi >> 9) & 0x1FF;
            tile.tmem = hi & 0x1FF;
            tile.palette = (lo >> 20) & 0xF;
            tile.mirrorT = (lo >> 19) & 1;
            tile.wrapT = (lo >> 18) & 1;
            tile.maskT = (lo >> 14) & 0xF;
            tile.shiftT = (lo >> 10) & 0xF;
            tile.mirrorS = (lo >> 9) & 1;
            tile.wrapS = (lo >> 8) & 1;
            tile.maskS = (lo >> 4) & 0xF;
            tile.shiftS = lo & 0xF;
        }
    }

    handleG_SETTILESIZE(hi, lo) {
        const t = (lo >> 24) & 0x7;
        if (t < 8) {
            this.rspState.tiles[t].uls = (hi >> 12) & 0xFFF;
            this.rspState.tiles[t].ult = hi & 0xFFF;
            this.rspState.tiles[t].lrs = (lo >> 12) & 0xFFF;
            this.rspState.tiles[t].lrt = lo & 0xFFF;
        }
    }

    handleG_LOADBLOCK(hi, lo) {
        const t = (lo >> 24) & 0x7;
        const size = (((lo >> 12) & 0xFFF) + 1) * 8;
        const off = this.rspState.tiles[t].tmem * 8;
        for (let i = 0; i < size && (off + i < 4096); i++) {
            this.tmem[off + i] = this.mmu.read8(this.rspState.textureImage + i);
        }
    }

    handleG_LOADTILE(hi, lo) {
        const t = (lo >> 24) & 0x7;
        const uls = (hi >>> 12) & 0xFFF, ult = hi & 0xFFF;
        const lrs = (lo >>> 12) & 0xFFF, lrt = lo & 0xFFF;
        const tile = this.rspState.tiles[t];
        const off = tile.tmem * 8;
        const bpp = (this.rspState.textureImageSize === 3) ? 4 : (this.rspState.textureImageSize === 2 ? 2 : 1);
        const imgWidth = this.rspState.textureImageWidth;

        let d = off;
        for (let y = Math.floor(ult / 4); y <= Math.floor(lrt / 4); y++) {
            let s = this.rspState.textureImage + (y * imgWidth + Math.floor(uls / 4)) * bpp;
            for (let x = Math.floor(uls / 4); x <= Math.floor(lrs / 4) && (d < 4096); x++) {
                for (let b = 0; b < bpp && (d < 4096); b++) {
                    this.tmem[d++] = this.mmu.read8(s++);
                }
            }
        }
    }

    handleG_MOVEWORD(hi, lo) {
        const type = (hi >> 16) & 0xFF;
        if (type === 0x06) { // Segment
            this.rspState.segments[(hi & 0xFFFF) >> 2 & 0xF] = lo & 0xFFFFFF;
        } else if (type === 0x0E) { // Fog / Clip
            // NOP for now
        }
    }

    handleG_TEXRECT(hi, lo, addr, flip) {
        const xh = (hi >> 12) & 0xFFF, yh = hi & 0xFFF, xl = (lo >> 12) & 0xFFF, yl = lo & 0xFFF, t = (lo >> 24) & 0x7;
        let s, tt, dx, dy;
        const cmd = (hi >>> 24) & 0xFF;
        if (cmd === 0xE4 || cmd === 0xE5) { // RSP Fast3D
            s = this.mmu.read16(addr + 12);
            tt = this.mmu.read16(addr + 14);
            dx = (this.mmu.read16(addr + 20) << 16) >> 16;
            dy = (this.mmu.read16(addr + 22) << 16) >> 16;
        } else { // RDP
            s = this.mmu.read16(addr + 8);
            tt = this.mmu.read16(addr + 10);
            dx = (this.mmu.read16(addr + 16) << 16) >> 16;
            dy = (this.mmu.read16(addr + 18) << 16) >> 16;
        }
        const v1 = { x: xl / 4, y: yl / 4, z: 0, r: 255, g: 255, b: 255, a: 255, s: s, t: tt };
        const v2 = { x: xh / 4, y: yl / 4, z: 0, r: 255, g: 255, b: 255, a: 255, s: s + (xh - xl) * dx / 4096, t: tt };
        const v3 = { x: xl / 4, y: yh / 4, z: 0, r: 255, g: 255, b: 255, a: 255, s: s, t: tt + (yh - yl) * dy / 4096 };
        const v4 = { x: xh / 4, y: yh / 4, z: 0, r: 255, g: 255, b: 255, a: 255, s: s + (xh - xl) * dx / 4096, t: tt + (yh - yl) * dy / 4096 };
        this.rspState.currentTile = t;
        this.drawTriangle(v1, v2, v3);
        this.drawTriangle(v2, v3, v4);
    }
}
