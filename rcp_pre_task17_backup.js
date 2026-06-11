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
            vertices: new Array(64).fill(0).map(() => ({ x: 0, y: 0, z: 0, w: 1, r: 0, g: 0, b: 0, a: 0, s: 0, t: 0 })),
            modelviewStack: [this.createIdentityMatrix()],
            projectionMatrix: this.createIdentityMatrix(),
            tiles: new Array(8).fill(0).map(() => ({ format: 0, size: 0, line: 0, tmem: 0, palette: 0, uls: 0, ult: 0, lrs: 0, lrt: 0, maskS: 0, shiftS: 0, maskT: 0, shiftT: 0 })),
            combine: { hi: 0, lo: 0 },
            primColor: 0xFFFFFFFF, envColor: 0, fillColor: 0, colorImage: 0, colorImageWidth: 320, colorImageSize: 2,
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

    getDeterministicVideoTarget(viOrigin, viWidth, viType) {
        const width = viWidth | 0;
        const type = viType | 0;
        const origin = viOrigin & 0x7FFFFF;
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
            }
        } catch (e) {
            console.error("RSP Task Error:", e);
            this.currentTaskVideoTargets = null;
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
                case 0xE2:
                    this.rspState.otherModeLo = lo;
                    break;
                case 0xB9:
                    this.rspState.otherModeLo = lo;
                    break;
                case 0xE3:
                    this.rspState.otherModeHi = lo;
                    break;
                case 0xBA:
                    this.rspState.otherModeHi = lo;
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
                case 0xF0: // G_LOADTLUT stub
                    break;
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
                s: (this.mmu.read16(v + 8) << 16) >> 16, t: (this.mmu.read16(v + 10) << 16) >> 16
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
                return Object.assign({}, v, { x: p.sx, y: p.sy, z: p.sz, w: v.cw, _needsProject: false });
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
            cx: lerp(acx, bcx), cy: lerp(acy, bcy), cz: lerp(acz, bcz), cw: lerp(acw, bcw),
            x: 0, y: 0, z: 0, w: lerp(acw, bcw),
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
        const rd = new DataView(this.mmu.memory.rdram), w = this.rspState.colorImageWidth, zAddr = this.rspState.depthImage;
        const depthEnabled = !!zAddr && ((this.rspState.geometryMode & 0x00000001) !== 0);

        for (let y = minY; y <= maxY; y++) {
            if (y < 0 || y >= 240) continue;
            for (let x = minX; x <= maxX; x++) {
                if (x < 0 || x >= w) continue;
                const weights = this.getBarycentricWeights(x, y, x1, y1, x2, y2, x3, y3);
                if (weights) {
                    const z = v1.z * weights.s + v2.z * weights.t + v3.z * weights.u;
                    // Z compare: read current depth, reject if our Z is farther.
                    // The actual write is deferred until after color/alpha pass
                    // so an alpha-discarded pixel doesn't poison the depth buffer
                    // and block real surfaces behind it.
                    let zFixed = 0, zp = 0;
                    if (depthEnabled) {
                        // Scale sz ∈ [0,1] to the full 16-bit depth range.
                        // sz=0 → near (depth=0), sz=1 → far (depth=0xFFFF).
                        // SM64 clears the depth buffer to 0xFFFC, so near pixels
                        // (low zFixed) always pass on a fresh frame.
                        zFixed = Math.max(0, Math.min(0xFFFF, Math.floor(z * 0xFFFF)));
                        zp = (zAddr + (y * w + x) * 2) & 0x7FFFFF;
                        const currentZ = rd.getUint16(zp, false);
                        if (zFixed > currentZ) continue;
                    }
                    const shade = {
                        r: v1.r * weights.s + v2.r * weights.t + v3.r * weights.u,
                        g: v1.g * weights.s + v2.g * weights.t + v3.g * weights.u,
                        b: v1.b * weights.s + v2.b * weights.t + v3.b * weights.u,
                        a: v1.a * weights.s + v2.a * weights.t + v3.a * weights.u
                    };
                    // Use |w| for perspective-correct interpolation: libultra's
                    // row-vector projection can produce negative W for visible
                    // vertices, but the perspective-divide magnitudes are what
                    // matter for texture-coord and shade interpolation.
                    const aw1 = Math.abs(v1.w ?? 1); const invW1 = 1.0 / (aw1 > 1e-6 ? aw1 : 1.0);
                    const aw2 = Math.abs(v2.w ?? 1); const invW2 = 1.0 / (aw2 > 1e-6 ? aw2 : 1.0);
                    const aw3 = Math.abs(v3.w ?? 1); const invW3 = 1.0 / (aw3 > 1e-6 ? aw3 : 1.0);
                    const invW = invW1 * weights.s + invW2 * weights.t + invW3 * weights.u;
                    let s, t;
                    if (Math.abs(invW) > 1e-8) {
                        const sOverW = (v1.s * invW1) * weights.s + (v2.s * invW2) * weights.t + (v3.s * invW3) * weights.u;
                        const tOverW = (v1.t * invW1) * weights.s + (v2.t * invW2) * weights.t + (v3.t * invW3) * weights.u;
                        s = (sOverW / invW) * this.rspState.textureScaleS;
                        t = (tOverW / invW) * this.rspState.textureScaleT;
                    } else {
                        s = (v1.s * weights.s + v2.s * weights.t + v3.s * weights.u) * this.rspState.textureScaleS;
                        t = (v1.t * weights.s + v2.t * weights.t + v3.t * weights.u) * this.rspState.textureScaleT;
                    }
                    const tex = this.rspState.useTexture
                        ? this.sampleTexture(s, t, this.rspState.currentTile)
                        : { r: 255, g: 255, b: 255, a: 255 };
                    // Always evaluate the color combiner. SM64 sets SETCOMBINE
                    // even for untextured shaded surfaces; the right behavior
                    // for those is (SHADE * 1) which the combiner produces
                    // naturally when tex is white.
                    let color;
                    if (this.rspState.combine.hi || this.rspState.combine.lo) {
                        color = this.combineColor(shade, tex);
                    } else if (this.rspState.useTexture) {
                        color = {
                            r: clamp255((shade.r * tex.r) / 255),
                            g: clamp255((shade.g * tex.g) / 255),
                            b: clamp255((shade.b * tex.b) / 255),
                            a: clamp255((shade.a * tex.a) / 255)
                        };
                    } else {
                        color = {
                            r: clamp255(shade.r),
                            g: clamp255(shade.g),
                            b: clamp255(shade.b),
                            a: clamp255(shade.a)
                        };
                    }
                    if (color.a < 1 && (this.rspState.otherModeLo & 0x4000)) continue;
                    // Pixel passed alpha-compare — now safe to commit the depth write.
                    if (depthEnabled) rd.setUint16(zp, zFixed, false);
                    const p = (addr + (y * w + x) * (this.rspState.colorImageSize === 3 ? 4 : 2)) & 0x7FFFFF;
                    if (this.rspState.colorImageSize === 2) {
                        rd.setUint16(p, (((color.r >> 3) & 0x1F) << 11) | (((color.g >> 3) & 0x1F) << 6) | (((color.b >> 3) & 0x1F) << 1) | (color.a > 127 ? 1 : 0), false);
                    } else {
                        rd.setUint32(p, (color.r << 24) | (color.g << 16) | (color.b << 8) | color.a, false);
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

    sampleTexture(s, t, tileIdx) {
        if (!this.rspState.useTexture || !this.rspState.textureImage) return { r: 255, g: 255, b: 255, a: 255 };
        this.textureSampleStats.calls++;
        if ((tileIdx | 0) >= 0 && (tileIdx | 0) < 8) this.textureSampleStats.tileCalls[tileIdx | 0]++;
        this.textureSampleStats.maxAbsS = Math.max(this.textureSampleStats.maxAbsS, Math.abs(s));
        this.textureSampleStats.maxAbsT = Math.max(this.textureSampleStats.maxAbsT, Math.abs(t));
        const tile = this.rspState.tiles[tileIdx];
        let ts = Math.floor(s / 32), tt = Math.floor(t / 32);

        const applyShiftMask = (val, shift, mask) => {
            if (shift > 0 && shift <= 10) val >>= shift;
            else if (shift > 10) val <<= (16 - shift);
            if (mask > 0) val &= (1 << mask) - 1;
            return val;
        };

        ts = applyShiftMask(ts, tile.shiftS, tile.maskS);
        tt = applyShiftMask(tt, tile.shiftT, tile.maskT);

        const wrapS = tile.maskS ? (1 << tile.maskS) : 1024;
        const wrapT = tile.maskT ? (1 << tile.maskT) : 1024;
        ts = Math.abs(ts) % wrapS; tt = Math.abs(tt) % wrapT;

        if (tile.format === 0 && tile.size === 2) { // RGBA 16-bit
            const wordGroup = ts >> 2;
            const texelInWord = ts & 0x3;
            let wordIndex = tile.tmem + tt * tile.line + wordGroup;
            // LoadBlock-loaded 16b textures are word-swizzled on odd lines in TMEM.
            if ((tt & 1) !== 0) wordIndex ^= 1;
            const p = wordIndex * 8 + texelInWord * 2;
            if (p + 1 >= 4096) {
                this.textureSampleStats.oob++;
                return { r: 255, g: 255, b: 255, a: 255 };
            }
            const v = (this.tmem[p] << 8) | this.tmem[p + 1];
            return { r: ((v >> 11) & 0x1F) << 3, g: ((v >> 6) & 0x1F) << 3, b: ((v >> 1) & 0x1F) << 3, a: (v & 1) ? 255 : 0 };
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
    combineColor(shade, tex) {
        const hi = this.rspState.combine.hi;
        const lo = this.rspState.combine.lo;
        const prim = this.rspState.primColor >>> 0;
        const env  = this.rspState.envColor  >>> 0;
        const primRGBA = { r: (prim >>> 24) & 0xFF, g: (prim >>> 16) & 0xFF, b: (prim >>> 8) & 0xFF, a: prim & 0xFF };
        const envRGBA  = { r: (env  >>> 24) & 0xFF, g: (env  >>> 16) & 0xFF, b: (env  >>> 8) & 0xFF, a: env  & 0xFF };

        // Source pickers. Channel = 'r'|'g'|'b'|'a'.
        const colorSrc = (sel, channel) => {
            switch (sel & 0xF) {
                case 0: return 0;        // COMBINED (cycle 1 has no previous output → 0)
                case 1: return tex[channel];
                case 2: return tex[channel];   // TEXEL1: we don't 2-cycle yet, use TEXEL0
                case 3: return primRGBA[channel];
                case 4: return shade[channel];
                case 5: return envRGBA[channel];
                case 6: return 255;      // 1
                case 7: return 0;        // NOISE / 0
                default: return 0;
            }
        };
        // C source is 5 bits and includes "_ALPHA" variants that pick the alpha
        // of a source as a scalar multiplier broadcast to RGB.
        const colorCSrc = (sel, channel) => {
            switch (sel & 0x1F) {
                case 0: return 0;
                case 1: return tex[channel];
                case 2: return tex[channel];
                case 3: return primRGBA[channel];
                case 4: return shade[channel];
                case 5: return envRGBA[channel];
                case 6: return 255;
                case 7: return 0;          // COMBINED_ALPHA (cycle 1: 0)
                case 8: return tex.a;      // TEXEL0_ALPHA
                case 9: return tex.a;      // TEXEL1_ALPHA
                case 10: return primRGBA.a;
                case 11: return shade.a;
                case 12: return envRGBA.a;
                case 13: return 255;       // LOD_FRACTION (unsupported → opaque)
                case 14: return 255;       // PRIM_LOD_FRAC
                default: return 0;
            }
        };
        const alphaSrc = (sel) => {
            switch (sel & 0x7) {
                case 0: return 0;            // COMBINED
                case 1: return tex.a;
                case 2: return tex.a;
                case 3: return primRGBA.a;
                case 4: return shade.a;
                case 5: return envRGBA.a;
                case 6: return 255;          // 1
                case 7: return 0;            // 0
            }
            return 0;
        };

        const cA = (hi >>> 20) & 0xF;
        const cB = (lo >>> 28) & 0xF;
        const cC = (hi >>> 15) & 0x1F;
        const cD = (lo >>> 15) & 0x7;
        const aA = (hi >>> 12) & 0x7;
        const aB = (lo >>> 12) & 0x7;
        const aC = (hi >>> 9)  & 0x7;
        const aD = (lo >>> 9)  & 0x7;

        // Detect degenerate / "no-op" combiners (everything 0). SM64 sometimes
        // sets these between draws; fall back to shade*tex modulate to avoid
        // black geometry.
        const allZero =
            cA === 0 && cB === 0 && cC === 0 && cD === 0 &&
            aA === 0 && aB === 0 && aC === 0 && aD === 0;
        if (allZero) {
            return {
                r: clamp255((shade.r * tex.r) / 255),
                g: clamp255((shade.g * tex.g) / 255),
                b: clamp255((shade.b * tex.b) / 255),
                a: clamp255((shade.a * tex.a) / 255)
            };
        }

        const compute = (ch) => {
            const a = colorSrc(cA, ch);
            const b = colorSrc(cB, ch);
            const c = colorCSrc(cC, ch);
            const d = colorSrc(cD, ch);
            return clamp255(((a - b) * c) / 255 + d);
        };
        const a = (() => {
            const aa = alphaSrc(aA);
            const ab = alphaSrc(aB);
            const ac = alphaSrc(aC);
            const ad = alphaSrc(aD);
            return clamp255(((aa - ab) * ac) / 255 + ad);
        })();

        return { r: compute('r'), g: compute('g'), b: compute('b'), a };
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
        const uls = (hi >>> 12) & 0xFFF;
        const ult = hi & 0xFFF;
        const lrs = (lo >>> 12) & 0xFFF;
        const startS = Math.floor(uls / 4);
        const startT = Math.floor(ult / 4);
        const endS = Math.floor(lrs / 4);
        const texels = Math.max(0, endS - startS + 1);
        const bpp = (this.rspState.textureImageSize === 3) ? 4 : (this.rspState.textureImageSize === 2 ? 2 : 1);
        const imgWidth = Math.max(1, this.rspState.textureImageWidth | 0);
        const srcBase = (this.rspState.textureImage + ((startT * imgWidth + startS) * bpp)) & 0x7FFFFF;
        const off = tile.tmem * 8;
        const totalBytes = texels * bpp;
        for (let i = 0; i < totalBytes && (off + i < 4096); i++) {
            this.tmem[off + i] = this.mmu.read8(srcBase + i);
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
        // Use a constant white shade so the combiner still works for texrect
        // surfaces that mix env/prim color with the texture.
        const shade = { r: 255, g: 255, b: 255, a: 255 };

        for (let y = Math.max(0, top); y < Math.min(bottom, 240); y++) {
            const dt = y - top;
            for (let x = Math.max(0, left); x < Math.min(right, cw); x++) {
                const ds = x - left;
                // Advance S/T in the correct axis (flip swaps S↔T advancement dirs)
                const s = flip ? (s0 + dsdx * dt) : (s0 + dsdx * ds);
                const t = flip ? (t0 + dtdy * ds) : (t0 + dtdy * dt);

                const tex = this.rspState.useTexture
                    ? this.sampleTexture(s, t, tile)
                    : { r: 255, g: 255, b: 255, a: 255 };

                let color;
                if (this.rspState.combine.hi || this.rspState.combine.lo) {
                    color = this.combineColor(shade, tex);
                } else {
                    color = tex;
                }
                if (color.a < 1) continue;

                const bpp = cSz === 3 ? 4 : 2;
                const p = (colorAddr + (y * cw + x) * bpp) & 0x7FFFFF;
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
            let n = this.rspState.isF3DEX2 ? Math.floor(raw / 24) : Math.floor(raw / 32) + 1;
            if (n < 0) n = 0;
            if (n > 8) n = 8;
            this.rspState.numLights = n;
            return;
        }
    }
}
