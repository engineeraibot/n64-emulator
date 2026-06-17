// Clamp a numeric color channel into the 0..255 byte range. Used by the RDP
// color-combiner emulator below.
function clamp255(v) {
    if (!isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 255) return 255;
    return v | 0;
}

class RCP {
    constructor(mmu, framebuffer) {
        this.mmu = mmu;
        this.framebuffer = framebuffer;
        this.tmem = new Uint8Array(4096);
        this.rdpCommandCount = 0;
        this.rspTaskCount = 0;
        this.reset();
    }

    reset() {
        this.rdpCommandCount = 0;
        this.rspTaskCount = 0;
        this.f3dex2TaskCount = 0;
        this.f3dTaskCount = 0;
        this.dlOpcodeHistogram = Object.create(null);
        this.drawStats = {
            triangles: 0,
            texturedTriangles: 0,
            untexturedTriangles: 0,
            textureEnabledTriangles: 0,
            textureDisabledTriangles: 0,
            fillRects: 0,
            texRects: 0,
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity,
            rowWrites: new Uint32Array(240)
        };
        this.textureSampleStats = {
            calls: 0,
            oob: 0,
            maxAbsS: 0,
            maxAbsT: 0,
            tileCalls: new Uint32Array(8)
        };
        this.taskTypeHistogram = Object.create(null);
        this.displayListAbortCount = 0;
        this.displayListReturnCount = 0;
        this.dlSamples = {
            mtx: [],
            vtx: [],
            tri1: [],
            movemem: [],
            texture: [],
            setcombine: []
        };
        this.videoTargetHistory = [];
        this.latestVideoTarget = null;
        this.videoTargetSequence = 0;
        this.currentTaskVideoTargets = null;
        this.lastRichVideoSnapshot = null;
        this.bestRichVideoSnapshot = null;
        this.displayedFrameSnapshot = null; // front buffer captured at VI vblank (the actually-displayed, finished frame)
        this.rspState = null;
        // HLE audio (RSP type-2 task) scratch state.
        this.audioDmem = new Uint8Array(0x2000);
        this.audioDmemView = new DataView(this.audioDmem.buffer);
        this.audioSegments = new Uint32Array(16);
        this.audioADPCMTable = new Int16Array(8 * 16);
        this.audioLoopAddr = 0;
        this.alistIn = 0;
        this.alistOut = 0;
        this.alistCount = 0;
        // A_ENVMIXER / A_SETVOL state (SM64 "audio" ABI, mupen64plus-hle alist_audio).
        this.audioDry = 0;            // s16 dry gain
        this.audioWet = 0;            // s16 wet gain
        this.audioVol = [0, 0];       // s16 L/R volume
        this.audioTarget = [0, 0];    // s16 L/R ramp target
        this.audioRate = [0, 0];      // s32 L/R ramp rate
        this.audioDryRight = 0;       // DMEM dry-right buffer (SETBUFF A_AUX)
        this.audioWetLeft = 0;        // DMEM wet-left buffer
        this.audioWetRight = 0;       // DMEM wet-right buffer
        this.audioTasksRun = 0;
        this.lastAudioPcm = null;        // {addr,len} of the most recent SAVEBUFF/INTERLEAVE output
        this.audioOutSampleCount = 0;    // total s16 samples synthesized (verification metric)
        this.audioOutNonZero = 0;        // non-zero synthesized samples (verification metric)
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
            const SP_STATUS_HALT = 0x0001;
            const SP_STATUS_BROKE = 0x0002;
            const SP_STATUS_SSTEP = 0x0020;
            const SP_STATUS_INTR_BREAK = 0x0040;
            const SP_STATUS_SIG0 = 0x0080;
            const SP_STATUS_SIG1 = 0x0100;
            const SP_STATUS_SIG2 = 0x0200;
            const SP_CLR_HALT = 0x0001;
            const SP_SET_HALT = 0x0002;
            const SP_CLR_BROKE = 0x0004;
            const SP_CLR_INTR = 0x0008;
            const SP_SET_INTR = 0x0010;
            const SP_CLR_SSTEP = 0x0020;
            const SP_SET_SSTEP = 0x0040;
            const SP_CLR_INTR_BREAK = 0x0080;
            const SP_SET_INTR_BREAK = 0x0100;

            let status = this.mmu.spRegisters[4] >>> 0;
            const wasHalted = (status & SP_STATUS_HALT) !== 0;

            if ((value & SP_CLR_HALT) && !(value & SP_SET_HALT)) status &= ~SP_STATUS_HALT;
            if ((value & SP_SET_HALT) && !(value & SP_CLR_HALT)) status |= SP_STATUS_HALT;
            if (value & SP_CLR_BROKE) status &= ~SP_STATUS_BROKE;

            if ((value & SP_CLR_INTR) && !(value & SP_SET_INTR)) this.mmu.miRegisters[2] &= ~0x01;
            if ((value & SP_SET_INTR) && !(value & SP_CLR_INTR)) this.mmu.miRegisters[2] |= 0x01;

            if ((value & SP_CLR_SSTEP) && !(value & SP_SET_SSTEP)) status &= ~SP_STATUS_SSTEP;
            if ((value & SP_SET_SSTEP) && !(value & SP_CLR_SSTEP)) status |= SP_STATUS_SSTEP;
            if ((value & SP_CLR_INTR_BREAK) && !(value & SP_SET_INTR_BREAK)) status &= ~SP_STATUS_INTR_BREAK;
            if ((value & SP_SET_INTR_BREAK) && !(value & SP_CLR_INTR_BREAK)) status |= SP_STATUS_INTR_BREAK;

            for (let i = 0; i < 8; i++) {
                const clearBit = 1 << (9 + i * 2);
                const setBit = 1 << (10 + i * 2);
                const sigBit = 1 << (7 + i);
                if ((value & clearBit) && !(value & setBit)) status &= ~sigBit;
                if ((value & setBit) && !(value & clearBit)) status |= sigBit;
            }

            this.mmu.spRegisters[4] = status >>> 0;

            // HLE: complete the task immediately and reflect the expected status bits.
            if (this._spWriteCount === undefined) this._spWriteCount = 0;
            this._spWriteCount++;
            if (this._spWriteCount <= 2) {
                const pcNow = this.mmu.cpu ? (this.mmu.cpu.pc >>> 0).toString(16) : '?';
                console.log('[rcp] SP_STATUS write #' + this._spWriteCount + ' val=0x' + value.toString(16) + ' wasHalted=' + wasHalted + ' newStatus=0x' + status.toString(16) + ' PC=0x' + pcNow);
            }
            if (wasHalted && !(status & SP_STATUS_HALT)) {
                this.runRspTask();
                // HLE task completion: set HALT|BROKE and SIG2 while preserving existing signal bits.
                status = this.mmu.spRegisters[4] | SP_STATUS_HALT | SP_STATUS_BROKE | SP_STATUS_SIG2;
                this.mmu.spRegisters[4] = status >>> 0;
                if (status & SP_STATUS_INTR_BREAK) this.mmu.miRegisters[2] |= 0x01;
            }
            this.mmu.updateInterrupts();
        } else {
            this.mmu.spRegisters[regIdx] = value;
        }
    }

    doSpDma(isToDram) {
        const lenReg = this.mmu.spRegisters[isToDram ? 3 : 2] >>> 0;
        const length = ((lenReg & 0xFFF) | 7) + 1;
        const count = ((lenReg >>> 12) & 0xFF) + 1;
        const skip = (lenReg >>> 20) & 0xFF8;

        const memOffset = this.mmu.spRegisters[0] & 0x1000;
        const spMem = memOffset ? this.mmu.spImem : this.mmu.spDmem;
        let memAddr = this.mmu.spRegisters[0] & 0x0FF8;
        let dramAddr = this.mmu.spRegisters[1] & 0x007FFFF8;
        const rdramView = new Uint8Array(this.mmu.memory.rdram);

        for (let block = 0; block < count; block++) {
            for (let i = 0; i < length; i++) {
                const s = (memAddr + i) & 0xFFF;
                const d = (dramAddr + i) & 0x7FFFFF;
                if (isToDram) rdramView[d] = spMem[s];
                else spMem[s] = rdramView[d];
            }
            memAddr = (memAddr + length) & 0x0FFF;
            dramAddr = (dramAddr + length + skip) & 0x7FFFFF;
        }

        this.mmu.spRegisters[0] = (memAddr & 0x0FFF) | memOffset;
        this.mmu.spRegisters[1] = dramAddr;
        this.mmu.spRegisters[2] = 0xFF8;
        this.mmu.spRegisters[3] = 0xFF8;
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
            case 0x24: case 0x25: // TEXRECT (RDP FIFO path — word 1 has no opcode prefix)
                this.handleG_TEXRECT(hi, lo, addr, cmd === 0x25, true);
                consumed = 24;
                break;
            case 0x2F: // SETOTHERMODE (F3D)
            case 0xE2: // G_SETOTHERMODE_L (F3DEX2)
            case 0xE3: // G_SETOTHERMODE_H (F3DEX2)
                if (cmd === 0xE2) this.rspState.otherModeLo = lo;
                else if (cmd === 0xE3) this.rspState.otherModeHi = lo;
                else { this.rspState.otherModeLo = lo; this.rspState.otherModeHi = hi & 0xFFFFFF; }
                break;
            case 0x32: this.handleG_SETTILESIZE(hi, lo); break;
            case 0x33: this.handleG_LOADBLOCK(hi, lo); break;
            case 0x34: this.handleG_LOADTILE(hi, lo); break;
            case 0x30: this.handleG_LOADTLUT(hi, lo); break;
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
                this.recomputeUseTexture();
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
            vertices: new Array(64).fill(0).map(() => ({ x: 0, y: 0, z: 0, w: 1, cx: 0, cy: 0, cz: 0, cw: 1, r: 0, g: 0, b: 0, a: 0, s: 0, t: 0, _needsProject: false })),
            modelviewStack: [this.createIdentityMatrix()],
            projectionMatrix: this.createIdentityMatrix(),
            tiles: new Array(8).fill(0).map(() => ({ format: 0, size: 0, line: 0, tmem: 0, palette: 0, uls: 0, ult: 0, lrs: 0, lrt: 0, maskS: 0, shiftS: 0, maskT: 0, shiftT: 0, cmS: 0, cmT: 0 })),
            combine: { hi: 0, lo: 0 },
            primColor: 0xFFFFFFFF, envColor: 0, blendColor: 0, fogColor: 0, fillColor: 0, colorImage: 0, colorImageWidth: 320, colorImageSize: 2,
            textureImage: 0, textureImageWidth: 0, textureImageSize: 2,
            textureScaleS: 1.0, textureScaleT: 1.0, textureEnabled: false, combinerUsesTexture: false, otherModeHi: 0, otherModeLo: 0, currentTile: 0, useTexture: false,
            geometryMode: 0, isF3DEX2: false,
            lights: new Array(8).fill(null), numLights: 0
        };
    }

    beginVideoTargetCollection() {
        this.currentTaskVideoTargets = new Map();
    }

    recordVideoWrite(kind = 'draw') {
        if (!this.currentTaskVideoTargets || !this.rspState) return;
        const origin = this.rspState.colorImage & 0x7FFFFF;
        const width = this.rspState.colorImageWidth | 0;
        const size = this.rspState.colorImageSize | 0;
        const type = size === 3 ? 3 : 2;
        if (!origin || width <= 0 || width > 4096 || type < 2 || type > 3) return;

        const key = `${origin}:${width}:${size}`;
        let entry = this.currentTaskVideoTargets.get(key);
        if (!entry) {
            entry = {
                origin,
                width,
                size,
                type,
                ops: 0,
                triangles: 0,
                fills: 0,
                texRects: 0
            };
            this.currentTaskVideoTargets.set(key, entry);
        }

        entry.ops++;
        if (kind === 'tri') entry.triangles++;
        else if (kind === 'fill') entry.fills++;
        else if (kind === 'texrect') entry.texRects++;
    }

    commitVideoTargetCollection() {
        if (this.glr) this.glr.flush();
        if (!this.currentTaskVideoTargets || this.currentTaskVideoTargets.size === 0) {
            this.currentTaskVideoTargets = null;
            return;
        }

        const viWidth = this.mmu ? (this.mmu.viRegisters[2] & 0xFFF) : 0;
        const candidates = Array.from(this.currentTaskVideoTargets.values());
        let best = null;

        for (const c of candidates) {
            if (!best) {
                best = c;
                continue;
            }

            const cMatchesVi = viWidth > 0 && c.width === viWidth;
            const bMatchesVi = viWidth > 0 && best.width === viWidth;
            if (cMatchesVi !== bMatchesVi) {
                if (cMatchesVi) best = c;
                continue;
            }

            if (c.ops !== best.ops) {
                if (c.ops > best.ops) best = c;
                continue;
            }

            if (c.triangles !== best.triangles) {
                if (c.triangles > best.triangles) best = c;
                continue;
            }

            if (c.width !== best.width) {
                if (c.width > best.width) best = c;
                continue;
            }

            if (c.origin < best.origin) best = c;
        }

        if (best) {
            const stamped = {
                origin: best.origin & 0x7FFFFF,
                width: best.width | 0,
                type: best.type | 0,
                size: best.size | 0,
                ops: best.ops | 0,
                triangles: best.triangles | 0,
                fills: best.fills | 0,
                texRects: best.texRects | 0,
                sequence: ++this.videoTargetSequence
            };
            this.latestVideoTarget = stamped;
            this.videoTargetHistory.push(stamped);
            if (this.videoTargetHistory.length > 24) this.videoTargetHistory.shift();
            if ((stamped.triangles | 0) > 0 || (stamped.texRects | 0) > 0) {
                this.captureVideoTargetSnapshot(stamped, 240);
            }
        }

        this.currentTaskVideoTargets = null;
    }

    captureVideoTargetSnapshot(target, height = 240) {
        if (!this.mmu || !this.mmu.memory || !this.mmu.memory.rdram) return;
        const width = target.width | 0;
        const type = target.type | 0;
        const origin = target.origin & 0x7FFFFF;
        const clampedHeight = Math.max(1, Math.min(240, height | 0));
        if (width <= 0 || width > 4096 || (type !== 2 && type !== 3)) return;

        const bpp = type === 3 ? 4 : 2;
        const rowBytes = (width * bpp) >>> 0;
        if (rowBytes === 0) return;

        const totalBytes = (rowBytes * clampedHeight) >>> 0;
        const snapshot = new Uint8Array(totalBytes);
        const src = new Uint8Array(this.mmu.memory.rdram);
        const rdramSize = src.length >>> 0;

        for (let y = 0; y < clampedHeight; y++) {
            const rowSrc = (origin + y * rowBytes) & 0x7FFFFF;
            const rowDst = y * rowBytes;
            if (rowSrc + rowBytes <= rdramSize) {
                snapshot.set(src.subarray(rowSrc, rowSrc + rowBytes), rowDst);
            } else {
                const head = rdramSize - rowSrc;
                snapshot.set(src.subarray(rowSrc, rdramSize), rowDst);
                snapshot.set(src.subarray(0, rowBytes - head), rowDst + head);
            }
        }

        let nonBlack = 0;
        if (type === 2) {
            for (let i = 0; i + 1 < snapshot.length; i += 2) {
                const v = (snapshot[i] << 8) | snapshot[i + 1];
                const r = ((v >> 11) & 0x1F) << 3;
                const g = ((v >> 6) & 0x1F) << 3;
                const b = ((v >> 1) & 0x1F) << 3;
                if (r > 12 || g > 12 || b > 12) nonBlack++;
            }
        } else {
            for (let i = 0; i + 2 < snapshot.length; i += 4) {
                if (snapshot[i] > 12 || snapshot[i + 1] > 12 || snapshot[i + 2] > 12) nonBlack++;
            }
        }

        const candidate = {
            origin,
            width,
            type,
            height: clampedHeight,
            sequence: target.sequence | 0,
            nonBlack,
            data: snapshot
        };
        // Deterministic policy: keep the latest non-empty rich snapshot.
        if (nonBlack > 0 || !this.lastRichVideoSnapshot) {
            this.lastRichVideoSnapshot = candidate;
        }
        if (!this.bestRichVideoSnapshot || nonBlack > (this.bestRichVideoSnapshot.nonBlack | 0)) {
            this.bestRichVideoSnapshot = candidate;
        }
    }

    // Capture the framebuffer that VI is currently scanning out (VI_ORIGIN) at a VBlank.
    // At a VI interrupt the front buffer has been displayed for a full frame and is therefore
    // a completely-drawn ("finished") frame -- the game is drawing into the OTHER buffer. We
    // keep the latest NON-BLACK such capture so the deterministic output is always a finished,
    // actually-displayed frame, independent of where an emulation run happens to stop.
    captureDisplayedFrame() {
        if (!this.mmu || !this.mmu.viRegisters || !this.mmu.memory || !this.mmu.memory.rdram) return;
        const type = this.mmu.viRegisters[0] & 0x3;
        if (type !== 2 && type !== 3) return; // VI blanked / not RGBA16/32
        const width = this.mmu.viRegisters[2] & 0xFFF;
        if (width <= 0 || width > 4096) return;
        const origin = this.mmu.viRegisters[1] & 0x7FFFFF;
        if (!origin) return;
        const H = 240;
        const bpp = type === 3 ? 4 : 2;
        const rowBytes = (width * bpp) >>> 0;
        if (rowBytes === 0) return;
        // Guard against transient/bogus VI_ORIGIN values (e.g. a near-zero origin mid-setup
        // that would read engine code/heap from low RDRAM and look "non-black"). Only capture
        // when VI_ORIGIN lies inside a buffer the renderer actually drew rich content into.
        const frameBytes = (rowBytes * H) >>> 0;
        let covered = false;
        for (let i = this.videoTargetHistory.length - 1; i >= 0; i--) {
            const c = this.videoTargetHistory[i];
            if ((c.triangles | 0) === 0 && (c.texRects | 0) === 0) continue;
            if (((origin - c.origin) & 0x7FFFFF) < frameBytes) { covered = true; break; }
        }
        if (!covered) return;
        const totalBytes = frameBytes;
        const src = new Uint8Array(this.mmu.memory.rdram);
        const rdramSize = src.length >>> 0;
        const snapshot = new Uint8Array(totalBytes);
        for (let y = 0; y < H; y++) {
            const rowSrc = (origin + y * rowBytes) & 0x7FFFFF;
            const rowDst = y * rowBytes;
            if (rowSrc + rowBytes <= rdramSize) {
                snapshot.set(src.subarray(rowSrc, rowSrc + rowBytes), rowDst);
            } else {
                const head = rdramSize - rowSrc;
                snapshot.set(src.subarray(rowSrc, rdramSize), rowDst);
                snapshot.set(src.subarray(0, rowBytes - head), rowDst + head);
            }
        }
        let nonBlack = 0;
        if (type === 2) {
            for (let i = 0; i + 1 < snapshot.length; i += 2) {
                const v = (snapshot[i] << 8) | snapshot[i + 1];
                if (((v >> 11) & 0x1F) > 1 || ((v >> 6) & 0x1F) > 1 || ((v >> 1) & 0x1F) > 1) nonBlack++;
            }
        } else {
            for (let i = 0; i + 2 < snapshot.length; i += 4) {
                if (snapshot[i] > 12 || snapshot[i + 1] > 12 || snapshot[i + 2] > 12) nonBlack++;
            }
        }
        // Keep the richest finished, displayed frame. Because every candidate here was
        // genuinely scanned out by VI (a finished front buffer), this is always a complete
        // frame -- never a mid-draw back buffer (the failure mode of the old best-rich path).
        if (nonBlack > 0 && (!this.displayedFrameSnapshot || nonBlack >= (this.displayedFrameSnapshot.nonBlack | 0))) {
            this.displayedFrameSnapshot = {
                origin, width, type, height: H, nonBlack, data: snapshot,
                sequence: ++this.videoTargetSequence
            };
        }
    }

    getDeterministicVideoTarget(viOrigin, viWidth, viType) {
        const width = viWidth | 0;
        const type = viType | 0;
        const origin = viOrigin & 0x7FFFFF;

        // Highest priority: the finished, actually-displayed front buffer captured at VBlank.
        // This is the true displayed frame and is independent of where the run stopped.
        const disp = this.displayedFrameSnapshot;
        if (disp && (width <= 0 || disp.width === width) && (type < 2 || disp.type === type)) {
            return {
                origin: disp.origin,
                width: disp.width,
                type: disp.type,
                height: disp.height,
                source: 'vi-vblank',
                snapshot: true,
                data: disp.data,
                sequence: disp.sequence | 0
            };
        }
        const bpp = type === 3 ? 4 : 2;
        const lineBytes = width > 0 ? (width * bpp) >>> 0 : 0;
        const frameBytes = lineBytes > 0 ? (lineBytes * 240) >>> 0 : 0;
        const maxLineOffset = lineBytes > 0 ? (lineBytes * 8) >>> 0 : 0;
        const snapshot = this.lastRichVideoSnapshot;

        const rich = [];
        const fillOnly = [];
        for (let i = this.videoTargetHistory.length - 1; i >= 0; i--) {
            const c = this.videoTargetHistory[i];
            if (width > 0 && c.width !== width) continue;
            if (type >= 2 && c.type !== type) continue;
            if ((c.triangles | 0) > 0 || (c.texRects | 0) > 0) rich.push(c);
            else fillOnly.push(c);
        }
        const candidates = rich.concat(fillOnly);

        // Prefer VI-correlated targets first.
        for (const c of candidates) {
            if (c.origin === origin) {
                return {
                    origin: c.origin,
                    width: c.width,
                    type: c.type,
                    height: 240,
                    source: 'vi-match',
                    sequence: c.sequence | 0
                };
            }
        }

        // VI-origin double-buffer match: the displayed (finished/front) buffer is the
        // one whose frame extent [c.origin, c.origin+frameBytes) contains VI_ORIGIN. The
        // VI fetch start offset (e.g. +0x280 for the top border) is small (< one frame), so
        // the displayed buffer is uniquely the candidate physically just below VI_ORIGIN.
        // NB: do NOT use modulo here -- wrapping makes the other ping-pong buffers (which sit
        // exact frame multiples away) tie, wrongly selecting the back buffer that is still
        // mid-draw, producing the striped/incomplete deterministic frame seen before.
        if (frameBytes > 0) {
            let bestDisp = null;
            for (const c of candidates) {
                const delta = (origin - c.origin) & 0x7FFFFF; // forward distance, no modulo
                if (delta >= frameBytes) continue;             // VI origin not inside this buffer
                const isRich = ((c.triangles | 0) > 0 || (c.texRects | 0) > 0) ? 1 : 0;
                if (
                    !bestDisp ||
                    delta < bestDisp.delta ||
                    (delta === bestDisp.delta &&
                        (isRich > bestDisp.isRich ||
                            (isRich === bestDisp.isRich && (c.sequence | 0) > bestDisp.sequence)))
                ) {
                    bestDisp = { delta, isRich, sequence: c.sequence | 0, entry: c };
                }
            }
            if (bestDisp) {
                const c = bestDisp.entry;
                return {
                    origin: c.origin,
                    width: c.width,
                    type: c.type,
                    height: 240,
                    source: 'vi-origin',
                    sequence: c.sequence | 0
                };
            }
        }

        if (lineBytes > 0 && maxLineOffset > 0) {
            let best = null;
            for (const c of candidates) {
                const forward = (origin - c.origin) & 0x7FFFFF;
                const backward = (c.origin - origin) & 0x7FFFFF;
                const nearest = Math.min(forward, backward);
                if (nearest % lineBytes !== 0) continue;

                let lineOffset = nearest;
                if (frameBytes > 0) {
                    lineOffset = nearest % frameBytes;
                    lineOffset = Math.min(lineOffset, frameBytes - lineOffset);
                }
                if (lineOffset > maxLineOffset) continue;

                const isRich = ((c.triangles | 0) > 0 || (c.texRects | 0) > 0) ? 1 : 0;
                const score = { isRich, lineOffset, sequence: c.sequence | 0, entry: c };
                if (!best) {
                    best = score;
                    continue;
                }
                if (score.isRich !== best.isRich) {
                    if (score.isRich > best.isRich) best = score;
                    continue;
                }
                if (score.lineOffset !== best.lineOffset) {
                    if (score.lineOffset < best.lineOffset) best = score;
                    continue;
                }
                if (score.sequence > best.sequence) best = score;
            }
            if (best) {
                const c = best.entry;
                return {
                    origin: c.origin,
                    width: c.width,
                    type: c.type,
                    height: 240,
                    source: 'vi-frame-offset',
                    sequence: c.sequence | 0
                };
            }
        }

        // Then prefer the most recent rich frame.
        if (rich.length > 0) {
            const c = rich[0];
            return {
                origin: c.origin,
                width: c.width,
                type: c.type,
                height: 240,
                source: 'recent-gfx-rich',
                sequence: c.sequence | 0
            };
        }

        if (this.latestVideoTarget) {
            if ((width <= 0 || this.latestVideoTarget.width === width) && (type < 2 || this.latestVideoTarget.type === type)) {
                return {
                    origin: this.latestVideoTarget.origin,
                    width: this.latestVideoTarget.width,
                    type: this.latestVideoTarget.type,
                    height: 240,
                    source: 'latest-gfx',
                    sequence: this.latestVideoTarget.sequence | 0
                };
            }
        }

        if (
            snapshot &&
            (width <= 0 || snapshot.width === width) &&
            (type < 2 || snapshot.type === type)
        ) {
            return {
                origin: snapshot.origin,
                width: snapshot.width,
                type: snapshot.type,
                height: snapshot.height,
                source: 'snapshot-fallback',
                snapshot: true,
                sequence: snapshot.sequence | 0
            };
        }

        return null;
    }

    runRspTask() {
        this.rspTaskCount++;
        const pcNow = this.mmu.cpu ? (this.mmu.cpu.pc >>> 0).toString(16) : '?';
        if (this.rspTaskCount <= 2) console.log('[rcp] runRspTask #' + this.rspTaskCount + ' PC=0x' + pcNow);
        const taskPtr = 0xFC0;
        const _taskType = this.mmu.spDmemView.getUint32(taskPtr + 0x00, false);
        const _dataPtr = this.mmu.spDmemView.getUint32(taskPtr + 0x30, false);
        if (this.rspTaskCount <= 2) {  // silenced most rsp task logs
            console.log('[rsp] task#' + this.rspTaskCount + ' type=' + _taskType +
                ' f3d=' + (this.f3dTaskCount + (_taskType===1?0:0)) + ' dataPtr=0x' + (_dataPtr>>>0).toString(16));
        }
        const type = this.mmu.spDmemView.getUint32(taskPtr + 0x00, false);
        this.taskTypeHistogram[type] = (this.taskTypeHistogram[type] || 0) + 1;
        const ucodeSize = this.mmu.spDmemView.getUint32(taskPtr + 0x14, false) >>> 0;
        const dataPtr = this.mmu.spDmemView.getUint32(taskPtr + 0x30, false);
        const dataSize = this.mmu.spDmemView.getUint32(taskPtr + 0x34, false) >>> 0;
        const yieldDataPtr = this.mmu.spDmemView.getUint32(taskPtr + 0x38, false) & 0x7FFFFF;

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
                if (!this.rspState) this.initRspState();
                this.rspState.isF3DEX2 = this.detectDisplayListFlavor(startAddr, dataSize, ucodeSize);
                if (this.rspState.isF3DEX2) this.f3dex2TaskCount++;
                else this.f3dTaskCount++;
                this.beginVideoTargetCollection();
                this.processDisplayList(startAddr, dataSize);
                this.commitVideoTargetCollection();

                // HLE completion: always signal DP done for graphics tasks.
                // This keeps scheduler state deterministic even when a display
                // list omits or masks FULLSYNC in paths we do not emulate yet.
                this.mmu.miRegisters[2] |= 0x20;
                this.mmu.updateInterrupts();
            } else if (type === 2) { // Audio synthesis (HLE)
                this.runAudioTask(dataPtr, dataSize);
            }
        } catch (e) {
            console.error("RSP Task Error:", e);
            this.currentTaskVideoTargets = null;
        }
    }

    // ---- HLE audio (N64 audio microcode "aspMain"/ABI) ----------------------
    // Interprets the audio command list (8-byte commands) the game submits as an
    // RSP type-2 task and synthesizes 16-bit signed stereo PCM into RDRAM, exactly
    // where the game later points the AI DMA. DMEM and RDRAM samples are big-endian.
    audioSegAddr(a) {
        a = a >>> 0;
        return ((this.audioSegments[(a >>> 24) & 0xF] >>> 0) + (a & 0xFFFFFF)) & 0x7FFFFF;
    }
    adGetS16(off) { return this.audioDmemView.getInt16(off & 0x1FFF, false); }
    adGetU16(off) { return this.audioDmemView.getUint16(off & 0x1FFF, false); }
    adSetU16(off, v) { this.audioDmemView.setUint16(off & 0x1FFF, v & 0xFFFF, false); }
    adSetS16(off, v) {
        if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
        this.audioDmemView.setInt16(off & 0x1FFF, v | 0, false);
    }

    runAudioTask(dataPtr, dataSize) {
        this.audioTasksRun = (this.audioTasksRun | 0) + 1;
        const rd = new DataView(this.mmu.memory.rdram);
        const cmdBase = dataPtr & 0x7FFFFF;
        const lim = this.mmu.memory.rdram.byteLength;
        for (let off = 0; off + 8 <= dataSize && (cmdBase + off + 8) <= lim; off += 8) {
            const w0 = rd.getUint32(cmdBase + off, false) >>> 0;
            const w1 = rd.getUint32(cmdBase + off + 4, false) >>> 0;
            const op = (w0 >>> 24) & 0xFF;
            switch (op) {
                case 0x00: break; // A_SPNOOP
                case 0x07: // A_SEGMENT
                    this.audioSegments[(w1 >>> 24) & 0xF] = (w1 & 0xFFFFFF) >>> 0;
                    break;
                case 0x08: { // A_SETBUFF
                    const f = (w0 >>> 16) & 0xFF;
                    if (f & 0x08) { // A_AUX: aux output buffers
                        this.audioDryRight = w0 & 0xFFFF;
                        this.audioWetLeft = (w1 >>> 16) & 0xFFFF;
                        this.audioWetRight = w1 & 0xFFFF;
                    } else { // in=w0[15:0], out=w1[31:16], count=w1[15:0]
                        this.alistIn = w0 & 0xFFFF;
                        this.alistOut = (w1 >>> 16) & 0xFFFF;
                        this.alistCount = w1 & 0xFFFF;
                    }
                    break;
                }
                case 0x02: // A_CLEARBUFF
                    this.aClearBuff(w0 & 0xFFFF, w1 & 0xFFFF);
                    break;
                case 0x04: // A_LOADBUFF (DRAM -> DMEM[in], alistCount bytes)
                    this.aLoadBuff(rd, w1);
                    break;
                case 0x06: // A_SAVEBUFF (DMEM[out] -> DRAM, alistCount bytes)
                    this.aSaveBuff(rd, w1);
                    break;
                case 0x05: // A_RESAMPLE
                    this.aResample(rd, w0, w1);
                    break;
                case 0x0C: // A_MIXER
                    this.aMixer(w0, w1);
                    break;
                case 0x0D: // A_INTERLEAVE
                    this.aInterleave(w1);
                    break;
                case 0x0A: // A_DMEMMOVE
                    this.aDmemMove(w0, w1);
                    break;
                case 0x0B: // A_LOADADPCM (codebook upload)
                    this.aLoadADPCM(rd, w0, w1);
                    break;
                case 0x0F: // A_SETLOOP
                    this.audioLoopAddr = this.audioSegAddr(w1);
                    break;
                case 0x01: // A_ADPCM (order-2 VADPCM decode)
                    this.aAdpcm(rd, w0, w1);
                    break;
                case 0x03: // A_ENVMIXER (volume-envelope mixer, exp variant)
                    this.aEnvmix(rd, w0, w1);
                    break;
                case 0x09: { // A_SETVOL
                    const f = (w0 >>> 16) & 0xFF;
                    if (f & 0x08) { // A_AUX: dry/wet master gains
                        this.audioDry = (w0 << 16) >> 16; // s16
                        this.audioWet = (w1 << 16) >> 16; // s16
                    } else {
                        const lr = (f & 0x02) ? 0 : 1; // A_LEFT -> 0
                        if (f & 0x04) { // A_VOL
                            this.audioVol[lr] = (w0 << 16) >> 16; // s16
                        } else {
                            this.audioTarget[lr] = (w0 << 16) >> 16; // s16
                            this.audioRate[lr] = w1 | 0;            // s32
                        }
                    }
                    break;
                }
                // POLEF (0x0E) not yet exercised by SM64's title path; documented no-op.
                case 0x0E: // A_POLEF
                default:
                    break;
            }
        }
    }

    aClearBuff(dmem, count) {
        count = (count + 15) & ~15;
        const start = dmem & 0x1FFF;
        const end = Math.min(0x2000, start + count);
        this.audioDmem.fill(0, start, end);
    }

    aLoadBuff(rd, addr) {
        const n = (this.alistCount + 3) & ~3;
        if (n <= 0) return;
        let src = this.audioSegAddr(addr);
        const lim = this.mmu.memory.rdram.byteLength;
        for (let i = 0; i < n; i++) {
            const sa = src + i;
            this.audioDmem[(this.alistIn + i) & 0x1FFF] = (sa < lim) ? rd.getUint8(sa) : 0;
        }
    }

    aSaveBuff(rd, addr) {
        const n = (this.alistCount + 3) & ~3;
        if (n <= 0) return;
        let dst = this.audioSegAddr(addr);
        const lim = this.mmu.memory.rdram.byteLength;
        for (let i = 0; i < n; i++) {
            const da = dst + i;
            if (da < lim) rd.setUint8(da, this.audioDmem[(this.alistOut + i) & 0x1FFF]);
        }
        this.lastAudioPcm = { addr: dst, len: n };
        // Verification metrics: count synthesized non-zero s16 samples.
        for (let i = 0; i + 1 < n; i += 2) {
            const s = this.adGetS16(this.alistOut + i);
            this.audioOutSampleCount++;
            if (s !== 0) this.audioOutNonZero++;
        }
    }

    // Linear-interpolation resampler. pitch is a 16.16 step (input samples per output
    // sample). State (fractional phase) is carried across tasks via the DRAM state addr.
    aResample(rd, w0, w1) {
        const flags = (w0 >>> 16) & 0xFF;
        const pitch = ((w0 & 0xFFFF) << 1) >>> 0; // 16.16
        const stateAddr = this.audioSegAddr(w1);
        const dmemi = this.alistIn, dmemo = this.alistOut;
        const outBytes = (this.alistCount + 0xF) & ~0xF;
        const outSamples = outBytes >> 1;
        const lim = this.mmu.memory.rdram.byteLength;
        let pos = (flags & 0x1) ? 0 : ((stateAddr + 1 < lim) ? rd.getUint16(stateAddr, false) : 0);
        for (let s = 0; s < outSamples; s++) {
            const ip = pos >>> 16;
            const frac = (pos & 0xFFFF) / 65536;
            const a = this.adGetS16(dmemi + ip * 2);
            const b = this.adGetS16(dmemi + (ip + 1) * 2);
            this.adSetS16(dmemo + s * 2, (a + (b - a) * frac) | 0);
            pos = (pos + pitch) >>> 0;
        }
        if (stateAddr + 1 < lim) rd.setUint16(stateAddr, pos & 0xFFFF, false);
    }

    aMixer(w0, w1) {
        const gain = (w0 & 0xFFFF) << 16 >> 16; // s16
        const dmemin = (w1 >>> 16) & 0xFFFF;
        const dmemout = w1 & 0xFFFF;
        const n = this.alistCount >> 1; // s16 sample count
        for (let i = 0; i < n; i++) {
            const inS = this.adGetS16(dmemin + i * 2);
            const outS = this.adGetS16(dmemout + i * 2);
            this.adSetS16(dmemout + i * 2, outS + ((inS * gain) >> 15));
        }
    }

    // s16 clamp.
    clampS16(v) { v |= 0; return v > 32767 ? 32767 : (v < -32768 ? -32768 : v); }

    // dst = clamp_s16(dst + ((src*gain)>>15)).  src,gain are s16.
    sampleMix(off, src, gain) {
        this.adSetS16(off, this.adGetS16(off) + ((src * gain) >> 15));
    }

    // One envelope ramp step (mupen ramp_step): advance value by step, clamp at target,
    // return (int16_t)(value >> 16). value/step/target are 64-bit-range JS Numbers, so
    // the >>16 uses Math.floor (arithmetic shift) rather than the 32-bit JS >> operator.
    rampStep(val, step, target, ch) {
        val[ch] += step[ch];
        const reached = (step[ch] <= 0) ? (val[ch] <= target[ch]) : (val[ch] >= target[ch]);
        if (reached) { val[ch] = target[ch]; step[ch] = 0; }
        return (Math.floor(val[ch] / 65536) << 16) >> 16; // (int16_t)(value >> 16)
    }

    // A_ENVMIXER (exp variant — SM64's "audio" ABI). Volume-envelope mixer: ramps the
    // L/R volume per sample (exponential approach to target) and mixes the input buffer
    // into the dry-L/R (and, when A_AUX, wet-L/R) output buffers. The 80-byte envelope
    // state persists in DRAM at audioSegAddr(w1). Ported from mupen64plus-hle
    // alist_envmix_exp. We store BE s16 in DMEM/DRAM (matching real RDRAM), so there is
    // no host-endian ^S swap. count (from SETBUFF) is a BYTE count.
    aEnvmix(rd, w0, w1) {
        const flags = (w0 >>> 16) & 0xFF;
        const init = (flags & 0x01) !== 0; // A_INIT
        const aux = (flags & 0x08) !== 0;  // A_AUX
        const n = aux ? 4 : 2;
        const address = this.audioSegAddr(w1);
        const lim = this.mmu.memory.rdram.byteLength;

        const dl = this.alistOut, dr = this.audioDryRight;
        const wl = this.audioWetLeft, wr = this.audioWetRight;
        const dmemi = this.alistIn;
        const count = this.alistCount; // bytes

        // 80-byte (40 s16) state block in DRAM (big-endian).  Byte offsets per mupen's
        // short* pointer arithmetic: wet@0, dry@4, then int32s at 8,12,16,20,24,28,32,36.
        const g16 = (b) => (address + b + 1 < lim) ? rd.getInt16(address + b, false) : 0;
        const g32 = (b) => (address + b + 3 < lim) ? rd.getInt32(address + b, false) : 0;
        const p16 = (b, v) => { if (address + b + 1 < lim) rd.setInt16(address + b, v & 0xFFFF, false); };
        const p32 = (b, v) => { if (address + b + 3 < lim) rd.setInt32(address + b, v | 0, false); };

        let dry = this.audioDry, wet = this.audioWet;
        const val = [0, 0], step = [0, 0], target = [0, 0];
        const expSeq = [0, 0], expRates = [0, 0];

        if (init) {
            val[0] = this.audioVol[0] * 65536;
            val[1] = this.audioVol[1] * 65536;
            target[0] = this.audioTarget[0] * 65536;
            target[1] = this.audioTarget[1] * 65536;
            expRates[0] = this.audioRate[0] | 0;
            expRates[1] = this.audioRate[1] | 0;
            expSeq[0] = Math.imul(this.audioVol[0], this.audioRate[0] | 0); // (vol*rate) int32
            expSeq[1] = Math.imul(this.audioVol[1], this.audioRate[1] | 0);
        } else {
            wet = g16(0);
            dry = g16(4);
            target[0] = g32(8);  target[1] = g32(12);
            expRates[0] = g32(16); expRates[1] = g32(20);
            expSeq[0] = g32(24); expSeq[1] = g32(28);
            val[0] = g32(32); val[1] = g32(36);
        }
        step[0] = target[0] - val[0];
        step[1] = target[1] - val[1];

        let ptr = 0;
        for (let y = 0; y < count; y += 16) {
            for (let ch = 0; ch < 2; ch++) {
                if (step[ch] !== 0) {
                    // exp_seq = (int64)exp_seq * (int64)exp_rates >> 16, truncated to int32
                    const prod = BigInt(expSeq[ch] | 0) * BigInt(expRates[ch] | 0);
                    expSeq[ch] = Number(BigInt.asIntN(32, prod >> 16n));
                    step[ch] = Math.floor((expSeq[ch] - val[ch]) / 8); // (exp_seq - value) >> 3
                }
            }
            for (let x = 0; x < 8; x++) {
                const lVol = this.rampStep(val, step, target, 0);
                const rVol = this.rampStep(val, step, target, 1);
                const src = this.adGetS16(dmemi + ptr * 2);
                const g0 = this.clampS16((lVol * dry + 0x4000) >> 15);
                const g1 = this.clampS16((rVol * dry + 0x4000) >> 15);
                this.sampleMix(dl + ptr * 2, src, g0);
                this.sampleMix(dr + ptr * 2, src, g1);
                if (n === 4) {
                    const g2 = this.clampS16((lVol * wet + 0x4000) >> 15);
                    const g3 = this.clampS16((rVol * wet + 0x4000) >> 15);
                    this.sampleMix(wl + ptr * 2, src, g2);
                    this.sampleMix(wr + ptr * 2, src, g3);
                }
                ptr++;
            }
        }

        // Persist envelope state (int32 truncation matches mupen's int32 fields).
        p16(0, wet);
        p16(4, dry);
        p32(8, target[0] | 0);  p32(12, target[1] | 0);
        p32(16, expRates[0] | 0); p32(20, expRates[1] | 0);
        p32(24, expSeq[0] | 0); p32(28, expSeq[1] | 0);
        p32(32, val[0] | 0); p32(36, val[1] | 0);
    }

    aInterleave(w1) {
        const left = (w1 >>> 16) & 0xFFFF;
        const right = w1 & 0xFFFF;
        let cnt = this.alistCount >> 2;
        let d = this.alistOut, l = left, r = right;
        for (let k = 0; k < cnt; k++) {
            const l1 = this.adGetU16(l), l2 = this.adGetU16(l + 2);
            const r1 = this.adGetU16(r), r2 = this.adGetU16(r + 2);
            this.adSetU16(d, l1); this.adSetU16(d + 2, r1);
            this.adSetU16(d + 4, l2); this.adSetU16(d + 6, r2);
            d += 8; l += 4; r += 4;
        }
    }

    aDmemMove(w0, w1) {
        const dmemin = w0 & 0xFFFF;
        const dmemout = (w1 >>> 16) & 0xFFFF;
        const count = w1 & 0xFFFF;
        const tmp = new Uint8Array(count);
        for (let i = 0; i < count; i++) tmp[i] = this.audioDmem[(dmemin + i) & 0x1FFF];
        for (let i = 0; i < count; i++) this.audioDmem[(dmemout + i) & 0x1FFF] = tmp[i];
    }

    // Order-2 VADPCM decode (RSP audio op 0x01). Reads compressed frames from
    // DMEM[alistIn], writes decoded s16 PCM to DMEM[alistOut]. count = output bytes
    // (32 per 16-sample frame). Codebook uploaded by A_LOADADPCM. State (last frame /
    // history) lives in DRAM at audioSegAddr(w1); loop history at audioLoopAddr.
    // Follows the canonical mupen64plus-hle algorithm. The non-prediction (residual<<scale)
    // path and the book1*l1 path are unit-verified (tmp_adpcm_unit.js); the book2/l2 and
    // in-group feedthrough terms match the reference algorithm but are best-effort until an
    // in-game state can validate them bit-exactly.
    aAdpcm(rd, w0, w1) {
        const flags = (w0 >>> 16) & 0xFF;
        const count = (this.alistCount + 0x1F) & ~0x1F; // output bytes (from SETBUFF), aligned to 32
        const stateAddr = this.audioSegAddr(w1);
        const lim = this.mmu.memory.rdram.byteLength;
        const twoBit = (flags & 0x4) !== 0;
        const cb = this.audioADPCMTable;
        const dmem = this.audioDmem;

        // Seed history from DRAM last-frame (or loop point), unless INIT.
        let l1 = 0, l2 = 0;
        if (!(flags & 0x1)) {
            const a = (flags & 0x2) ? this.audioLoopAddr : stateAddr;
            const a14 = a + 14 * 2, a15 = a + 15 * 2;
            l2 = (a14 + 1 < lim) ? rd.getInt16(a14, false) : 0; // sample[-2]
            l1 = (a15 + 1 < lim) ? rd.getInt16(a15, false) : 0; // sample[-1]
        }

        let inP = this.alistIn & 0x1FFF;
        let outP = this.alistOut & 0x1FFF;
        const frameInBytes = twoBit ? 5 : 9;
        const out = new Int16Array(16);
        const e = new Int32Array(16);

        const nFrames = count >> 5; // 32 bytes (16 samples) per output frame
        for (let f = 0; f < nFrames; f++) {
            const hdr = dmem[inP & 0x1FFF];
            const scale = hdr >> 4;
            const pred = (hdr & 0xF);
            const b1 = pred * 16;       // book1[0..7]
            const b2 = pred * 16 + 8;   // book2[0..7]

            // Unpack residuals (16), sign-extend, shift left by scale.
            if (twoBit) {
                for (let i = 0; i < 4; i++) {
                    const byte = dmem[(inP + 1 + i) & 0x1FFF];
                    for (let j = 0; j < 4; j++) {
                        let n = (byte >> (6 - j * 2)) & 0x3;
                        if (n >= 2) n -= 4;
                        e[i * 4 + j] = n << scale;
                    }
                }
            } else {
                for (let i = 0; i < 8; i++) {
                    const byte = dmem[(inP + 1 + i) & 0x1FFF];
                    let hi = (byte >> 4) & 0xF; if (hi >= 8) hi -= 16;
                    let lo = byte & 0xF; if (lo >= 8) lo -= 16;
                    e[i * 2] = hi << scale;
                    e[i * 2 + 1] = lo << scale;
                }
            }

            // Decode in two groups of 8.
            for (let g = 0; g < 2; g++) {
                const base = g * 8;
                let gl1, gl2;
                if (g === 0) { gl1 = l1; gl2 = l2; }
                else { gl1 = out[7]; gl2 = out[6]; }
                for (let i = 0; i < 8; i++) {
                    let accu = cb[b1 + i] * gl1 + cb[b2 + i] * gl2 + 2048 * e[base + i];
                    // in-group feedthrough: book2 dotted with already-decoded samples
                    for (let k = 0; k < i; k++) accu += cb[b2 + k] * out[base + (i - 1 - k)];
                    let v = accu >> 11;
                    if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
                    out[base + i] = v;
                }
            }

            // Write decoded frame to DMEM[out] (s16 BE), update history.
            for (let i = 0; i < 16; i++) this.adSetS16(outP + i * 2, out[i]);
            l1 = out[15]; l2 = out[14];
            inP += frameInBytes;
            outP += 32;
        }

        // Persist the last decoded frame back to DRAM state for the next call.
        const lastP = (this.alistOut + (nFrames > 0 ? (nFrames - 1) * 32 : 0)) & 0x1FFF;
        for (let i = 0; i < 16; i++) {
            const da = stateAddr + i * 2;
            if (da + 1 < lim) rd.setInt16(da, this.adGetS16(lastP + i * 2), false);
        }
    }

    aLoadADPCM(rd, w0, w1) {
        const count = w0 & 0xFFFF; // bytes
        const addr = this.audioSegAddr(w1);
        const lim = this.mmu.memory.rdram.byteLength;
        const n16 = Math.min(count >> 1, this.audioADPCMTable.length);
        for (let i = 0; i < n16; i++) {
            const a = addr + i * 2;
            this.audioADPCMTable[i] = (a + 1 < lim) ? rd.getInt16(a, false) : 0;
        }
    }

    detectDisplayListFlavor(addr, dataSize, ucodeSize) {
        // Prefer a lightweight opcode scan and bias unknown streams toward Fast3D.
        // SM64 command streams are Fast3D-heavy (0xBF TRI1, 0x04 VTX, etc.).
        const maxScanCommands = dataSize > 0 ? Math.min(96, (dataSize + 7) >>> 3) : 64;
        let f3dex2Signals = 0;
        let f3dSignals = 0;
        let pc = addr >>> 0;

        for (let i = 0; i < maxScanCommands; i++) {
            const hi = this.mmu.read32(Number(pc));
            const op = (hi >>> 24) & 0xFF;
            // Strong F3DEX2 style opcodes.
            if (op === 0xDE || op === 0xDF || op === 0xDA || op === 0xD9 || op === 0xD8) {
                f3dex2Signals += 2;
            }
            if (op === 0x05) f3dex2Signals++;

            // Strong Fast3D-style opcodes.
            if (
                op === 0xBF || op === 0xB1 || op === 0xB8 || op === 0xB6 || op === 0xB7 ||
                op === 0xBC || op === 0xBD || op === 0x03 || op === 0x04
            ) {
                f3dSignals += 2;
            }
            if (op === 0x06) f3dSignals++;
            pc += 8;
        }

        if (f3dex2Signals > f3dSignals + 1) return true;
        if (f3dSignals > 0) return false;
        // Unknown/ambiguous stream: keep Fast3D as safe default for SM64.
        return false;
    }

    processDisplayList(addr, dataSize = 0) {
        if (!this.rspState) this.initRspState();
        let pc = addr, depth = 0, stack = [];
        const taskCommandCount = dataSize > 0 ? ((dataSize + 7) >>> 3) : 0;
        const maxCommands = taskCommandCount > 0
            ? Math.min(50000, Math.max(1024, taskCommandCount * 64))
            : 50000;

        let cmdCount = 0;
        while (pc !== 0 && cmdCount < maxCommands) {
            cmdCount++;
            const hi = this.mmu.read32(Number(pc));
            const lo = this.mmu.read32(Number(pc + 4));
            pc += 8;
            this.rdpCommandCount++;
            const cmd = (hi >>> 24) & 0xFF;
            this.dlOpcodeHistogram[cmd] = (this.dlOpcodeHistogram[cmd] || 0) + 1;
            if (cmd === 0x01 && this.dlSamples.mtx.length < 24) {
                this.dlSamples.mtx.push({ hi: hi >>> 0, lo: lo >>> 0 });
            } else if (cmd === 0x04 && this.dlSamples.vtx.length < 24) {
                this.dlSamples.vtx.push({ hi: hi >>> 0, lo: lo >>> 0 });
            } else if (cmd === 0xBF && this.dlSamples.tri1.length < 24) {
                this.dlSamples.tri1.push({ hi: hi >>> 0, lo: lo >>> 0 });
            } else if (cmd === 0x03 && this.dlSamples.movemem.length < 24) {
                this.dlSamples.movemem.push({ hi: hi >>> 0, lo: lo >>> 0 });
            } else if (cmd === 0xBB && this.dlSamples.texture.length < 24) {
                this.dlSamples.texture.push({ hi: hi >>> 0, lo: lo >>> 0 });
            } else if (cmd === 0xFC && this.dlSamples.setcombine.length < 24) {
                this.dlSamples.setcombine.push({ hi: hi >>> 0, lo: lo >>> 0 });
            }

            switch (cmd) {
                case 0x01:
                    if (this.rspState.isF3DEX2) this.handleG_VTX(hi, lo);
                    else this.handleG_MTX(hi, lo); // Fast3D
                    break;
                case 0x03:
                    this.handleG_MOVEMEM(hi, lo); // Fast3D
                    break;
                case 0x05: // G_TRI1 (F3DEX2)
                    if (this.rspState.isF3DEX2) this.handleG_TRI1(hi, lo, true);
                    break;
                case 0x06: // G_DL (F3D) or G_TRI2 (F3DEX2)
                    if (!this.rspState.isF3DEX2) {
                        const nextDl = this.resolveAddress(lo);
                        const push = (((hi >>> 16) & 0xFF) === 0);
                        if (push) {
                            if (depth < 16) {
                                stack.push(pc);
                                depth++;
                            }
                        }
                        pc = nextDl;
                    } else {
                        this.handleG_TRI2(hi, lo, true);
                    }
                    break;
                case 0xDE: // DL (F3DEX2)
                    const nextDl = this.resolveAddress(lo);
                    if ((hi >>> 16) & 0xFF) {
                        if (depth < 16) { stack.push(pc); depth++; pc = nextDl; }
                    } else pc = nextDl;
                    break;
                case 0xDF: // ENDDL
                    if (depth > 0) { depth--; pc = stack.pop(); }
                    else {
                        this.displayListReturnCount++;
                        return;
                    }
                    break;
                case 0xDA: this.handleG_MTX(hi, lo); break;
                case 0xD8: if (this.rspState.modelviewStack.length > 1) this.rspState.modelviewStack.pop(); break;
                case 0x04: this.handleG_VTX(hi, lo); break;
                case 0xBF: this.handleG_TRI1(hi, lo, this.rspState.isF3DEX2); break;
                case 0xB1: this.handleG_TRI2(hi, lo, this.rspState.isF3DEX2); break;
                case 0xBC: this.handleG_MOVEWORD(hi, lo); break;
                case 0xBD:
                    // Fast3D G_POPMTX.
                    if (this.rspState.modelviewStack.length > 1) this.rspState.modelviewStack.pop();
                    break;
                case 0xB6:
                    this.rspState.geometryMode &= ~lo;
                    break;
                case 0xB7:
                    this.rspState.geometryMode |= lo;
                    break;
                case 0xDB: // G_MOVEWORD (F3DEX2) — same dispatch as 0xBC
                    this.handleG_MOVEWORD(hi, lo);
                    break;
                case 0xFD:
                    this.rspState.textureImage = this.resolvePhysicalAddress(lo);
                    this.rspState.textureImageWidth = (hi & 0xFFF) + 1;
                    this.rspState.textureImageSize = (hi >>> 19) & 0x3;
                    this.recomputeUseTexture();
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
                case 0xE4: // G_TEXRECT — 3 RSP words (24 bytes total)
                    // Word 0 (hi/lo) already consumed; pc now points to G_RDPHALF_1.
                    // G_RDPHALF_1 lo (pc+4)  = (s0<<16)|t0
                    // G_RDPHALF_2 lo (pc+12) = (dsdx<<16)|dtdy
                    // Skip both G_RDPHALF_1 and G_RDPHALF_2 so the next iteration
                    // reads the command after the 3-word TEXRECT block.
                    this.handleG_TEXRECT(hi, lo, pc - 8, false, false);
                    pc += 16;
                    break;
                case 0xE5: // G_TEXRECTFLIP — same 3-word layout as G_TEXRECT
                    this.handleG_TEXRECT(hi, lo, pc - 8, true, false);
                    pc += 16;
                    break;
                case 0xE2: // G_SETOTHERMODE_L (F3DEX2) - masked RMW (Task #35)
                    this.rspState.otherModeLo = this._otherModeRMW(this.rspState.otherModeLo, hi, lo, true);
                    break;
                case 0xB9: // G_SETOTHERMODE_L (F3D)
                    this.rspState.otherModeLo = this._otherModeRMW(this.rspState.otherModeLo, hi, lo, false);
                    break;
                case 0xE3: // G_SETOTHERMODE_H (F3DEX2)
                    this.rspState.otherModeHi = this._otherModeRMW(this.rspState.otherModeHi, hi, lo, true);
                    break;
                case 0xBA: // G_SETOTHERMODE_H (F3D)
                    this.rspState.otherModeHi = this._otherModeRMW(this.rspState.otherModeHi, hi, lo, false);
                    break;
                case 0xBB:
                    this.rspState.textureScaleS = (lo >>> 16) / 65536.0;
                    this.rspState.textureScaleT = (lo & 0xFFFF) / 65536.0;
                    this.rspState.currentTile = (hi >>> 8) & 0x7;
                    this.rspState.textureEnabled = (hi & 0xFF) !== 0;
                    this.recomputeUseTexture();
                    break;
                case 0xFA: this.rspState.primColor = lo; break;
                case 0xFB: this.rspState.envColor = lo; break;
                case 0xF9: this.rspState.blendColor = lo; break;
                case 0xF8: this.rspState.fogColor = lo; break;
                case 0xD9: this.rspState.geometryMode |= lo; break;
                case 0xB8: // ENDDL in F3D/F3DEX2
                    if (depth > 0) { depth--; pc = stack.pop(); }
                    else {
                        this.displayListReturnCount++;
                        return;
                    }
                    break;
                case 0xE7: case 0xE6: case 0xE8: break; // Syncs
                case 0xE9: // FULLSYNC
                    this.mmu.miRegisters[2] |= 0x20;
                    this.mmu.updateInterrupts();
                    break;
                case 0xF0: this.handleG_LOADTLUT(hi, lo); break;
            }
        }
        if (cmdCount >= maxCommands) this.displayListAbortCount++;
    }

    createIdentityMatrix() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }

    multiplyMatrices(a, b) {
        // Row-major 4x4 multiply: res = a * b where a, b, res use a[row*4+col].
        // (libultra's readMatrix produces a row-major flat array.)
        const res = new Array(16).fill(0);
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                res[r * 4 + c] =
                    a[r * 4 + 0] * b[0 * 4 + c] +
                    a[r * 4 + 1] * b[1 * 4 + c] +
                    a[r * 4 + 2] * b[2 * 4 + c] +
                    a[r * 4 + 3] * b[3 * 4 + c];
            }
        }
        return res;
    }

    readMatrix(addr) {
        // libultra Mtx layout: two 32-byte halves (integer, then fractional).
        // Each half stores 16 16-bit values laid out as `s32 m[8][2]`, i.e.
        // bytes 0-3 = (M[0][0]_int, M[0][1]_int), bytes 4-7 = (M[0][2]_int,
        // M[0][3]_int), bytes 8-11 = (M[1][0]_int, M[1][1]_int), etc.
        // Returned flat array is row-major: m[row*4 + col] = M[row][col].
        const m = new Array(16);
        for (let row = 0; row < 4; row++) {
            for (let pair = 0; pair < 2; pair++) {
                const idx = row * 2 + pair;
                const hiWord = this.mmu.read32(addr + idx * 4) >>> 0;
                const loWord = this.mmu.read32(addr + 32 + idx * 4) >>> 0;
                const fixed0 = (((hiWord & 0xFFFF0000) >>> 0) | (loWord >>> 16)) | 0;
                const fixed1 = ((((hiWord & 0xFFFF) << 16) >>> 0) | (loWord & 0xFFFF)) | 0;
                m[row * 4 + pair * 2] = fixed0 / 65536.0;
                m[row * 4 + pair * 2 + 1] = fixed1 / 65536.0;
            }
        }
        return m;
    }

    resolveAddress(addr) {
        const seg = (addr >>> 24) & 0xF;
        const base = this.rspState.segments[seg];
        const res = (base + (addr & 0x00FFFFFF)) >>> 0;
        // If it's a ROM address (Domain 1 or 2), return it as is (will be handled by MMU)
        if ((res >= 0x08000000 && res <= 0x0FFFFFFF) || (res >= 0x10000000 && res <= 0x1FBFFFFF)) {
            return res;
        }
        // Otherwise, assume it's RDRAM and ensure it's in KSEG0 for the MMU
        return (res & 0x007FFFFF) | 0x80000000;
    }

    resolvePhysicalAddress(addr) {
        const seg = (addr >>> 24) & 0xF;
        const base = this.rspState.segments[seg];
        const res = (base + (addr & 0x00FFFFFF)) >>> 0;
        if ((res >= 0x08000000 && res <= 0x0FFFFFFF) || (res >= 0x10000000 && res <= 0x1FBFFFFF)) {
            return res;
        }
        return res & 0x007FFFFF;
    }

    handleG_VTX(hi, lo) {
        let num, dest;
        if (this.rspState.isF3DEX2) {
            num = (hi >> 12) & 0xFF;
            // F3DEX2 encodes (v0 + n) in bits 1..7.
            dest = ((hi >> 1) & 0x7F) - num;
        } else {
            // Fast3D: low 16 bits are vertex byte length (n * 16),
            // and destination vertex is encoded in the low nibble of bits 16..23.
            num = ((hi & 0xFFFF) >>> 4) & 0x3F;
            dest = (hi >>> 16) & 0xF;
        }
        if (dest < 0) dest = 0;
        if (num <= 0) return;
        const addr = this.resolveAddress(lo);
        const mv = this.rspState.modelviewStack[this.rspState.modelviewStack.length - 1];
        const p = this.rspState.projectionMatrix;
        // libultra is row-vector: v' = v * MV * P. Composition MVP = MV * P.
        // multiplyMatrices(a, b) computes (A*B)[r][c] = sum_k A[r][k] * B[k][c],
        // which is exactly MV*P when called as (mv, p).
        const mvp = this.multiplyMatrices(mv, p);

        // G_LIGHTING (0x00020000 on both Fast3D and F3DEX2): when set, bytes
        // 12..14 of each vertex hold a signed normal, not RGB. We compute the
        // shade per-vertex using ambient + N·L for any configured lights, or a
        // sensible default if the game hasn't sent any lights yet.
        const lightingOn = (this.rspState.geometryMode & 0x00020000) !== 0;

        for (let i = 0; i < num; i++) {
            const v = addr + i * 16;
            const x = (this.mmu.read16(v) << 16) >> 16;
            const y = (this.mmu.read16(v + 2) << 16) >> 16;
            const z = (this.mmu.read16(v + 4) << 16) >> 16;
            // Row-vector v_row * MVP: output[c] = sum_r v[r] * mvp[r*4+c].
            // With v = (x, y, z, 1), this picks the c-th *column* of MVP.
            const tx = x*mvp[0] + y*mvp[4] + z*mvp[8]  + mvp[12];
            const ty = x*mvp[1] + y*mvp[5] + z*mvp[9]  + mvp[13];
            const tz = x*mvp[2] + y*mvp[6] + z*mvp[10] + mvp[14];
            const tw = x*mvp[3] + y*mvp[7] + z*mvp[11] + mvp[15];

            // Pre-divide screen coords for the common all-in-front case. We also
            // keep the clip-space coords (cx, cy, cz, cw) on the vertex so
            // drawTriangle can do real near-plane clipping in clip space before
            // any perspective divide on partially-clipped triangles.
            const proj = this.projectClipToScreen(tx, ty, tz, tw);

            let r, g, b;
            const a = this.mmu.read8(v + 15);
            if (lightingOn) {
                // Signed normal components from bytes 12..14, normalized to [-1, 1].
                const nx = ((this.mmu.read8(v + 12) << 24) >> 24) / 127.0;
                const ny = ((this.mmu.read8(v + 13) << 24) >> 24) / 127.0;
                const nz = ((this.mmu.read8(v + 14) << 24) >> 24) / 127.0;
                const shade = this.computeLitShade(nx, ny, nz);
                r = shade.r; g = shade.g; b = shade.b;
            } else {
                r = this.mmu.read8(v + 12);
                g = this.mmu.read8(v + 13);
                b = this.mmu.read8(v + 14);
            }

            this.rspState.vertices[dest + i] = {
                x: proj.sx, y: proj.sy, z: proj.sz, w: tw,
                cx: tx, cy: ty, cz: tz, cw: tw,
                r, g, b, a,
                s: (this.mmu.read16(v + 8) << 16) >> 16, t: (this.mmu.read16(v + 10) << 16) >> 16,
                _needsProject: false
            };
        }
    }

    // Compute lit shade for a vertex normal. Returns {r, g, b} in [0, 255].
    // Uses configured lights (from G_MOVEMEM index G_MV_L0..7 + ambient slot)
    // if present, otherwise falls back to a default ambient + key light so
    // SM64's Mario isn't pitch-black before the game finishes setting up lights.
    computeLitShade(nx, ny, nz) {
        const lights = this.rspState.lights;
        const numLights = this.rspState.numLights | 0;
        let ambR, ambG, ambB;
        let dirLights;
        if (lights && numLights > 0 && lights[numLights]) {
            const amb = lights[numLights];
            ambR = amb.r; ambG = amb.g; ambB = amb.b;
            dirLights = lights.slice(0, numLights);
        } else {
            // Default: warm ambient + one front-up key light. Matches what the
            // SM64 boot intro looks like before the game's own light setup
            // takes over.
            ambR = 64; ambG = 64; ambB = 64;
            dirLights = [{ r: 200, g: 200, b: 200, dx: 0.4, dy: 0.7, dz: 0.6 }];
        }
        let R = ambR, G = ambG, B = ambB;
        for (const L of dirLights) {
            const dot = nx * L.dx + ny * L.dy + nz * L.dz;
            const k = dot > 0 ? dot : 0;
            R += L.r * k;
            G += L.g * k;
            B += L.b * k;
        }
        return {
            r: R > 255 ? 255 : (R < 0 ? 0 : R | 0),
            g: G > 255 ? 255 : (G < 0 ? 0 : G | 0),
            b: B > 255 ? 255 : (B < 0 ? 0 : B | 0)
        };
    }

    // Apply perspective divide + viewport mapping to a clip-space vertex.
    // Returns {sx, sy, sz}. Safe against tw == 0.
    //
    // libultra's perspective matrix (row-vector convention):
    //   tw = -z_eye   (positive for objects in front of camera)
    //   tz/tw = NDC_z ∈ [-1, 1] for the near/far range
    //
    // Depth mapping: sz = (NDC_z + 1) / 2  maps [-1,+1] → [0,1]
    //   near plane (NDC_z = -1)  →  sz = 0   →  zFixed = 0
    //   far plane  (NDC_z = +1)  →  sz = 1   →  zFixed = 0xFFFF
    //
    // This gives proper depth ordering as long as the depth buffer is cleared
    // to 0xFFFF (far) via G_FILLRECT before each frame — which SM64 does.
    // The old formula `1 - 1/(1+|tw|)` mapped all SM64 geometry to sz ≈ 0.997,
    // making the depth test a coin-flip and causing triangle ordering artifacts.
    projectClipToScreen(tx, ty, tz, tw) {
        let sx = 160, sy = 120, sz = 0.5;
        if (Math.abs(tw) > 1e-6) {
            const ndcX = tx / tw;
            const ndcY = ty / tw;
            const ndcZ = tz / tw;
            // Map NDC_z ∈ [-1,1] → [0,1]. Clamp to guard against out-of-frustum
            // vertices that survive near-plane clipping (e.g. w-clipped slivers).
            const rawDepth = (ndcZ + 1.0) * 0.5;
            sz = rawDepth < 0.0 ? 0.0 : rawDepth > 1.0 ? 1.0 : rawDepth;
            if (this.rspState.viewport) {
                const vp = this.rspState.viewport;
                sx = ndcX * vp.scale[0] + vp.trans[0];
                sy = -ndcY * vp.scale[1] + vp.trans[1];
            } else {
                sx = ndcX * 160 + 160;
                sy = -ndcY * 120 + 120;
            }
        }
        return { sx, sy, sz };
    }

    handleG_TRI1(hi, lo, isEX2) {
        const s = isEX2 ? 2 : 10;
        const v1 = this.rspState.vertices[(((isEX2 ? hi >> 16 : lo >> 16) & 0xFF) / s) | 0];
        const v2 = this.rspState.vertices[(((isEX2 ? hi >> 8 : lo >> 8) & 0xFF) / s) | 0];
        const v3 = this.rspState.vertices[((((isEX2 ? hi : lo) & 0xFF) / s) | 0)];
        if (v1 && v2 && v3) this.drawTriangle(v1, v2, v3);
    }

    handleG_TRI2(hi, lo, isEX2) {
        const s = isEX2 ? 2 : 10;
        const v1 = this.rspState.vertices[((((hi >> 16) & 0xFF) / s) | 0)];
        const v2 = this.rspState.vertices[((((hi >> 8) & 0xFF) / s) | 0)];
        const v3 = this.rspState.vertices[(((hi & 0xFF) / s) | 0)];
        if (v1 && v2 && v3) this.drawTriangle(v1, v2, v3);

        const v4 = this.rspState.vertices[((((lo >> 16) & 0xFF) / s) | 0)];
        const v5 = this.rspState.vertices[((((lo >> 8) & 0xFF) / s) | 0)];
        const v6 = this.rspState.vertices[((lo & 0xFF) / s) | 0];
        if (v4 && v5 && v6) this.drawTriangle(v4, v5, v6);
    }

    handleG_MOVEMEM(hi, lo) {
        const idx = (hi >>> 16) & 0xFF;
        const addr = this.resolveAddress(lo);
        // Viewport (Fast3D: 0x80, F3DEX2: 0x08, plus the legacy 0x01 alias).
        if (idx === 0x01 || idx === 0x08 || idx === 0x80) {
            this.rspState.viewport = {
                scale: [((this.mmu.read16(addr) << 16) >> 16) / 4.0, ((this.mmu.read16(addr + 2) << 16) >> 16) / 4.0, ((this.mmu.read16(addr + 4) << 16) >> 16) / 512.0],
                trans: [((this.mmu.read16(addr + 8) << 16) >> 16) / 4.0, ((this.mmu.read16(addr + 10) << 16) >> 16) / 4.0, ((this.mmu.read16(addr + 12) << 16) >> 16) / 512.0]
            };
            return;
        }
        // Fast3D lights: G_MV_L0=0x86, L1=0x88, ..., L7=0x94. The slot for
        // the ambient term is index (numLights*2 + 0x86). The Light_t / Ambient_t
        // layouts share the same first 4 bytes (RGB + pad), so we read those
        // unconditionally and only pull dir bytes when present.
        if (idx >= 0x86 && idx <= 0x94 && ((idx - 0x86) & 1) === 0) {
            const slot = (idx - 0x86) >>> 1;
            if (slot >= 0 && slot < 8) {
                const r = this.mmu.read8(addr + 0);
                const g = this.mmu.read8(addr + 1);
                const b = this.mmu.read8(addr + 2);
                // Direction bytes live at +8..+10 as signed 8-bit. Normalize so
                // we don't depend on the game to provide a unit vector exactly.
                const dxRaw = (this.mmu.read8(addr + 8) << 24) >> 24;
                const dyRaw = (this.mmu.read8(addr + 9) << 24) >> 24;
                const dzRaw = (this.mmu.read8(addr + 10) << 24) >> 24;
                let dx = dxRaw / 127, dy = dyRaw / 127, dz = dzRaw / 127;
                const m = Math.sqrt(dx*dx + dy*dy + dz*dz);
                if (m > 1e-6) { dx /= m; dy /= m; dz /= m; }
                if (!this.rspState.lights) this.rspState.lights = new Array(8).fill(null);
                this.rspState.lights[slot] = { r, g, b, dx, dy, dz };
            }
            return;
        }
        // F3DEX2 single light slot (G_MV_LIGHT = 0x0A). Address encodes the
        // sub-slot in upper bits of `lo`; for now treat as light 0.
        if (idx === 0x0A) {
            const r = this.mmu.read8(addr + 0);
            const g = this.mmu.read8(addr + 1);
            const b = this.mmu.read8(addr + 2);
            const dxRaw = (this.mmu.read8(addr + 8) << 24) >> 24;
            const dyRaw = (this.mmu.read8(addr + 9) << 24) >> 24;
            const dzRaw = (this.mmu.read8(addr + 10) << 24) >> 24;
            let dx = dxRaw / 127, dy = dyRaw / 127, dz = dzRaw / 127;
            const m = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (m > 1e-6) { dx /= m; dy /= m; dz /= m; }
            if (!this.rspState.lights) this.rspState.lights = new Array(8).fill(null);
            this.rspState.lights[0] = { r, g, b, dx, dy, dz };
            return;
        }
    }

    handleG_MTX(hi, lo) {
        // Matrix flags live in bits 16..23 (not the low byte, which is usually length).
        const f = (hi >>> 16) & 0xFF;
        const m = this.readMatrix(this.resolveAddress(lo));
        if (f & 0x01) {
            if (f & 0x02) this.rspState.projectionMatrix = m;
            else this.rspState.projectionMatrix = this.multiplyMatrices(this.rspState.projectionMatrix, m);
        } else {
            let cur = this.rspState.modelviewStack[this.rspState.modelviewStack.length - 1];
            let next = (f & 0x02) ? m : this.multiplyMatrices(cur, m);
            // F3D microcode-level PUSH bit is INVERTED by libultra's gSPMatrix
            // macro (which XORs in G_MTX_PUSH=0x04 before encoding). So at the
            // RSP command level bit 2 SET means NOPUSH, CLEAR means PUSH.
            // F3DEX2 microcode uses the bit directly (no XOR): bit 0 = PUSH,
            // bit 2 = PROJECTION.
            const isPush = this.rspState.isF3DEX2 ? ((f & 0x01) !== 0) : ((f & 0x04) === 0);
            if (isPush) this.rspState.modelviewStack.push(next);
            else this.rspState.modelviewStack[this.rspState.modelviewStack.length - 1] = next;
        }
    }

    handleG_FILLRECT(hi, lo) {
        this.drawStats.fillRects++;
        this.recordVideoWrite('fill');
        // RDP G_FILLRECT: the rect goes from (x1, y1) to (x2, y2) INCLUSIVE on
        // both ends in 10.2 fixed point. The previous version used `<` for the
        // upper bound which dropped the last row/column — visible as a 1-pixel
        // unfilled strip at the bottom/right of every cleared framebuffer (and
        // worse, an unfilled 1-pixel strip of the Z buffer that always failed
        // the depth test).
        const x2 = (hi >>> 12) & 0xFFF, y2 = hi & 0xFFF, x1 = (lo >>> 12) & 0xFFF, y1 = lo & 0xFFF;
        const addr = this.rspState.colorImage;
        if (!addr && addr !== 0) return;
        if (this.rspState.colorImageWidth <= 0) return;
        const rd = new DataView(this.mmu.memory.rdram);
        const sz = this.rspState.colorImageSize;
        const w = this.rspState.colorImageWidth;

        const bpp = (sz === 3) ? 4 : (sz === 2 ? 2 : 1);
        // For 16-bit fills, the N64 RDP writes two pixels per cycle using the
        // 32-bit fillColor split into a high and a low half. Most game code
        // packs the same value in both halves (so it doesn't matter which we
        // pick), but pick the half that matches the pixel's x parity so that
        // games packing distinct values still get a sensible fill.
        const fillHi16 = (this.rspState.fillColor >>> 16) & 0xFFFF;
        const fillLo16 =  this.rspState.fillColor        & 0xFFFF;

        const yStart = Math.max(0, Math.floor(y1 / 4));
        const yEnd   = Math.min(239, Math.floor(y2 / 4));
        const xStart = Math.max(0, Math.floor(x1 / 4));
        const xEnd   = Math.min(w - 1, Math.floor(x2 / 4));

        // GL renderer tap (Task #40): color fills become scissored clears; fills
        // aimed at the depth image become depth clears.
        if (this.glr) { this.glr.fillRect(this, xStart, yStart, xEnd, yEnd); return; }

        for (let y = yStart; y <= yEnd; y++) {
            for (let x = xStart; x <= xEnd; x++) {
                const p = (addr + (y * w + x) * bpp) & 0x7FFFFF;
                if (sz === 3) rd.setUint32(p, this.rspState.fillColor >>> 0, false);
                else if (sz === 2) rd.setUint16(p, (x & 1) ? fillLo16 : fillHi16, false);
                else rd.setUint8(p, this.rspState.fillColor & 0xFF);
            }
        }
    }

    drawTriangle(v1, v2, v3) {
        this.drawStats.triangles++;
        if (this.rspState.useTexture) this.drawStats.texturedTriangles++;
        else this.drawStats.untexturedTriangles++;
        if (this.rspState.textureEnabled) this.drawStats.textureEnabledTriangles++;
        else this.drawStats.textureDisabledTriangles++;
        this.recordVideoWrite('tri');
        this.drawStats.minX = Math.min(this.drawStats.minX, v1.x, v2.x, v3.x);
        this.drawStats.minY = Math.min(this.drawStats.minY, v1.y, v2.y, v3.y);
        this.drawStats.maxX = Math.max(this.drawStats.maxX, v1.x, v2.x, v3.x);
        this.drawStats.maxY = Math.max(this.drawStats.maxY, v1.y, v2.y, v3.y);
        const addr = this.rspState.colorImage;
        if (!addr) return;

        // Early reject — all three vertices on the same side of the screen.
        // Sutherland–Hodgman correctly handles this case but it costs allocation
        // and a fan pass per triangle, which adds up over a million-triangle
        // boot intro. The simple AABB check below catches most off-screen
        // geometry without running the full pipeline.
        const sw = (this.rspState.colorImageWidth | 0) || 320;
        const sh = 240;
        if ((v1.x < 0 && v2.x < 0 && v3.x < 0) ||
            (v1.x >= sw && v2.x >= sw && v3.x >= sw) ||
            (v1.y < 0 && v2.y < 0 && v3.y < 0) ||
            (v1.y >= sh && v2.y >= sh && v3.y >= sh)) {
            this.drawStats.offscreenTriangles = (this.drawStats.offscreenTriangles | 0) + 1;
            return;
        }

        // Stage 1: clip in clip space against the near plane. libultra row-vector
        // projection produces |W| ~ |z_eye|, with W's sign depending on the game's
        // matrix conventions. The triangle is "in front of the eye" if all
        // vertices share the same nonzero W sign and |W| is bounded below. We
        // clip against the plane W = nearW (in whichever sign hemisphere the
        // first vertex sits) so straddling triangles are trimmed before the
        // perspective divide blows them up to huge screen extents.
        const clippedClip = this.clipTriangleNearPlane(v1, v2, v3);
        if (clippedClip.length < 3) return;

        // Stage 2: perspective-divide each clipped vertex back to screen space.
        // The vertices that didn't move through clipping reuse their cached
        // screen coords; new vertices generated by the clipper compute fresh ones.
        const screenPoly = clippedClip.map(v => {
            if (v._needsProject) {
                const p = this.projectClipToScreen(v.cx, v.cy, v.cz, v.cw);
                return {
                    x: p.sx, y: p.sy, z: p.sz, w: v.cw,
                    cx: v.cx, cy: v.cy, cz: v.cz, cw: v.cw,
                    r: v.r, g: v.g, b: v.b, a: v.a,
                    s: v.s, t: v.t,
                    _needsProject: false
                };
            }
            return v;
        });

        // Stage 2.5: backface culling based on geometryMode. Both microcodes
        // expose CULL_FRONT and CULL_BACK flags but at different bit positions:
        //   Fast3D:  CULL_FRONT=0x1000, CULL_BACK=0x2000
        //   F3DEX2:  CULL_FRONT=0x0200, CULL_BACK=0x0400
        // SM64 sets G_CULL_BACK on most opaque geometry, which currently
        // double-shades back-facing triangles over front-facing ones.
        const gm = this.rspState.geometryMode >>> 0;
        const cullFrontBit = this.rspState.isF3DEX2 ? 0x00000200 : 0x00001000;
        const cullBackBit  = this.rspState.isF3DEX2 ? 0x00000400 : 0x00002000;
        const cullFront = (gm & cullFrontBit) !== 0;
        const cullBack  = (gm & cullBackBit)  !== 0;
        // Screen-space signed area in Y-down coordinates.
        // Front-facing (CCW in Y-up world) maps to NEGATIVE area after Y-flip in projection.
        // Back-facing  (CW  in Y-up world) maps to POSITIVE area.
        // So CULL_BACK removes area > 0, CULL_FRONT removes area < 0.
        if (cullFront || cullBack) {
            const a = screenPoly[0], b = screenPoly[1], c = screenPoly[2];
            const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
            if (cullBack && cullFront) { this.drawStats.culledTriangles = (this.drawStats.culledTriangles|0)+1; return; }
            if (cullBack  && area > 0) { this.drawStats.culledTriangles = (this.drawStats.culledTriangles|0)+1; return; }
            if (cullFront && area < 0) { this.drawStats.culledTriangles = (this.drawStats.culledTriangles|0)+1; return; }
        }

        // GL renderer tap (Task #40): hand the clipped, culled screen-space fan
        // to the WebGL backend and skip software rasterization entirely.
        if (this.glr) { this.glr.triFan(screenPoly, this); return; }

        // Stage 3: clip against the screen-edge rectangle and rasterize as a fan.
        for (let i = 1; i < screenPoly.length - 1; i++) {
            const tri = this.clipTriangleToViewport(
                screenPoly[0], screenPoly[i], screenPoly[i + 1],
                this.rspState.colorImageWidth, 240
            );
            if (tri.length < 3) continue;
            for (let j = 1; j < tri.length - 1; j++) {
                this.rasterizeTriangle(tri[0], tri[j], tri[j + 1], addr);
            }
        }
    }

    // Clip a triangle against the near plane in clip space using Sutherland–Hodgman.
    // We pick the sign hemisphere from the first vertex with |cw| above a small
    // epsilon (libultra-row-vector projection can yield either sign). The plane
    // we clip against is `signed_w >= nearW`, where signed_w = cw if the
    // hemisphere is positive, or -cw if negative. This keeps tiny/near-eye W
    // values from being perspective-divided into the next county.
    clipTriangleNearPlane(v1, v2, v3) {
        const poly = [v1, v2, v3];
        // SM64 (both the F3DEX2 title and the Fast3D/goddard menu) uses libultra's
        // standard row-vector perspective: in-front geometry has POSITIVE W, the
        // near plane is at W = small positive. Goddard is a software 3D engine that
        // submits its entire scene — including geometry BEHIND the camera (W <= 0) —
        // and relies on the RSP's W-based near-plane clip to reject it. The previous
        // "pick the sign hemisphere from the first vertex" heuristic flipped to the
        // negative hemisphere whenever a triangle's first vertex was behind the eye,
        // which KEPT behind-camera triangles and perspective-divided them into
        // ±200k screen coords (the striped/tiled menu garbage). Always clip against
        // the positive-W near plane so behind-camera triangles are culled/trimmed.
        const sign = 1;
        const nearW = 1.0;
        const sw = (v) => sign * (v.cw !== undefined ? v.cw : v.w);
        const inside = (v) => sw(v) >= nearW;
        const out = [];
        for (let i = 0; i < poly.length; i++) {
            const curr = poly[i];
            const prev = poly[(i + poly.length - 1) % poly.length];
            const currIn = inside(curr);
            const prevIn = inside(prev);
            if (currIn) {
                if (!prevIn) out.push(this.lerpClipVertex(prev, curr, (nearW - sw(prev)) / (sw(curr) - sw(prev))));
                out.push(curr);
            } else if (prevIn) {
                out.push(this.lerpClipVertex(prev, curr, (nearW - sw(prev)) / (sw(curr) - sw(prev))));
            }
        }
        return out;
    }

    // Interpolate two clip-space vertices and mark the result so the screen-space
    // coordinates get recomputed in drawTriangle's projection stage.
    lerpClipVertex(a, b, t) {
        if (!isFinite(t)) t = 0;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const lerp = (x, y) => x + (y - x) * t;
        const acw = a.cw !== undefined ? a.cw : a.w;
        const bcw = b.cw !== undefined ? b.cw : b.w;
        const acx = a.cx !== undefined ? a.cx : a.x;
        const bcx = b.cx !== undefined ? b.cx : b.x;
        const acy = a.cy !== undefined ? a.cy : a.y;
        const bcy = b.cy !== undefined ? b.cy : b.y;
        const acz = a.cz !== undefined ? a.cz : a.z;
        const bcz = b.cz !== undefined ? b.cz : b.z;
        return {
            x: 0, y: 0, z: 0, w: lerp(acw, bcw),
            cx: lerp(acx, bcx), cy: lerp(acy, bcy), cz: lerp(acz, bcz), cw: lerp(acw, bcw),
            r: lerp(a.r, b.r), g: lerp(a.g, b.g), b: lerp(a.b, b.b), a: lerp(a.a, b.a),
            s: lerp(a.s, b.s), t: lerp(a.t, b.t),
            _needsProject: true
        };
    }

    clipTriangleToViewport(v1, v2, v3, width, height) {
        let poly = [v1, v2, v3];
        poly = this.clipPolygonAgainstAxis(poly, 'x', 0, true);
        poly = this.clipPolygonAgainstAxis(poly, 'x', Math.max(0, width - 1), false);
        poly = this.clipPolygonAgainstAxis(poly, 'y', 0, true);
        poly = this.clipPolygonAgainstAxis(poly, 'y', Math.max(0, height - 1), false);
        return poly;
    }

    clipPolygonAgainstAxis(poly, axis, bound, keepGreater) {
        if (!poly || poly.length === 0) return [];
        const out = [];
        const inside = (v) => keepGreater ? v[axis] >= bound : v[axis] <= bound;
        const intersect = (a, b) => {
            const denom = b[axis] - a[axis];
            let t = 0;
            if (Math.abs(denom) > 1e-6) t = (bound - a[axis]) / denom;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            return this.lerpVertex(a, b, t);
        };

        for (let i = 0; i < poly.length; i++) {
            const curr = poly[i];
            const prev = poly[(i + poly.length - 1) % poly.length];
            const currInside = inside(curr);
            const prevInside = inside(prev);
            if (currInside) {
                if (!prevInside) out.push(intersect(prev, curr));
                out.push(curr);
            } else if (prevInside) {
                out.push(intersect(prev, curr));
            }
        }
        return out;
    }

    lerpVertex(a, b, t) {
        const lerp = (x, y) => x + (y - x) * t;
        return {
            x: lerp(a.x, b.x),
            y: lerp(a.y, b.y),
            z: lerp(a.z, b.z),
            w: lerp(a.w ?? 1, b.w ?? 1),
            r: lerp(a.r, b.r),
            g: lerp(a.g, b.g),
            b: lerp(a.b, b.b),
            a: lerp(a.a, b.a),
            s: lerp(a.s, b.s),
            t: lerp(a.t, b.t)
        };
    }

    rasterizeTriangle(v1, v2, v3, addr) {
        const x1 = v1.x, y1 = v1.y, x2 = v2.x, y2 = v2.y, x3 = v3.x, y3 = v3.y;
        const minX = Math.floor(Math.min(x1, x2, x3)), maxX = Math.ceil(Math.max(x1, x2, x3));
        const minY = Math.floor(Math.min(y1, y2, y3)), maxY = Math.ceil(Math.max(y1, y2, y3));
        const rs = this.rspState;
        const rd = new DataView(this.mmu.memory.rdram), w = rs.colorImageWidth, zAddr = rs.depthImage;
        // Raw byte view for the per-pixel z/fb accesses (Task #39): DataView
        // builtin calls were ~45% of the rasterizer's native ticks. Same bytes,
        // same order (big-endian compose/decompose), byte-identical.
        let r8 = this._rdram8;
        if (!r8 || r8.buffer !== this.mmu.memory.rdram) r8 = this._rdram8 = new Uint8Array(this.mmu.memory.rdram);
        const depthEnabled = !!zAddr && ((rs.geometryMode & 0x00000001) !== 0);

        // Per-scanline span clipping (Task #24/#25): each barycentric coord is
        // linear in x, so a row's covered region is a contiguous x-interval.
        const _det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
        if (Math.abs(_det) < 0.0001) return;
        const dsdx = (y2 - y3) / _det;
        const dtdx = (y3 - y1) / _det;
        const dudx = -dsdx - dtdx;

        // Triangle-invariant values hoisted out of the per-pixel loop (Task #32).
        // Byte-identical to the prior per-pixel computation (same float operands
        // and order); this only removes redundant work — perspective 1/w, the
        // s/t-over-w vertex products, and the texture/combine/blender mode decode
        // — from the inner loop. The per-pixel object allocations Task #24 proved
        // must stay (V8 escape analysis) are deliberately left in place.
        const aw1 = Math.abs(v1.w ?? 1); const invW1 = 1.0 / (aw1 > 1e-6 ? aw1 : 1.0);
        const aw2 = Math.abs(v2.w ?? 1); const invW2 = 1.0 / (aw2 > 1e-6 ? aw2 : 1.0);
        const aw3 = Math.abs(v3.w ?? 1); const invW3 = 1.0 / (aw3 > 1e-6 ? aw3 : 1.0);
        const sw1 = v1.s * invW1, sw2 = v2.s * invW2, sw3 = v3.s * invW3;
        const tw1 = v1.t * invW1, tw2 = v2.t * invW2, tw3 = v3.t * invW3;
        const scaleS = rs.textureScaleS, scaleT = rs.textureScaleT;
        const useTex = rs.useTexture, curTile = rs.currentTile;
        const combineActive = !!(rs.combine.hi || rs.combine.lo);
        const alphaCmp = (rs.otherModeLo & 0x4000);
        const cSz = rs.colorImageSize, pxBytes = (cSz === 3 ? 4 : 2);
        const blActive = this.blenderActive();
        // Decode the combiner/blender muxes once per triangle (Task #33). These
        // fields are triangle-invariant; combineColor/blendPixel read them so the
        // per-pixel loop no longer re-decodes hi/lo/prim/env/otherModeLo. Output
        // is byte-identical (same operands, same order).
        if (combineActive) this._setupCombine();
        if (blActive) this._setupBlend();

        for (let y = minY; y <= maxY; y++) {
            if (y < 0 || y >= 240) continue;
            const s0 = ((y2 - y3) * (minX - x3) + (x3 - x2) * (y - y3)) / _det;
            const t0 = ((y3 - y1) * (minX - x3) + (x1 - x3) * (y - y3)) / _det;
            const u0 = 1 - s0 - t0;
            let xLo = minX, xHi = maxX, rowEmpty = false;
            if (dsdx > 0) { const b = minX - s0 / dsdx; if (b > xLo) xLo = b; }
            else if (dsdx < 0) { const b = minX - s0 / dsdx; if (b < xHi) xHi = b; }
            else if (s0 < 0) rowEmpty = true;
            if (dtdx > 0) { const b = minX - t0 / dtdx; if (b > xLo) xLo = b; }
            else if (dtdx < 0) { const b = minX - t0 / dtdx; if (b < xHi) xHi = b; }
            else if (t0 < 0) rowEmpty = true;
            if (dudx > 0) { const b = minX - u0 / dudx; if (b > xLo) xLo = b; }
            else if (dudx < 0) { const b = minX - u0 / dudx; if (b < xHi) xHi = b; }
            else if (u0 < 0) rowEmpty = true;
            if (rowEmpty) continue;
            let xs = Math.floor(xLo) - 1, xe = Math.ceil(xHi) + 1;
            if (xs < minX) xs = minX;
            if (xe > maxX) xe = maxX;
            for (let x = xs; x <= xe; x++) {
                if (x < 0 || x >= w) continue;
                // Inlined barycentric weights (Task #39): identical formulas and
                // operand order as getBarycentricWeights (same det as _det), so
                // values are byte-identical — this only removes the per-pixel
                // call, the redundant det recompute, and the {s,t,u} allocation.
                const ws = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / _det;
                const wt = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / _det;
                const wu = 1 - ws - wt;
                if (ws >= 0 && wt >= 0 && wu >= 0) {
                    const z = v1.z * ws + v2.z * wt + v3.z * wu;
                    let zFixed = 0, zp = 0;
                    if (depthEnabled) {
                        zFixed = Math.max(0, Math.min(0xFFFF, Math.floor(z * 0xFFFF)));
                        zp = (zAddr + (y * w + x) * 2) & 0x7FFFFF;
                        const currentZ = (r8[zp] << 8) | r8[zp + 1];
                        if (zFixed > currentZ) continue;
                    }
                    // Shade kept as scalars (Task #39) — objects are built only on
                    // the paths that need them (generic combiner / blender).
                    const shR = v1.r * ws + v2.r * wt + v3.r * wu;
                    const shG = v1.g * ws + v2.g * wt + v3.g * wu;
                    const shB = v1.b * ws + v2.b * wt + v3.b * wu;
                    const shA = v1.a * ws + v2.a * wt + v3.a * wu;
                    const invW = invW1 * ws + invW2 * wt + invW3 * wu;
                    let s, t;
                    if (Math.abs(invW) > 1e-8) {
                        const sOverW = sw1 * ws + sw2 * wt + sw3 * wu;
                        const tOverW = tw1 * ws + tw2 * wt + tw3 * wu;
                        s = (sOverW / invW) * scaleS;
                        t = (tOverW / invW) * scaleT;
                    } else {
                        s = (v1.s * ws + v2.s * wt + v3.s * wu) * scaleS;
                        t = (v1.t * ws + v2.t * wt + v3.t * wu) * scaleT;
                    }
                    const tex = useTex
                        ? this.sampleTexture(s, t, curTile)
                        : { r: 255, g: 255, b: 255, a: 255 };
                    let cR, cG, cB, cA;
                    if (combineActive) {
                        if (this._cFastTexShade) {
                            // Same math as combineColor's verified fast path,
                            // without the call or the shade/color objects.
                            cR = clamp255((tex.r * shR) / 255);
                            cG = clamp255((tex.g * shG) / 255);
                            cB = clamp255((tex.b * shB) / 255);
                            cA = clamp255(shA);
                        } else {
                            const color = this.combineColor({ r: shR, g: shG, b: shB, a: shA }, tex);
                            cR = color.r; cG = color.g; cB = color.b; cA = color.a;
                        }
                    } else if (useTex) {
                        cR = clamp255((shR * tex.r) / 255);
                        cG = clamp255((shG * tex.g) / 255);
                        cB = clamp255((shB * tex.b) / 255);
                        cA = clamp255((shA * tex.a) / 255);
                    } else {
                        cR = clamp255(shR);
                        cG = clamp255(shG);
                        cB = clamp255(shB);
                        cA = clamp255(shA);
                    }
                    if (cA < 1 && alphaCmp) continue;
                    if (depthEnabled) { r8[zp] = (zFixed >>> 8) & 0xFF; r8[zp + 1] = zFixed & 0xFF; }
                    const p = (addr + (y * w + x) * pxBytes) & 0x7FFFFF;
                    if (blActive) {
                        const color = this.blendPixel({ r: cR, g: cG, b: cB, a: cA }, this.readMemColor(rd, p, cSz), useTex ? tex.a : undefined);
                        cR = color.r; cG = color.g; cB = color.b; cA = color.a;
                    }
                    if (cSz === 2) {
                        const _pv = (((cR >> 3) & 0x1F) << 11) | (((cG >> 3) & 0x1F) << 6) | (((cB >> 3) & 0x1F) << 1) | (cA > 127 ? 1 : 0);
                        r8[p] = (_pv >>> 8) & 0xFF; r8[p + 1] = _pv & 0xFF;
                    } else {
                        rd.setUint32(p, (cR << 24) | (cG << 16) | (cB << 8) | cA, false);
                    }
                    this.drawStats.rowWrites[y]++;
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

    // Resolve a texel coordinate through the tile's addressing mode.
    // cm bit1 = clamp (hold edge texel using the SETTILESIZE extent),
    // cm bit0 = mirror (reflect within 2*wrap), otherwise wrap by mask.
    applyTexAddr(coord, mask, cm, sizeTexels) {
        const clamp = (cm & 2) !== 0;
        if (clamp) {
            const hi = sizeTexels > 0 ? sizeTexels - 1 : (mask ? (1 << mask) - 1 : 1023);
            return coord < 0 ? 0 : (coord > hi ? hi : coord);
        }
        if (mask > 0) {
            const wrap = 1 << mask;
            if (cm & 1) { // mirror
                const period = 2 * wrap;
                let m = ((coord % period) + period) % period;
                return m < wrap ? m : (period - 1 - m);
            }
            return ((coord % wrap) + wrap) % wrap;
        }
        // No mask: clamp to tile extent if known (matches hardware), else legacy wrap.
        if (sizeTexels > 0) {
            const hi = sizeTexels - 1;
            return coord < 0 ? 0 : (coord > hi ? hi : coord);
        }
        return ((coord % 1024) + 1024) % 1024;
    }

    sampleTexture(s, t, tileIdx, force = false) {
        if ((!this.rspState.useTexture && !force) || !this.rspState.textureImage) return { r: 255, g: 255, b: 255, a: 255 };
        this.textureSampleStats.calls++;
        if ((tileIdx | 0) >= 0 && (tileIdx | 0) < 8) this.textureSampleStats.tileCalls[tileIdx | 0]++;
        this.textureSampleStats.maxAbsS = Math.max(this.textureSampleStats.maxAbsS, Math.abs(s));
        this.textureSampleStats.maxAbsT = Math.max(this.textureSampleStats.maxAbsT, Math.abs(t));
        const tile = this.rspState.tiles[tileIdx];
        let ts = Math.floor(s / 32), tt = Math.floor(t / 32);

        const applyShiftMask = (val, shift) => {
            if (shift > 0 && shift <= 10) val >>= shift;
            else if (shift > 10) val <<= (16 - shift);
            // NOTE: do NOT mask here — masking before applyTexAddr strips the
            // mirror bit, silently degrading MIRROR addressing to WRAP (this
            // mirrored every menu font glyph, Task #37). applyTexAddr owns
            // mask/mirror/clamp resolution.
            return val;
        };

        ts = applyShiftMask(ts, tile.shiftS);
        tt = applyShiftMask(tt, tile.shiftT);

        // Apply the tile's S/T addressing mode. Clamp (cm bit1) holds the edge
        // texel for coords outside the tile; mirror (cm bit0) reflects; default
        // wraps by the mask size. Tile size comes from SETTILESIZE (10.2 fixed).
        const sizeTexelsS = tile.lrs > tile.uls ? (((tile.lrs - tile.uls) >> 2) + 1) : 0;
        const sizeTexelsT = tile.lrt > tile.ult ? (((tile.lrt - tile.ult) >> 2) + 1) : 0;
        ts = this.applyTexAddr(ts, tile.maskS, tile.cmS, sizeTexelsS);
        tt = this.applyTexAddr(tt, tile.maskT, tile.cmT, sizeTexelsT);

        if (tile.format === 0 && tile.size === 2) { // RGBA 16-bit
            const wordGroup = ts >> 2;
            const texelInWord = ts & 0x3;
            let wordIndex = tile.tmem + tt * tile.line + wordGroup;
            // NOTE: handleG_LOADBLOCK copies texels into TMEM in flat row-major
            // order (it does NOT replicate the hardware odd-line word-interleave),
            // so the sampler must NOT re-apply the odd-line ^1 swizzle here — doing
            // so corrupted every odd row of LoadBlock RGBA16 textures (Task #17).

            const p = wordIndex * 8 + texelInWord * 2;
            if (p + 1 >= 4096) {
                this.textureSampleStats.oob++;
                return { r: 255, g: 255, b: 255, a: 255 };
            }
            const v = (this.tmem[p] << 8) | this.tmem[p + 1];
            return { r: ((v >> 11) & 0x1F) << 3, g: ((v >> 6) & 0x1F) << 3, b: ((v >> 1) & 0x1F) << 3, a: (v & 1) ? 255 : 0 };
        } else if (tile.format === 0 && tile.size === 3) { // RGBA 32-bit
            // LoadBlock/LoadTile copy RGBA32 flat into TMEM (no hardware hi/lo
            // bank split), so a flat 4-byte read is the consistent addressing
            // (same reasoning as the Task #34 LOADTLUT flat-pack note).
            const p = (tile.tmem * 8 + tt * tile.line * 8 + ts * 4);
            if (p + 3 >= 4096) {
                this.textureSampleStats.oob++;
                return { r: 255, g: 255, b: 255, a: 255 };
            }
            return { r: this.tmem[p], g: this.tmem[p + 1], b: this.tmem[p + 2], a: this.tmem[p + 3] };
        } else if (tile.format === 2) { // CI
            const p = (tile.tmem * 8 + tt * tile.line * 8 + (tile.size === 1 ? ts : ts >> 1));
            if (p >= 4096) {
                this.textureSampleStats.oob++;
                return { r: 255, g: 255, b: 255, a: 255 };
            }
            const idx = (tile.size === 1) ? this.tmem[p] : (ts & 1 ? this.tmem[p] & 0xF : this.tmem[p] >> 4);
            const palOff = 2048 + (tile.palette * 16 + idx) * 2;
            const v = (this.tmem[palOff] << 8) | this.tmem[palOff + 1];
            return { r: ((v >> 11) & 0x1F) << 3, g: ((v >> 6) & 0x1F) << 3, b: ((v >> 1) & 0x1F) << 3, a: (v & 1) ? 255 : 0 };
        } else if (tile.format === 3 && tile.size === 2) { // IA 16-bit
            const p = (tile.tmem * 8 + tt * tile.line * 8 + ts * 2);
            if (p + 1 >= 4096) {
                this.textureSampleStats.oob++;
                return { r: 255, g: 255, b: 255, a: 255 };
            }
            const i = this.tmem[p];
            return { r: i, g: i, b: i, a: this.tmem[p + 1] };
        } else if (tile.format === 3 && tile.size === 0) { // IA 4-bit
            const p = (tile.tmem * 8 + tt * tile.line * 8 + (ts >> 1));
            if (p >= 4096) {
                this.textureSampleStats.oob++;
                return { r: 255, g: 255, b: 255, a: 255 };
            }
            const v = (ts & 1) ? (this.tmem[p] & 0xF) : (this.tmem[p] >> 4);
            const i3 = (v >> 1) & 0x7;
            const i = (i3 << 5) | (i3 << 2) | (i3 >> 1); // 3-bit -> 8-bit replicate
            return { r: i, g: i, b: i, a: (v & 1) ? 255 : 0 };
        } else if (tile.format === 3 && tile.size === 1) { // IA 8-bit
            const p = (tile.tmem * 8 + tt * tile.line * 8 + ts);
            if (p >= 4096) {
                this.textureSampleStats.oob++;
                return { r: 255, g: 255, b: 255, a: 255 };
            }
            const v = this.tmem[p];
            const i = (v >> 4) << 4;
            return { r: i, g: i, b: i, a: (v & 0xF) << 4 };
        } else if (tile.format === 4) { // I
            const p = (tile.tmem * 8 + tt * tile.line * 8 + (tile.size === 1 ? ts : ts >> 1));
            if (p >= 4096) {
                this.textureSampleStats.oob++;
                return { r: 255, g: 255, b: 255, a: 255 };
            }
            const v = (tile.size === 1) ? this.tmem[p] : (ts & 1 ? (this.tmem[p] & 0xF) << 4 : this.tmem[p] & 0xF0);
            return { r: v, g: v, b: v, a: 255 };
        }
        this.textureSampleStats.oob++;
        return { r: 255, g: 255, b: 255, a: 255 };
    }

    // Evaluate the N64 RDP cycle-1 color combiner: Out = (A - B) * C + D.
    // SETCOMBINE bit layout (cycle 1):
    //   hi: colorA[23..20]  colorC[19..15]  alphaA[14..12]  alphaC[11..9]
    //   lo: colorB[31..28]                  alphaB[14..12]  alphaD[11..9]
    //                                       colorD[17..15]
    // We support the SM64-relevant sources: TEXEL0, SHADE, PRIMITIVE, ENV, 1, 0.
    // Decode the combiner mux + prim/env colors into instance fields once per
    // triangle/texrect (Task #33). combineColor reads these instead of re-decoding
    // every pixel. Byte-identical: same values, just computed once.
    _setupCombine() {
        const rs = this.rspState;
        const hi = rs.combine.hi, lo = rs.combine.lo;
        const prim = rs.primColor >>> 0, env = rs.envColor >>> 0;
        this._cpr=(prim>>>24)&0xFF; this._cpg=(prim>>>16)&0xFF; this._cpb=(prim>>>8)&0xFF; this._cpa=prim&0xFF;
        this._cer=(env>>>24)&0xFF; this._ceg=(env>>>16)&0xFF; this._ceb=(env>>>8)&0xFF; this._cea=env&0xFF;
        this._ccA=(hi>>>20)&0xF; this._ccB=(lo>>>28)&0xF; this._ccC=(hi>>>15)&0x1F; this._ccD=(lo>>>15)&0x7;
        this._caA=(hi>>>12)&0x7; this._caB=(lo>>>12)&0x7; this._caC=(hi>>>9)&0x7; this._caD=(lo>>>9)&0x7;
        this._cDegen = (this._ccA===0 && this._ccB===0 && this._ccC===0 && this._ccD===0 &&
                        this._caA===0 && this._caB===0 && this._caC===0 && this._caD===0);
        // Fast path for the combiner config that dominates SM64's goddard scene
        // (~91% of combine calls): rgb = (TEXEL0 - 0)*SHADE/255 + 0, a = SHADE.
        // c4z/asz hold true when a 4-bit/3-bit selector resolves to 0 (sel∉1..6).
        const c4z = (s) => !(s>=1 && s<=6), asz = c4z;
        // 2-cycle combiner (Task #35): cycle type = otherModeHi bits 20-21
        // (0=1CYC, 1=2CYC, 2=COPY, 3=FILL). In 2-cycle mode also decode the
        // second cycle's mux fields; combineColor feeds cycle 0's output back
        // in as the COMBINED source (sel 0 / COMBINED_ALPHA sel 7).
        this._c2 = ((rs.otherModeHi >>> 20) & 0x3) === 1;
        if (this._c2) {
            this._ccA1=(hi>>>5)&0xF;  this._ccB1=(lo>>>24)&0xF; this._ccC1=hi&0x1F;      this._ccD1=(lo>>>6)&0x7;
            this._caA1=(lo>>>21)&0x7; this._caB1=(lo>>>3)&0x7;  this._caC1=(lo>>>18)&0x7; this._caD1=lo&0x7;
        }
        this._cFastTexShade = !this._c2 &&
            (this._ccA===1 || this._ccA===2) && c4z(this._ccB) && this._ccC===4 && c4z(this._ccD) &&
            asz(this._caA) && asz(this._caB) && asz(this._caC) && this._caD===4;
    }

    combineColor(shade, tex) {
        // Verified byte-identical fast path (see _setupCombine): the general
        // formula ((A-B)*C)/255+D reduces exactly to tex*shade/255 (rgb) and
        // shade.a (a) for this config, with no per-pixel switch dispatch.
        if (this._cFastTexShade) {
            return {
                r: clamp255((tex.r * shade.r) / 255),
                g: clamp255((tex.g * shade.g) / 255),
                b: clamp255((tex.b * shade.b) / 255),
                a: clamp255(shade.a)
            };
        }
        const pr=this._cpr, pg=this._cpg, pb=this._cpb, pa=this._cpa;
        const er=this._cer, eg=this._ceg, eb=this._ceb, ea=this._cea;
        const cA=this._ccA, cB=this._ccB, cC=this._ccC, cD=this._ccD;
        const aA=this._caA, aB=this._caB, aC=this._caC, aD=this._caD;

        // Degenerate / no-op combiner → shade*tex modulate (same as before).
        if (this._cDegen && !this._c2) {
            return {
                r: clamp255((shade.r * tex.r) / 255),
                g: clamp255((shade.g * tex.g) / 255),
                b: clamp255((shade.b * tex.b) / 255),
                a: clamp255((shade.a * tex.a) / 255)
            };
        }

        // Per-channel: ((A - B) * C) / 255 + D, identical to the prior closures
        // but with the source pickers hoisted into plain (non-allocating) methods.
        const r = clamp255(((this._cs4(cA, tex.r, pr, shade.r, er) - this._cs4(cB, tex.r, pr, shade.r, er)) * this._cs5(cC, tex.r, pr, shade.r, er, tex.a, pa, shade.a, ea)) / 255 + this._cs4(cD, tex.r, pr, shade.r, er));
        const g = clamp255(((this._cs4(cA, tex.g, pg, shade.g, eg) - this._cs4(cB, tex.g, pg, shade.g, eg)) * this._cs5(cC, tex.g, pg, shade.g, eg, tex.a, pa, shade.a, ea)) / 255 + this._cs4(cD, tex.g, pg, shade.g, eg));
        const b = clamp255(((this._cs4(cA, tex.b, pb, shade.b, eb) - this._cs4(cB, tex.b, pb, shade.b, eb)) * this._cs5(cC, tex.b, pb, shade.b, eb, tex.a, pa, shade.a, ea)) / 255 + this._cs4(cD, tex.b, pb, shade.b, eb));
        const a = clamp255(((this._as(aA, tex.a, pa, shade.a, ea) - this._as(aB, tex.a, pa, shade.a, ea)) * this._as(aC, tex.a, pa, shade.a, ea)) / 255 + this._as(aD, tex.a, pa, shade.a, ea));
        if (!this._c2) return { r, g, b, a };
        // Second combiner cycle (Task #35): same (A-B)*C/255+D, but the COMBINED
        // source (color sel 0, color-C sel 7 = COMBINED_ALPHA, alpha sel 0) now
        // resolves to the cycle-0 result computed above.
        const cA1=this._ccA1, cB1=this._ccB1, cC1=this._ccC1, cD1=this._ccD1;
        const aA1=this._caA1, aB1=this._caB1, aC1=this._caC1, aD1=this._caD1;
        const r1 = clamp255(((this._cs4c(cA1, tex.r, pr, shade.r, er, r) - this._cs4c(cB1, tex.r, pr, shade.r, er, r)) * this._cs5c(cC1, tex.r, pr, shade.r, er, tex.a, pa, shade.a, ea, r, a)) / 255 + this._cs4c(cD1, tex.r, pr, shade.r, er, r));
        const g1 = clamp255(((this._cs4c(cA1, tex.g, pg, shade.g, eg, g) - this._cs4c(cB1, tex.g, pg, shade.g, eg, g)) * this._cs5c(cC1, tex.g, pg, shade.g, eg, tex.a, pa, shade.a, ea, g, a)) / 255 + this._cs4c(cD1, tex.g, pg, shade.g, eg, g));
        const b1 = clamp255(((this._cs4c(cA1, tex.b, pb, shade.b, eb, b) - this._cs4c(cB1, tex.b, pb, shade.b, eb, b)) * this._cs5c(cC1, tex.b, pb, shade.b, eb, tex.a, pa, shade.a, ea, b, a)) / 255 + this._cs4c(cD1, tex.b, pb, shade.b, eb, b));
        const a1 = clamp255(((this._asc(aA1, tex.a, pa, shade.a, ea, a) - this._asc(aB1, tex.a, pa, shade.a, ea, a)) * this._asc(aC1, tex.a, pa, shade.a, ea, a)) / 255 + this._asc(aD1, tex.a, pa, shade.a, ea, a));
        return { r: r1, g: g1, b: b1, a: a1 };
    }

    // Cycle-1 source pickers: identical to _cs4/_cs5/_as except sel 0 resolves
    // to COMBINED (the cycle-0 output) and color-C sel 7 to COMBINED_ALPHA.
    _cs4c(sel, t, p, s, e, comb) { return (sel & 0xF) === 0 ? comb : this._cs4(sel, t, p, s, e); }
    _cs5c(sel, t, p, s, e, ta, pa, sa, ea, comb, combA) {
        const m = sel & 0x1F;
        if (m === 0) return comb;
        if (m === 7) return combA;
        return this._cs5(sel, t, p, s, e, ta, pa, sa, ea);
    }
    _asc(sel, t, p, s, e, comb) { return (sel & 0x7) === 0 ? comb : this._as(sel, t, p, s, e); }

    // Combiner source pickers (hoisted out of the old per-pixel closures). Plain
    // methods → zero per-pixel allocation; the case mapping is identical.
    _cs4(sel, t, p, s, e) { // color A/B/D (4-bit)
        switch (sel & 0xF) {
            case 1: case 2: return t;   // TEXEL0 / TEXEL1
            case 3: return p;           // PRIM
            case 4: return s;           // SHADE
            case 5: return e;           // ENV
            case 6: return 255;         // 1
            default: return 0;          // 0 COMBINED, 7 NOISE → 0
        }
    }
    _cs5(sel, t, p, s, e, ta, pa, sa, ea) { // color C (5-bit, incl _ALPHA scalars)
        switch (sel & 0x1F) {
            case 1: case 2: return t;
            case 3: return p;
            case 4: return s;
            case 5: return e;
            case 6: return 255;
            case 8: case 9: return ta;  // TEXEL0/1_ALPHA
            case 10: return pa;         // PRIM_ALPHA
            case 11: return sa;         // SHADE_ALPHA
            case 12: return ea;         // ENV_ALPHA
            case 13: case 14: return 255; // LOD / PRIM_LOD_FRAC
            default: return 0;          // 0 COMBINED, 7 COMBINED_ALPHA → 0
        }
    }
    _as(sel, t, p, s, e) { // alpha A/B/C/D (3-bit)
        switch (sel & 0x7) {
            case 1: case 2: return t;
            case 3: return p;
            case 4: return s;
            case 5: return e;
            case 6: return 255;
            default: return 0;          // 0 COMBINED, 7 → 0
        }
    }

    // Read the framebuffer pixel at byte offset p (already masked) and return RGBA 0..255.
    readMemColor(rd, p, cSz) {
        if (cSz === 2) {
            const v = rd.getUint16(p, false);
            return {
                r: ((v >> 11) & 0x1F) << 3,
                g: ((v >> 6) & 0x1F) << 3,
                b: ((v >> 1) & 0x1F) << 3,
                a: (v & 1) ? 255 : 0
            };
        }
        const v = rd.getUint32(p, false) >>> 0;
        return { r: (v >>> 24) & 0xFF, g: (v >>> 16) & 0xFF, b: (v >>> 8) & 0xFF, a: v & 0xFF };
    }

    // N64 1-cycle RDP blender: out = Pc*A + Mc*B, muxes decoded from otherModeLo
    // (cycle-1 field positions). `px` is the combiner pixel color, `mem` the
    // framebuffer color, `texAlpha` the sampled texel alpha (used as coverage
    // when ALPHA_CVG_SEL is set, which is how SM64 punches through 1-bit-alpha
    // textures and renders translucent surfaces).
    // Decode the blender mux + blend/fog colors into instance fields once per
    // triangle/texrect (Task #33). blendPixel reads these. Byte-identical.
    _setupBlend() {
        const rs = this.rspState;
        const lo = rs.otherModeLo >>> 0;
        this._bpSel = (lo >>> 30) & 0x3;
        this._baSel = (lo >>> 26) & 0x3;
        this._bmSel = (lo >>> 22) & 0x3;
        this._bbSel = (lo >>> 18) & 0x3;
        // 2-cycle blender (Task #35): decode the cycle-1 muxes; blendPixel runs
        // the cycle-0 blend then feeds its output into the cycle-1 blend.
        this._bl2 = ((rs.otherModeHi >>> 20) & 0x3) === 1;
        if (this._bl2) {
            this._bpSel1 = (lo >>> 28) & 0x3;
            this._baSel1 = (lo >>> 24) & 0x3;
            this._bmSel1 = (lo >>> 20) & 0x3;
            this._bbSel1 = (lo >>> 16) & 0x3;
        }
        this._bCvg = (lo & 0x2000) !== 0;
        const blend = rs.blendColor >>> 0, fog = rs.fogColor >>> 0;
        this._bbr=(blend>>>24)&0xFF; this._bbg=(blend>>>16)&0xFF; this._bbb=(blend>>>8)&0xFF;
        this._bfr=(fog>>>24)&0xFF; this._bfg=(fog>>>16)&0xFF; this._bfb=(fog>>>8)&0xFF; this._bfa=fog&0xFF;
    }

    blendPixel(px, mem, texAlpha) {
        const pSel = this._bpSel;
        const aSel = this._baSel;
        const mSel = this._bmSel;
        const bSel = this._bbSel;
        const alphaCvgSel = this._bCvg;
        const br=this._bbr, bg=this._bbg, bb=this._bbb;
        const fr=this._bfr, fg=this._bfg, fb=this._bfb, fa=this._bfa;

        let pAlpha = px.a / 255;
        if (alphaCvgSel && texAlpha !== undefined && texAlpha !== null) pAlpha = texAlpha / 255;

        let A;
        switch (aSel) {
            case 0: A = pAlpha; break;     // combiner / coverage alpha
            case 1: A = fa / 255; break;   // fog alpha
            case 2: A = px.a / 255; break; // shade alpha (approx)
            default: A = 0; break;
        }
        let B;
        switch (bSel) {
            case 0: B = 1 - A; break;
            case 1: B = mem.a / 255; break;
            case 2: B = 1; break;
            default: B = 0; break;
        }
        if (alphaCvgSel) B = 1 - A;

        const Pr=this._blSel(pSel,px.r,mem.r,br,fr), Pg=this._blSel(pSel,px.g,mem.g,bg,fg), Pb=this._blSel(pSel,px.b,mem.b,bb,fb);
        const Mr=this._blSel(mSel,px.r,mem.r,br,fr), Mg=this._blSel(mSel,px.g,mem.g,bg,fg), Mb=this._blSel(mSel,px.b,mem.b,bb,fb);
        const out = {
            r: clamp255(Pr * A + Mr * B),
            g: clamp255(Pg * A + Mg * B),
            b: clamp255(Pb * A + Mb * B),
            a: px.a
        };
        if (!this._bl2) return out;
        // Second blender cycle (Task #35): same mux arithmetic with the cycle-1
        // selects; the pixel input is the cycle-0 blend result. This is what
        // makes SM64's 2-cycle fog modes (G_RM_FOG_SHADE_A + *_SURF2) work:
        // cycle 0 fogs the combiner color, cycle 1 composites with memory.
        const pSel1 = this._bpSel1, aSel1 = this._baSel1, mSel1 = this._bmSel1, bSel1 = this._bbSel1;
        let A1;
        switch (aSel1) {
            case 0: A1 = alphaCvgSel && texAlpha !== undefined && texAlpha !== null ? texAlpha / 255 : out.a / 255; break;
            case 1: A1 = fa / 255; break;
            case 2: A1 = out.a / 255; break;
            default: A1 = 0; break;
        }
        let B1;
        switch (bSel1) {
            case 0: B1 = 1 - A1; break;
            case 1: B1 = mem.a / 255; break;
            case 2: B1 = 1; break;
            default: B1 = 0; break;
        }
        if (alphaCvgSel) B1 = 1 - A1;
        const Pr1=this._blSel(pSel1,out.r,mem.r,br,fr), Pg1=this._blSel(pSel1,out.g,mem.g,bg,fg), Pb1=this._blSel(pSel1,out.b,mem.b,bb,fb);
        const Mr1=this._blSel(mSel1,out.r,mem.r,br,fr), Mg1=this._blSel(mSel1,out.g,mem.g,bg,fg), Mb1=this._blSel(mSel1,out.b,mem.b,bb,fb);
        return {
            r: clamp255(Pr1 * A1 + Mr1 * B1),
            g: clamp255(Pg1 * A1 + Mg1 * B1),
            b: clamp255(Pb1 * A1 + Mb1 * B1),
            a: out.a
        };
    }
    _blSel(sel, pxc, memc, bc, fc) {
        switch (sel) {
            case 0: return pxc;   // pixel (combiner)
            case 1: return memc;  // framebuffer
            case 2: return bc;    // blendColor
            case 3: return fc;    // fogColor
        }
        return pxc;
    }

    // G_SETOTHERMODE_H/L set only a bit-range (shift/len encoded in w0); the old
    // code stored w1 wholesale, clobbering every other mode field - which is why
    // the cycle-type bits (and any accumulated render-mode state) never survived
    // to the rasterizer. Masked read-modify-write per spec (Task #35).
    // F3DEX2: len=(w0&0xFF)+1, shift=32-((w0>>>8)&0xFF)-len.
    // F3D:    shift=(w0>>>8)&0xFF, len=w0&0xFF.
    _otherModeRMW(cur, hi, lo, isEx2) {
        let shift, len;
        if (isEx2) { len = (hi & 0xFF) + 1; shift = 32 - ((hi >>> 8) & 0xFF) - len; }
        else { shift = (hi >>> 8) & 0xFF; len = hi & 0xFF; }
        if (len <= 0 || len >= 32 || shift < 0 || shift > 31) return lo >>> 0; // full/invalid -> set all
        const mask = (((1 << len) - 1) << shift) >>> 0;
        return ((((cur >>> 0) & ~mask) >>> 0) | ((lo >>> 0) & mask)) >>> 0;
    }

    // True when otherModeLo asks the blender to read the framebuffer (IM_RD) and
    // memory actually participates in the blend mux. Pixels in non-reading modes
    // are written straight through (the previous behavior, keeps the title fast).
    blenderActive() {
        const lo = this.rspState.otherModeLo >>> 0;
        // 2-cycle mode (Task #35): cycle 0 may be a fog/blend-color blend that
        // needs no FB read (e.g. G_RM_FOG_SHADE_A), so activate whenever either
        // cycle's mux picks a non-pixel color source or uses memory alpha.
        if (((this.rspState.otherModeHi >>> 20) & 0x3) === 1) {
            const p0 = (lo >>> 30) & 0x3, m0 = (lo >>> 22) & 0x3, b0 = (lo >>> 18) & 0x3;
            const p1 = (lo >>> 28) & 0x3, m1 = (lo >>> 20) & 0x3, b1 = (lo >>> 16) & 0x3;
            return p0 !== 0 || m0 !== 0 || p1 !== 0 || m1 !== 0 || b0 === 1 || b1 === 1;
        }
        if ((lo & 0x40) === 0) return false;        // IM_RD off → no FB read
        const pSel = (lo >>> 30) & 0x3;
        const mSel = (lo >>> 22) & 0x3;
        const bSel = (lo >>> 18) & 0x3;
        // memory participates if either color mux picks memory, or B uses mem alpha
        return pSel === 1 || mSel === 1 || bSel === 1;
    }

    updateUseTexture(hi, lo) {
        // Source-code classifiers per combiner field. Previously this lumped
        // COMBINED (0) in with TEXEL0 (1) which caused shaded-only triangles
        // to (incorrectly) consult the bound texture, leaking stale TMEM data
        // into otherwise solid surfaces.
        const isTex4   = (s) => s === 1 || s === 2;                 // color A/B/D
        const isTex5   = (s) => s === 1 || s === 2 || s === 8 || s === 9; // color C
        const isTexA   = (s) => s === 1 || s === 2;                 // alpha A/B/D and alpha C
        const colorA = (hi >> 20) & 0xF, colorB = (lo >> 28) & 0xF, colorC = (hi >> 15) & 0x1F, colorD = (lo >> 15) & 0x7;
        const alphaA = (hi >> 12) & 0x7, alphaB = (lo >> 12) & 0x7, alphaC = (hi >> 9) & 0x7, alphaD = (lo >> 9) & 0x7;
        this.rspState.combinerUsesTexture =
            isTex4(colorA) || isTex4(colorB) || isTex5(colorC) || isTex4(colorD) ||
            isTexA(alphaA) || isTexA(alphaB) || isTexA(alphaC) || isTexA(alphaD);
        this.recomputeUseTexture();
    }

    recomputeUseTexture() {
        this.rspState.useTexture =
            this.rspState.textureEnabled &&
            this.rspState.combinerUsesTexture &&
            this.rspState.textureImage !== 0;
    }

    handleG_SETTILE(hi, lo) {
        const t = (lo >> 24) & 0x7;
        if (t < 8) {
            this.rspState.tiles[t].format = (hi >> 21) & 0x7;
            this.rspState.tiles[t].size = (hi >> 19) & 0x3;
            this.rspState.tiles[t].line = (hi >> 9) & 0x1FF;
            this.rspState.tiles[t].tmem = hi & 0x1FF;
            this.rspState.tiles[t].palette = (lo >> 20) & 0xF;
            this.rspState.tiles[t].maskT = (lo >> 14) & 0xF;
            this.rspState.tiles[t].shiftT = (lo >> 10) & 0xF;
            this.rspState.tiles[t].maskS = (lo >> 4) & 0xF;
            this.rspState.tiles[t].shiftS = lo & 0xF;
            // Clamp/mirror mode bits: cmS (bits 8-9), cmT (bits 18-19).
            // bit0 = mirror, bit1 = clamp. SM64 HUD/text/face tiles rely on
            // clamp; without it edge texels wrap into empty TMEM -> garbage.
            this.rspState.tiles[t].cmS = (lo >> 8) & 0x3;
            this.rspState.tiles[t].cmT = (lo >> 18) & 0x3;
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
        if (t >= 8) return;
        const tile = this.rspState.tiles[t];
        // G_LOADBLOCK field semantics (Task #36): unlike LOADTILE, uls/ult/lrs
        // here are NOT 10.2 fixed-point. lrs is the count-1 of load units, where
        // a unit is one 16-bit slice for 4b/8b/16b textures and one 32-bit texel
        // for 32b (gsDPLoadTextureBlock: lrs = ((w*h + INCR) >> SHIFT) - 1, so
        // bytes = (lrs+1)*2, or *4 for 32b). The old /4 decode loaded only 25%
        // of every block-loaded texture (TMEM rows past 1/4 stayed zero/black).
        const uls = (hi >>> 12) & 0xFFF;
        const ult = hi & 0xFFF;
        const lrs = (lo >>> 12) & 0xFFF;
        const unitBytes = (this.rspState.textureImageSize === 3) ? 4 : 2;
        const units = Math.max(0, lrs - uls + 1);
        const imgWidth = Math.max(1, this.rspState.textureImageWidth | 0);
        const srcBase = (this.rspState.textureImage + ((ult * imgWidth + uls) * unitBytes)) & 0x7FFFFF;
        const off = tile.tmem * 8;
        const totalBytes = units * unitBytes;
        // Bulk copy fast path (Task #39): srcBase is a masked physical RDRAM
        // offset and TMEM is a flat Uint8Array, so a subarray set() is
        // byte-identical to the per-byte mmu.read8 loop whenever the source
        // range stays inside RDRAM (read8 would wrap at 0x800000 — rare;
        // fall back for that). This was 16.8% of total JS time in-game.
        const copyLen = Math.min(totalBytes, 4096 - off);
        if (copyLen > 0 && srcBase + copyLen <= 0x800000) {
            let r8 = this._rdram8;
            if (!r8 || r8.buffer !== this.mmu.memory.rdram) {
                r8 = this._rdram8 = new Uint8Array(this.mmu.memory.rdram);
            }
            this.tmem.set(r8.subarray(srcBase, srcBase + copyLen), off);
        } else {
            for (let i = 0; i < totalBytes && (off + i < 4096); i++) {
                this.tmem[off + i] = this.mmu.read8(srcBase + i);
            }
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

    handleG_LOADTLUT(hi, lo) {
        // G_LOADTLUT (0xF0): load 16-bit palette entries from the current
        // texture image (SETTIMG) into the TLUT half of TMEM. Hardware stores
        // entry i 4x-replicated at word (tile.tmem + i); our CI sampler reads a
        // FLAT layout (2 bytes/entry from byte 2048, CI4 palettes 16 entries =
        // 32 bytes apart: palOff = 2048 + (palette*16 + idx)*2). So flat-pack:
        // entry i -> byte 2048 + ((tile.tmem - 256) + i) * 2, which makes both
        // the full-256 CI8 TLUT (tmem=256) and per-palette CI4 loads
        // (tmem=256+pal*16) land exactly where the sampler looks. RGBA16 TLUT
        // assumed (SM64 uses G_TT_RGBA16; IA16 TLUTs would need otherModeHi
        // bit 15..14 == 3 handling in the sampler).
        const t = (lo >> 24) & 0x7;
        if (t >= 8) return;
        const tile = this.rspState.tiles[t];
        const uls = (hi >>> 12) & 0xFFF;          // 10.2 fixed
        const lrs = (lo >>> 12) & 0xFFF;
        const first = uls >> 2, last = lrs >> 2;
        const count = Math.max(0, Math.min(256, last - first + 1));
        if (!this.rspState.textureImage || count === 0) return;
        const srcBase = (this.rspState.textureImage + first * 2) & 0x7FFFFF;
        const entryBase = (tile.tmem >= 256 ? tile.tmem - 256 : tile.tmem) & 0x1FF;
        for (let i = 0; i < count; i++) {
            const d = 2048 + (entryBase + i) * 2;
            if (d + 1 >= 4096) break;
            this.tmem[d] = this.mmu.read8(srcBase + i * 2);
            this.tmem[d + 1] = this.mmu.read8(srcBase + i * 2 + 1);
        }
    }

    handleG_TEXRECT(hi, lo, addr, flip, isRdpFifo = false) {
        // G_TEXRECT / G_TEXRECTFLIP: textured 2D screen-space rectangle.
        //
        // This function is called from two different paths with different memory layouts:
        //
        // (A) RSP Display-List path (isRdpFifo=false, the default):
        //   Word 0 at addr (hi/lo already passed in):
        //     hi = (0xE4<<24) | (xh<<12) | yh
        //     lo = (tile<<24) | (xl<<12) | yl
        //   Word 1 at addr+8  = G_RDPHALF_1 RSP command:
        //     hi_w1 = 0xB4000000   ← opcode byte, NOT texture data!
        //     lo_w1 = (s0<<16) | t0
        //   Word 2 at addr+16 = G_RDPHALF_2 RSP command:
        //     hi_w2 = 0xB3000000   ← opcode byte
        //     lo_w2 = (dsdx<<16) | dtdy
        //   → read s0/t0 from addr+12, dsdx/dtdy from addr+20
        //
        // (B) RDP FIFO path (isRdpFifo=true):
        //   Word 0 at addr: same hi/lo as above
        //   Word 1 at addr+8: pure RDP data, NO opcode prefix:
        //     bytes 8-11  = (s0<<16)   | t0
        //     bytes 12-15 = (dsdx<<16) | dtdy
        //   → read s0/t0 from addr+8, dsdx/dtdy from addr+12
        //
        // Coordinates: 10.2 fixed point → divide by 4 for pixel coords.
        // s/t: 10.5 fixed point → sampleTexture() divides by 32 internally.

        // Word 0 coords (10.2 fixed-pt)
        const xh = (hi >> 12) & 0xFFF;   // right  edge (inclusive)
        const yh =  hi        & 0xFFF;   // bottom edge (inclusive)
        const tile = (lo >> 24) & 0x7;
        const xl = (lo >> 12) & 0xFFF;   // left edge
        const yl =  lo        & 0xFFF;   // top  edge

        // Signed 16-bit texture coordinates and per-pixel steps.
        // Offsets differ depending on whether the caller is the RSP DL or RDP FIFO path.
        let s0, t0, dsdx, dtdy;
        if (isRdpFifo) {
            // RDP FIFO: word 1 has no opcode prefix, data starts at addr+8.
            const w1hi = this.mmu.read32(Number(addr) + 8);
            const w1lo = this.mmu.read32(Number(addr) + 12);
            s0   =  w1hi >> 16;
            t0   = (w1hi << 16) >> 16;
            dsdx =  w1lo >> 16;
            dtdy = (w1lo << 16) >> 16;
        } else {
            // RSP DL (G_RDPHALF_1/2): opcode byte occupies the hi word of each RSP word.
            // Data (s/t) is in the lo word of G_RDPHALF_1 (addr+12).
            // dsdx/dtdy is in the lo word of G_RDPHALF_2 (addr+20).
            const w1lo = this.mmu.read32(Number(addr) + 12);
            const w2lo = this.mmu.read32(Number(addr) + 20);
            s0   =  w1lo >> 16;
            t0   = (w1lo << 16) >> 16;
            dsdx =  w2lo >> 16;
            dtdy = (w2lo << 16) >> 16;
        }

        // Pixel bounds (10.2 → pixels, inclusive → exclusive)
        const left   =  xl >> 2;
        const top    =  yl >> 2;
        const right  = (xh >> 2) + 1;    // +1: inclusive end → exclusive loop bound
        const bottom = (yh >> 2) + 1;

        const colorAddr  = this.rspState.colorImage;
        const cw         = this.rspState.colorImageWidth;
        const cSz        = this.rspState.colorImageSize;

        if (!colorAddr || left >= right || top >= bottom) return;
        if (right <= 0 || bottom <= 0 || left >= cw || top >= 240) return;


        this.drawStats.texRects++;
        this.recordVideoWrite('texrect');

        const rdv   = new DataView(this.mmu.memory.rdram);
        // Hardware texrects sample TMEM regardless of the RSP G_TEXTURE enable
        // (gSPTexture only scales triangle s/t) — menu font glyphs are drawn
        // with no gSPTexture at all (Task #37).
        const texrectTexOK = this.rspState.textureImage !== 0;
        // Use a constant white shade so the combiner still works for texrect
        // surfaces that mix env/prim color with the texture.
        const shade = { r: 255, g: 255, b: 255, a: 255 };
        // Hoist triangle-invariant combiner/blender mux decode (Task #33).
        const combineActive = !!(this.rspState.combine.hi || this.rspState.combine.lo);
        const blActive = this.blenderActive();
        if (combineActive) this._setupCombine();
        if (blActive) this._setupBlend();

        // dsdx/dtdy are 5.10 fixed-point texels-per-pixel; s0/t0 are 10.5.
        // Per-pixel advance in 10.5 units is therefore step/32. In COPY cycle
        // mode the RDP transfers 4 texels per clock, so gsSPTextureRectangle
        // encodes dsdx 4x larger (4<<10 for 1:1) — undo that here. The old code
        // added raw 5.10 steps to 10.5 coords (32-128x overstep), which pushed
        // every texrect off its tile into TMEM-OOB white (Task #36).
        const cycType36 = (this.rspState.otherModeHi >>> 20) & 3;
        const sStep = (cycType36 === 2) ? (dsdx / 4) : dsdx;
        // GL renderer tap (Task #40).
        if (this.glr) {
            this.glr.texRect(this, tile, left, top, right, bottom, s0, t0, sStep, dtdy, flip);
            return;
        }
        for (let y = Math.max(0, top); y < Math.min(bottom, 240); y++) {
            const dt = y - top;
            for (let x = Math.max(0, left); x < Math.min(right, cw); x++) {
                const ds = x - left;
                // Advance S/T in the correct axis (flip swaps S↔T advancement dirs)
                const s = flip ? (s0 + (sStep * dt) / 32) : (s0 + (sStep * ds) / 32);
                const t = flip ? (t0 + (dtdy * ds) / 32) : (t0 + (dtdy * dt) / 32);

                const tex = texrectTexOK
                    ? this.sampleTexture(s, t, tile, true)
                    : { r: 255, g: 255, b: 255, a: 255 };

                let color;
                if (cycType36 === 2) {
                    // COPY cycle mode bypasses the combiner and blender entirely:
                    // texels are copied raw (alpha-compare still gates writes).
                    // Running the combiner here was wrong — SM64's title texrects
                    // are COPY-mode with a (PRIM-SHADE)*TEX+SHADE mux left over,
                    // which our forced-white shade collapsed to solid white.
                    if ((this.rspState.otherModeLo & 1) && tex.a < 1) continue;
                    color = tex;
                } else if (combineActive) {
                    color = this.combineColor(shade, tex);
                } else {
                    color = tex;
                }
                if (color.a < 1 && !blActive) continue;

                const bpp = cSz === 3 ? 4 : 2;
                const p = (colorAddr + (y * cw + x) * bpp) & 0x7FFFFF;
                if (blActive && cycType36 !== 2) {
                    color = this.blendPixel(color, this.readMemColor(rdv, p, cSz), texrectTexOK ? tex.a : undefined);
                }
                if (cSz === 2) {
                    rdv.setUint16(p,
                        (((color.r >> 3) & 0x1F) << 11) |
                        (((color.g >> 3) & 0x1F) << 6)  |
                        (((color.b >> 3) & 0x1F) << 1)  |
                        (color.a > 127 ? 1 : 0), false);
                } else {
                    rdv.setUint32(p,
                        (color.r << 24) | (color.g << 16) | (color.b << 8) | color.a,
                        false);
                }
            }
        }
    }

    handleG_MOVEWORD(hi, lo) {
        // G_MOVEWORD format differs between Fast3D and F3DEX2:
        //
        //   Fast3D (opcode 0xBC):
        //     w0 = (0xBC<<24) | (offset<<8) | index
        //     index is in the LOW BYTE (bits 7:0)
        //     offset is in bits 23:8
        //
        //   F3DEX2 (opcode 0xDB):
        //     w0 = (0xDB<<24) | (index<<16) | offset
        //     index is in bits 23:16
        //     offset is in bits 15:0
        //
        // Verified from actual SM64 display list commands:
        //   0xBC000006 lo=0x0         => index=0x06(seg), offset=0 => seg[0]=0
        //   0xBC000406 lo=0x203100    => index=0x06(seg), offset=4 => seg[1]=0x2031
        //   0xBC000806 lo=0x64f80     => index=0x06(seg), offset=8 => seg[2]=0x64f8
        let index, offset;
        if (this.rspState.isF3DEX2) {
            index  = (hi >>> 16) & 0xFF;
            offset =  hi & 0xFFFF;
        } else {
            // Fast3D: index in low byte, offset in bits [23:8]
            index  =  hi & 0xFF;
            offset = (hi >>> 8) & 0xFFFF;
        }

        // G_MW_SEGMENT (index 6): gSPSegment(pkt, seg, base)
        //   offset = seg * 4,  value (lo) = base RDRAM address
        if (index === 0x06) {
            this.rspState.segments[(offset >>> 2) & 0xF] = lo >>> 0;
            return;
        }

        // G_MW_NUMLIGHT (index 0x02). Encoding is microcode-dependent:
        //   Fast3D:  value = (n-1) * 32   => n = (lo / 32) + 1
        //   F3DEX2:  value = n * 24       => n = lo / 24
        if (index === 0x02) {
            const raw = lo >>> 0;
            // Fast3D/F3DEX encode NUML(n) = ((n+1)*32) | 0x80000000 (the in-game
            // engine sends 0x80000040 for 1 directional light + ambient). The old
            // floor(raw/32)+1 decode read that as numLights=8, so lights[8] was
            // never set and EVERY lit vertex used the white fallback light --
            // Mario's body, Peach, and terrain all rendered gray/white (Task #38).
            let n = this.rspState.isF3DEX2
                ? Math.floor(raw / 24)
                : ((raw & 0x7FFFFFFF) >>> 5) - 1;
            if (n < 0) n = 0;
            if (n > 7) n = 7;
            this.rspState.numLights = n;
            return;
        }
    }
}
