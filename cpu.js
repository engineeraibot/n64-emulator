class CPU {
    constructor(mmu, rcp) {
        this.mmu = mmu;
        this.rcp = rcp;
        this.initOpTables();
        this.reset();
    }

    invalidateCache() {
        this.fetchPage = -1;
        this.fetchView = null;
    }

    initOpTables() {
        this.opTable = new Array(64).fill(this.opInvalid.bind(this));
        this.specialTable = new Array(64).fill(this.opInvalid.bind(this));
        this.regimmTable = new Array(32).fill(this.opInvalid.bind(this));

        // REGIMM Table
        this.regimmTable[0x00] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] < 0n) { this.branchTarget = pc + 4n + (BigInt.asIntN(16, BigInt(i & 0xFFFF)) << 2n); this.branchTaken = true; return pc + 4n; } else { this.branchTarget = pc + 8n; this.branchTaken = true; return pc + 4n; } };
        this.regimmTable[0x01] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] >= 0n) { this.branchTarget = pc + 4n + (BigInt.asIntN(16, BigInt(i & 0xFFFF)) << 2n); this.branchTaken = true; return pc + 4n; } else { this.branchTarget = pc + 8n; this.branchTaken = true; return pc + 4n; } };
        this.regimmTable[0x02] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] < 0n) { this.branchTarget = pc + 4n + (BigInt.asIntN(16, BigInt(i & 0xFFFF)) << 2n); this.branchTaken = true; return pc + 4n; } else { return pc + 8n; } };
        this.regimmTable[0x03] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] >= 0n) { this.branchTarget = pc + 4n + (BigInt.asIntN(16, BigInt(i & 0xFFFF)) << 2n); this.branchTaken = true; return pc + 4n; } else { return pc + 8n; } };
        this.regimmTable[0x10] = (i, pc, ds) => { this.gpr[31] = pc + 8n; this.branchTarget = pc + 4n + (BigInt.asIntN(16, BigInt(i & 0xFFFF)) << 2n); if (this.gpr[(i >> 21) & 0x1F] < 0n) { this.branchTaken = true; } else { this.branchTarget = pc + 8n; this.branchTaken = true; } return pc + 4n; };
        this.regimmTable[0x11] = (i, pc, ds) => { this.gpr[31] = pc + 8n; this.branchTarget = pc + 4n + (BigInt.asIntN(16, BigInt(i & 0xFFFF)) << 2n); if (this.gpr[(i >> 21) & 0x1F] >= 0n) { this.branchTaken = true; } else { this.branchTarget = pc + 8n; this.branchTaken = true; } return pc + 4n; };
        this.regimmTable[0x12] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] < 0n) { this.gpr[31] = pc + 8n; this.branchTarget = pc + 4n + (BigInt.asIntN(16, BigInt(i & 0xFFFF)) << 2n); this.branchTaken = true; return pc + 4n; } else { return pc + 8n; } };
        this.regimmTable[0x13] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] >= 0n) { this.gpr[31] = pc + 8n; this.branchTarget = pc + 4n + (BigInt.asIntN(16, BigInt(i & 0xFFFF)) << 2n); this.branchTaken = true; return pc + 4n; } else { return pc + 8n; } };
        this.regimmTable[0x08] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] >= BigInt.asIntN(16, BigInt(i & 0xFFFF))) return this.raiseException(13, pc, ds); };
        this.regimmTable[0x09] = (i, pc, ds) => { if (BigInt.asUintN(64, this.gpr[(i >> 21) & 0x1F]) >= BigInt.asUintN(64, BigInt.asIntN(16, BigInt(i & 0xFFFF)))) return this.raiseException(13, pc, ds); };
        this.regimmTable[0x0A] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] < BigInt.asIntN(16, BigInt(i & 0xFFFF))) return this.raiseException(13, pc, ds); };
        this.regimmTable[0x0B] = (i, pc, ds) => { if (BigInt.asUintN(64, this.gpr[(i >> 21) & 0x1F]) < BigInt.asUintN(64, BigInt.asIntN(16, BigInt(i & 0xFFFF)))) return this.raiseException(13, pc, ds); };
        this.regimmTable[0x0C] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] === BigInt.asIntN(16, BigInt(i & 0xFFFF))) return this.raiseException(13, pc, ds); };
        this.regimmTable[0x0E] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] !== BigInt.asIntN(16, BigInt(i & 0xFFFF))) return this.raiseException(13, pc, ds); };

        // Primary Opcodes
        this.opTable[0x00] = this.opSPECIAL.bind(this);
        this.opTable[0x01] = this.opREGIMM.bind(this);
        this.opTable[0x02] = this.opJ.bind(this);
        this.opTable[0x03] = this.opJAL.bind(this);
        this.opTable[0x04] = this.opBEQ.bind(this);
        this.opTable[0x05] = this.opBNE.bind(this);
        this.opTable[0x06] = this.opBLEZ.bind(this);
        this.opTable[0x07] = this.opBGTZ.bind(this);
        this.opTable[0x08] = this.opADDIU.bind(this);
        this.opTable[0x09] = this.opADDIU.bind(this);
        this.opTable[0x0A] = this.opSLTI.bind(this);
        this.opTable[0x0B] = this.opSLTIU.bind(this);
        this.opTable[0x0C] = this.opANDI.bind(this);
        this.opTable[0x0D] = this.opORI.bind(this);
        this.opTable[0x0E] = this.opXORI.bind(this);
        this.opTable[0x0F] = this.opLUI.bind(this);
        this.opTable[0x10] = this.opCOP0.bind(this);
        this.opTable[0x11] = this.opCOP1.bind(this);
        this.opTable[0x12] = (i, pc) => pc + 4n; // COP2 NOP
        this.opTable[0x13] = (i, pc) => pc + 4n; // COP3 NOP
        this.opTable[0x14] = this.opBEQL.bind(this);
        this.opTable[0x15] = this.opBNEL.bind(this);
        this.opTable[0x16] = this.opBLEZL.bind(this);
        this.opTable[0x17] = this.opBGTZL.bind(this);
        this.opTable[0x18] = this.opDADDIU.bind(this);
        this.opTable[0x19] = this.opDADDIU.bind(this);
        this.opTable[0x1A] = this.opLDL.bind(this);
        this.opTable[0x1B] = this.opLDR.bind(this);
        this.opTable[0x1C] = this.opSPECIAL2.bind(this);
        this.opTable[0x20] = this.opLB.bind(this);
        this.opTable[0x21] = this.opLH.bind(this);
        this.opTable[0x22] = this.opLWL.bind(this);
        this.opTable[0x23] = this.opLW.bind(this);
        this.opTable[0x24] = this.opLBU.bind(this);
        this.opTable[0x25] = this.opLHU.bind(this);
        this.opTable[0x26] = this.opLWR.bind(this);
        this.opTable[0x27] = this.opLWU.bind(this);
        this.opTable[0x28] = this.opSB.bind(this);
        this.opTable[0x29] = this.opSH.bind(this);
        this.opTable[0x2A] = this.opSWL.bind(this);
        this.opTable[0x2B] = this.opSW.bind(this);
        this.opTable[0x2C] = this.opSDL.bind(this);
        this.opTable[0x2D] = this.opSWR.bind(this);
        this.opTable[0x2E] = this.opSDR.bind(this);
        this.opTable[0x2F] = (i, pc) => pc + 4n; // CACHE
        this.opTable[0x30] = this.opLL.bind(this);
        this.opTable[0x31] = this.opLWC1.bind(this);
        this.opTable[0x32] = (i, pc) => pc + 4n; // LWC2 NOP
        this.opTable[0x34] = this.opLLD.bind(this);
        this.opTable[0x35] = this.opLDC1.bind(this);
        this.opTable[0x36] = (i, pc) => pc + 4n; // LDC2 NOP
        this.opTable[0x37] = this.opLD.bind(this);
        this.opTable[0x38] = this.opSC.bind(this);
        this.opTable[0x39] = this.opSWC1.bind(this);
        this.opTable[0x3A] = (i, pc) => pc + 4n; // SWC2 NOP
        this.opTable[0x3C] = this.opSCD.bind(this);
        this.opTable[0x3D] = this.opSDC1.bind(this);
        this.opTable[0x3E] = (i, pc) => pc + 4n; // SDC2 NOP
        this.opTable[0x3F] = this.opSD.bind(this);

        // SPECIAL Table (func)
        this.specialTable[0x00] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(32, (this.gpr[(i >> 16) & 0x1F] & 0xFFFFFFFFn) << BigInt((i >> 6) & 0x1F)); };
        this.specialTable[0x01] = (i) => { if (((i >> 16) & 1) === (((this.fcr31 & 0x00800000) ? 1 : 0))) this.gpr[(i >> 11) & 0x1F] = this.gpr[(i >> 21) & 0x1F]; };
        this.specialTable[0x02] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(32, BigInt.asUintN(32, this.gpr[(i >> 16) & 0x1F]) >> BigInt((i >> 6) & 0x1F)); };
        this.specialTable[0x03] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(32, BigInt.asIntN(32, this.gpr[(i >> 16) & 0x1F]) >> BigInt((i >> 6) & 0x1F)); };
        this.specialTable[0x04] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(32, (this.gpr[(i >> 16) & 0x1F] & 0xFFFFFFFFn) << (this.gpr[(i >> 21) & 0x1F] & 0x1Fn)); };
        this.specialTable[0x06] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(32, BigInt.asUintN(32, this.gpr[(i >> 16) & 0x1F]) >> (this.gpr[(i >> 21) & 0x1F] & 0x1Fn)); };
        this.specialTable[0x07] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(32, BigInt.asIntN(32, this.gpr[(i >> 16) & 0x1F]) >> (this.gpr[(i >> 21) & 0x1F] & 0x1Fn)); };
        this.specialTable[0x08] = (i) => { this.branchTarget = this.gpr[(i >> 21) & 0x1F]; this.branchTaken = true; };
        this.specialTable[0x09] = (i, pc) => { this.branchTarget = this.gpr[(i >> 21) & 0x1F]; this.gpr[(i >> 11) & 0x1F] = pc + 8n; this.branchTaken = true; };
        this.specialTable[0x0A] = (i) => { if (this.gpr[(i >> 16) & 0x1F] === 0n) this.gpr[(i >> 11) & 0x1F] = this.gpr[(i >> 21) & 0x1F]; };
        this.specialTable[0x0B] = (i) => { if (this.gpr[(i >> 16) & 0x1F] !== 0n) this.gpr[(i >> 11) & 0x1F] = this.gpr[(i >> 21) & 0x1F]; };
        this.specialTable[0x0C] = (i, pc, ds) => this.raiseException(8, pc, ds);
        this.specialTable[0x0D] = (i, pc, ds) => this.raiseException(9, pc, ds);
        this.specialTable[0x0E] = (i, pc) => pc + 4n; // SYNC NOP
        this.specialTable[0x0F] = (i, pc) => pc + 4n; // SYNC NOP
        this.specialTable[0x10] = (i) => { this.gpr[(i >> 11) & 0x1F] = this.hi; };
        this.specialTable[0x11] = (i) => { this.hi = this.gpr[(i >> 21) & 0x1F]; };
        this.specialTable[0x12] = (i) => { this.gpr[(i >> 11) & 0x1F] = this.lo; };
        this.specialTable[0x13] = (i) => { this.lo = this.gpr[(i >> 21) & 0x1F]; };
        this.specialTable[0x14] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(64, this.gpr[(i >> 16) & 0x1F] << (this.gpr[(i >> 21) & 0x1F] & 0x3Fn)); };
        this.specialTable[0x16] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(64, BigInt.asUintN(64, this.gpr[(i >> 16) & 0x1F]) >> (this.gpr[(i >> 21) & 0x1F] & 0x3Fn)); };
        this.specialTable[0x17] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(64, BigInt.asIntN(64, this.gpr[(i >> 16) & 0x1F]) >> (this.gpr[(i >> 21) & 0x1F] & 0x3Fn)); };
        this.specialTable[0x18] = (i) => { const r = BigInt.asIntN(32, this.gpr[(i >> 21) & 0x1F]) * BigInt.asIntN(32, this.gpr[(i >> 16) & 0x1F]); this.lo = BigInt.asIntN(32, r); this.hi = BigInt.asIntN(32, r >> 32n); };
        this.specialTable[0x19] = (i) => { const r = BigInt.asUintN(32, this.gpr[(i >> 21) & 0x1F]) * BigInt.asUintN(32, this.gpr[(i >> 16) & 0x1F]); this.lo = BigInt.asIntN(32, r); this.hi = BigInt.asIntN(32, r >> 32n); };
        this.specialTable[0x1A] = (i) => { const a = BigInt.asIntN(32, this.gpr[(i >> 21) & 0x1F]), b = BigInt.asIntN(32, this.gpr[(i >> 16) & 0x1F]); if (b !== 0n) { this.lo = BigInt.asIntN(32, a / b); this.hi = BigInt.asIntN(32, a % b); } };
        this.specialTable[0x1B] = (i) => { const a = BigInt.asUintN(32, this.gpr[(i >> 21) & 0x1F]), b = BigInt.asUintN(32, this.gpr[(i >> 16) & 0x1F]); if (b !== 0n) { this.lo = BigInt.asIntN(32, a / b); this.hi = BigInt.asIntN(32, a % b); } };
        this.specialTable[0x1C] = (i) => { const r = this.gpr[(i >> 21) & 0x1F] * this.gpr[(i >> 16) & 0x1F]; this.lo = BigInt.asIntN(64, r); this.hi = BigInt.asIntN(64, r >> 64n); };
        this.specialTable[0x1D] = (i) => { const r = BigInt.asUintN(64, this.gpr[(i >> 21) & 0x1F]) * BigInt.asUintN(64, this.gpr[(i >> 16) & 0x1F]); this.lo = BigInt.asIntN(64, r); this.hi = BigInt.asIntN(64, r >> 64n); };
        this.specialTable[0x1E] = (i) => { const a = this.gpr[(i >> 21) & 0x1F], b = this.gpr[(i >> 16) & 0x1F]; if (b !== 0n) { this.lo = a / b; this.hi = a % b; } };
        this.specialTable[0x1F] = (i) => { const a = BigInt.asUintN(64, this.gpr[(i >> 21) & 0x1F]), b = BigInt.asUintN(64, this.gpr[(i >> 16) & 0x1F]); if (b !== 0n) { this.lo = BigInt.asIntN(64, a / b); this.hi = BigInt.asIntN(64, a % b); } };
        this.specialTable[0x20] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(32, this.gpr[(i >> 21) & 0x1F] + this.gpr[(i >> 16) & 0x1F]); };
        this.specialTable[0x21] = this.specialTable[0x20];
        this.specialTable[0x22] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(32, this.gpr[(i >> 21) & 0x1F] - this.gpr[(i >> 16) & 0x1F]); };
        this.specialTable[0x23] = this.specialTable[0x22];
        this.specialTable[0x24] = (i) => { this.gpr[(i >> 11) & 0x1F] = this.gpr[(i >> 21) & 0x1F] & this.gpr[(i >> 16) & 0x1F]; };
        this.specialTable[0x25] = (i) => { this.gpr[(i >> 11) & 0x1F] = this.gpr[(i >> 21) & 0x1F] | this.gpr[(i >> 16) & 0x1F]; };
        this.specialTable[0x26] = (i) => { this.gpr[(i >> 11) & 0x1F] = this.gpr[(i >> 21) & 0x1F] ^ this.gpr[(i >> 16) & 0x1F]; };
        this.specialTable[0x27] = (i) => { this.gpr[(i >> 11) & 0x1F] = ~(this.gpr[(i >> 21) & 0x1F] | this.gpr[(i >> 16) & 0x1F]); };
        this.specialTable[0x2A] = (i) => { this.gpr[(i >> 11) & 0x1F] = (this.gpr[(i >> 21) & 0x1F] < this.gpr[(i >> 16) & 0x1F]) ? 1n : 0n; };
        this.specialTable[0x2B] = (i) => { this.gpr[(i >> 11) & 0x1F] = (BigInt.asUintN(64, this.gpr[(i >> 21) & 0x1F]) < BigInt.asUintN(64, this.gpr[(i >> 16) & 0x1F])) ? 1n : 0n; };
        this.specialTable[0x2C] = (i) => { this.gpr[(i >> 11) & 0x1F] = this.gpr[(i >> 21) & 0x1F] + this.gpr[(i >> 16) & 0x1F]; };
        this.specialTable[0x2D] = this.specialTable[0x2C];
        this.specialTable[0x2E] = (i) => { this.gpr[(i >> 11) & 0x1F] = this.gpr[(i >> 21) & 0x1F] - this.gpr[(i >> 16) & 0x1F]; };
        this.specialTable[0x2F] = this.specialTable[0x2E];
        this.specialTable[0x30] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] >= this.gpr[(i >> 16) & 0x1F]) return this.raiseException(13, pc, ds); };
        this.specialTable[0x31] = (i, pc, ds) => { if (BigInt.asUintN(64, this.gpr[(i >> 21) & 0x1F]) >= BigInt.asUintN(64, this.gpr[(i >> 16) & 0x1F])) return this.raiseException(13, pc, ds); };
        this.specialTable[0x32] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] < this.gpr[(i >> 16) & 0x1F]) return this.raiseException(13, pc, ds); };
        this.specialTable[0x33] = (i, pc, ds) => { if (BigInt.asUintN(64, this.gpr[(i >> 21) & 0x1F]) < BigInt.asUintN(64, this.gpr[(i >> 16) & 0x1F])) return this.raiseException(13, pc, ds); };
        this.specialTable[0x34] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] === this.gpr[(i >> 16) & 0x1F]) return this.raiseException(13, pc, ds); };
        this.specialTable[0x36] = (i, pc, ds) => { if (this.gpr[(i >> 21) & 0x1F] !== this.gpr[(i >> 16) & 0x1F]) return this.raiseException(13, pc, ds); };
        this.specialTable[0x38] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(64, this.gpr[(i >> 16) & 0x1F] << BigInt((i >> 6) & 0x1F)); };
        this.specialTable[0x3A] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(64, BigInt.asUintN(64, this.gpr[(i >> 16) & 0x1F]) >> BigInt((i >> 6) & 0x1F)); };
        this.specialTable[0x3B] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(64, BigInt.asIntN(64, this.gpr[(i >> 16) & 0x1F]) >> BigInt((i >> 6) & 0x1F)); };
        this.specialTable[0x3C] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(64, this.gpr[(i >> 16) & 0x1F] << (BigInt((i >> 6) & 0x1F) + 32n)); };
        this.specialTable[0x3E] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(64, BigInt.asUintN(64, this.gpr[(i >> 16) & 0x1F]) >> (BigInt((i >> 6) & 0x1F) + 32n)); };
        this.specialTable[0x3F] = (i) => { this.gpr[(i >> 11) & 0x1F] = BigInt.asIntN(64, BigInt.asIntN(64, this.gpr[(i >> 16) & 0x1F]) >> (BigInt((i >> 6) & 0x1F) + 32n)); };
    }

    opInvalid(i, pc, ds) { return this.raiseException(10, pc, ds); }

    reset() {
        this.fetchPage = -1;
        this.fetchView = null;
        this.instructionCount = 0;
        this.pcHistory = new BigUint64Array(100);
        this.pcHistoryIdx = 0;
        this.gpr = new BigInt64Array(32);
        this.fprBuffer = new ArrayBuffer(32 * 8);
        this.fprView = new DataView(this.fprBuffer);
        this.fcr0 = 0x00000510;
        this.fcr31 = 0;
        this.pc = 0xBFC00000n;
        this.cp0Registers = new BigInt64Array(32);
        this.cp0Registers[16] = 0x0006E463n; // Standard N64 config
        this.hi = 0n;
        this.lo = 0n;
        this.gpr[0] = 0n;
        this.isRunning = false;
        this.branchTaken = false;
        this.branchTarget = 0n;
        this.isHleBootDone = false;
        this.exceptionRaised = false;
    }

    run() {
        if (this.isRunning) return;
        this.isRunning = true;
        if (!this.isHleBootDone) this.performHleBoot();

        const runLoop = () => {
            if (!this.isRunning) return;
            let count = 0;
            const budget = 5000000;
            const batch = 1000000;

            while (count < budget) {
                for (let i = 0; i < batch; i++) {
                    this.step();
                }
                count += batch;
            }
            setTimeout(runLoop, 0);
        };
        runLoop();
    }

    performHleBoot() {
        const memory = this.mmu.memory;
        if (!memory.rom) return;

        const romView = new Uint8Array(memory.rom);
        const rdramView = new Uint8Array(memory.rdram);
        const romDataView = new DataView(memory.rom);

        // Copy IPL3-like header
        rdramView.set(romView.subarray(0, 0x1000), 0);

        const entryPoint = BigInt(romDataView.getUint32(0x08, false)) & 0xFFFFFFFFn;
        this.pc = BigInt.asIntN(32, entryPoint);

        const ramOffset = Number(entryPoint & 0x00FFFFFFn);
        const kSize = Math.min(0x200000, romView.length - 0x1000);

        // Setup exception vectors
        const j400 = 0x08000100;
        const rdv_rd = new DataView(memory.rdram);
        rdv_rd.setUint32(0x000, j400, false);
        rdv_rd.setUint32(0x080, j400, false);
        rdv_rd.setUint32(0x100, j400, false);
        rdv_rd.setUint32(0x180, j400, false);

        // Load kernel segments
        rdramView.set(romView.subarray(0x1000, 0x1000 + kSize), 0x400);
        rdramView.set(romView.subarray(0x1000, 0x1000 + Math.min(romView.length - 0x1000, rdramView.length - ramOffset)), ramOffset);

        // Register initialization
        this.gpr[29] = BigInt.asIntN(32, 0x80370000n); // sp
        this.gpr[16] = BigInt.asIntN(32, BigInt(romDataView.getUint32(0, false))); // s0

        const countryCode = romDataView.getUint8(0x3E);
        const isPal = (countryCode === 0x50 || countryCode === 0x44 || countryCode === 0x46 || countryCode === 0x4E || countryCode === 0x49 || countryCode === 0x53);
        this.gpr[17] = isPal ? 3n : 1n; // s1 (CIC type: CIC-6103 for PAL, CIC-6102 for NTSC)

        this.gpr[18] = BigInt.asIntN(32, BigInt(romDataView.getUint32(0x10, false))); // s2 (checksum)
        this.gpr[11] = BigInt.asIntN(32, BigInt(romDataView.getUint32(0x14, false))); // t3 (checksum)

        this.cp0Registers[12] = 0x30000000n; // Status: CU0=1, CU1=1, FR=0, BEV=0

        // PIF RAM seed
        if (isPal) {
            this.mmu.pifRam[0x24] = 0x3F;
            this.mmu.pifRam[0x25] = 0x3F;
            this.mmu.pifRam[0x26] = 0x78;
            this.mmu.pifRam[0x27] = 0x3F;
        } else {
            this.mmu.pifRam[0x24] = 0x3F;
            this.mmu.pifRam[0x25] = 0x3F;
            this.mmu.pifRam[0x26] = 0x3F;
            this.mmu.pifRam[0x27] = 0x3F;
        }

        this.isHleBootDone = true;
        console.log(`HLE Boot Done. isPal=${isPal} entry=0x${entryPoint.toString(16)}`);
    }

    step() {
        this.pcHistory[this.pcHistoryIdx] = this.pc;
        this.pcHistoryIdx = (this.pcHistoryIdx + 1) % 100;

        this.instructionCount++;
        this.gpr[0] = 0n;

        if ((this.instructionCount % 5000000) === 0) {
            console.log(`CPU Status: PC=0x${this.pc.toString(16)} Instructions=${this.instructionCount}`);
            let history = [];
            for (let i = 0; i < 20; i++) {
                history.push(this.pcHistory[(this.pcHistoryIdx + i + 80) % 100].toString(16));
            }
            console.log("Recent PC History:", history);
        }

        // CP0 Count register (half frequency)
        if ((this.instructionCount & 1) === 0) {
            this.cp0Registers[9] = (this.cp0Registers[9] + 1n) & 0xFFFFFFFFn;
            if (this.cp0Registers[9] === this.cp0Registers[11] && this.cp0Registers[11] !== 0n) {
                this.cp0Registers[13] |= 0x00008000n; // Timer interrupt
            }
        }

        // Hardware events and interrupts
        if ((this.instructionCount & 0x7F) === 0) this.mmu.checkInternalEvents();

        const miIntr = this.mmu.miRegisters[2];
        const miMask = this.mmu.miRegisters[3];
        if (miIntr & miMask) {
            this.cp0Registers[13] |= 0x00000400n;
        } else {
            this.cp0Registers[13] &= ~0x00000400n;
        }

        const status = this.cp0Registers[12];
        const cause = this.cp0Registers[13];
        if ((status & 1n) && !(status & 2n) && ((status >> 8n) & (cause >> 8n) & 0xFFn)) {
            this.raiseException(0, this.pc, false);
        }

        const currentPc = this.pc;
        if (currentPc & 3n) {
            this.raiseException(4, currentPc, false);
            return;
        }

        const pcNum = Number(currentPc & 0xFFFFFFFFn);
        const physPc = (pcNum >= 0x80000000 && pcNum <= 0xBFFFFFFF) ? (pcNum & 0x1FFFFFFF) : pcNum;

        let instruction;
        if (physPc <= 0x7FFFFF) {
            const page = physPc >>> 12;
            if (page !== this.fetchPage) {
                this.fetchPage = page;
                this.fetchView = new DataView(this.mmu.memory.rdram, page << 12, 4096);
            }
            instruction = this.fetchView.getUint32(physPc & 0xFFF, false);
        } else {
            instruction = this.mmu.read32(physPc);
        }
        this.exceptionRaised = false;

        const nextPc = this.decodeAndExecute(instruction, currentPc, false);
        if (this.exceptionRaised || nextPc === null) return;

        if (this.branchTaken) {
            const dsPc = Number((currentPc + 4n) & 0xFFFFFFFFn);
            const dsPhys = (dsPc >= 0x80000000 && dsPc <= 0xBFFFFFFF) ? (dsPc & 0x1FFFFFFF) : dsPc;
            let ds;
            if (dsPhys <= 0x7FFFFF) {
                const dsPage = dsPhys >>> 12;
                if (dsPage !== this.fetchPage) {
                    this.fetchPage = dsPage;
                    this.fetchView = new DataView(this.mmu.memory.rdram, dsPage << 12, 4096);
                }
                ds = this.fetchView.getUint32(dsPhys & 0xFFF, false);
            } else {
                ds = this.mmu.read32(dsPhys);
            }
            this.decodeAndExecute(ds, currentPc + 4n, true);
            if (this.exceptionRaised) return;
            this.pc = BigInt.asIntN(32, this.branchTarget);
            this.branchTaken = false;
        } else {
            this.pc = BigInt.asIntN(32, nextPc);
        }
    }

    decodeAndExecute(instruction, currentPc, isDelaySlot) {
        const opcode = (instruction >>> 26) & 0x3F;
        const res = this.opTable[opcode](instruction, currentPc, isDelaySlot);
        if (res !== undefined) return res;
        return currentPc + 4n;
    }

    opBEQL(i, pc, ds) {
        const rs = (i >> 21) & 0x1F, rt = (i >> 16) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(i & 0xFFFF));
        if (this.gpr[rs] === this.gpr[rt]) {
            this.branchTarget = pc + 4n + (imm << 2n);
            this.branchTaken = true;
            return pc + 4n;
        }
        return pc + 8n;
    }

    opBNEL(i, pc, ds) {
        const rs = (i >> 21) & 0x1F, rt = (i >> 16) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(i & 0xFFFF));
        if (this.gpr[rs] !== this.gpr[rt]) {
            this.branchTarget = pc + 4n + (imm << 2n);
            this.branchTaken = true;
            return pc + 4n;
        }
        return pc + 8n;
    }

    opBLEZL(i, pc, ds) {
        const rs = (i >> 21) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(i & 0xFFFF));
        if (this.gpr[rs] <= 0n) {
            this.branchTarget = pc + 4n + (imm << 2n);
            this.branchTaken = true;
            return pc + 4n;
        }
        return pc + 8n;
    }

    opBGTZL(i, pc, ds) {
        const rs = (i >> 21) & 0x1F;
        const imm = BigInt.asIntN(16, BigInt(i & 0xFFFF));
        if (this.gpr[rs] > 0n) {
            this.branchTarget = pc + 4n + (imm << 2n);
            this.branchTaken = true;
            return pc + 4n;
        }
        return pc + 8n;
    }

    opSPECIAL2(i, pc, ds) {
        if ((i & 0x3F) === 0x02) { // MUL
            const rs = (i >> 21) & 0x1F, rt = (i >> 16) & 0x1F, rd = (i >> 11) & 0x1F;
            this.gpr[rd] = BigInt.asIntN(32, BigInt.asIntN(32, this.gpr[rs]) * BigInt.asIntN(32, this.gpr[rt]));
        }
        return pc + 4n;
    }

    opSPECIAL(i, pc, ds) {
        const f = i & 0x3F;
        const res = this.specialTable[f](i, pc, ds);
        if (res !== undefined) return res;
        return pc + 4n;
    }

    opREGIMM(i, pc, ds) {
        const s = (i >> 16) & 0x1F;
        const res = this.regimmTable[s](i, pc, ds);
        if (res !== undefined) return res;
        return pc + 4n;
    }

    opJ(i, pc, ds) { this.branchTarget = BigInt.asIntN(32, (pc & 0xF0000000n) | (BigInt(i & 0x03FFFFFF) << 2n)); this.branchTaken = true; return pc + 4n; }
    opJAL(i, pc, ds) { this.gpr[31] = BigInt.asIntN(32, pc + 8n); return this.opJ(i, pc); }
    opBEQ(i, pc, ds) {
        if (this.gpr[(i >> 21) & 0x1F] === this.gpr[(i >> 16) & 0x1F]) {
            this.branchTarget = pc + 4n + (BigInt.asIntN(16, BigInt(i & 0xFFFF)) << 2n);
        } else {
            this.branchTarget = pc + 8n;
        }
        this.branchTaken = true;
        return pc + 4n;
    }
    opBNE(i, pc, ds) {
        if (this.gpr[(i >> 21) & 0x1F] !== this.gpr[(i >> 16) & 0x1F]) {
            this.branchTarget = pc + 4n + (BigInt.asIntN(16, BigInt(i & 0xFFFF)) << 2n);
        } else {
            this.branchTarget = pc + 8n;
        }
        this.branchTaken = true;
        return pc + 4n;
    }
    opBLEZ(i, pc, ds) {
        if (this.gpr[(i >> 21) & 0x1F] <= 0n) {
            this.branchTarget = pc + 4n + (BigInt.asIntN(16, BigInt(i & 0xFFFF)) << 2n);
        } else {
            this.branchTarget = pc + 8n;
        }
        this.branchTaken = true;
        return pc + 4n;
    }
    opBGTZ(i, pc, ds) {
        if (this.gpr[(i >> 21) & 0x1F] > 0n) {
            this.branchTarget = pc + 4n + (BigInt.asIntN(16, BigInt(i & 0xFFFF)) << 2n);
        } else {
            this.branchTarget = pc + 8n;
        }
        this.branchTaken = true;
        return pc + 4n;
    }

    opADDIU(i) { this.gpr[(i >> 16) & 0x1F] = BigInt.asIntN(32, this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF))); }
    opDADDIU(i) { this.gpr[(i >> 16) & 0x1F] = this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)); }
    opSLTI(i) { this.gpr[(i >> 16) & 0x1F] = (this.gpr[(i >> 21) & 0x1F] < BigInt.asIntN(16, BigInt(i & 0xFFFF))) ? 1n : 0n; }
    opSLTIU(i) { this.gpr[(i >> 16) & 0x1F] = (BigInt.asUintN(64, this.gpr[(i >> 21) & 0x1F]) < BigInt.asUintN(64, BigInt.asIntN(16, BigInt(i & 0xFFFF)))) ? 1n : 0n; }
    opANDI(i) { this.gpr[(i >> 16) & 0x1F] = this.gpr[(i >> 21) & 0x1F] & BigInt(i & 0xFFFF); }
    opORI(i) { this.gpr[(i >> 16) & 0x1F] = this.gpr[(i >> 21) & 0x1F] | BigInt(i & 0xFFFF); }
    opXORI(i) { this.gpr[(i >> 16) & 0x1F] = this.gpr[(i >> 21) & 0x1F] ^ BigInt(i & 0xFFFF); }
    opLUI(i) { this.gpr[(i >> 16) & 0x1F] = BigInt.asIntN(32, BigInt.asIntN(16, BigInt(i & 0xFFFF)) << 16n); }

    opLB(i) { this.gpr[(i >> 16) & 0x1F] = BigInt.asIntN(8, BigInt(this.mmu.read8(Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)))))); }
    opLBU(i) { this.gpr[(i >> 16) & 0x1F] = BigInt.asUintN(8, BigInt(this.mmu.read8(Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)))))); }
    opLH(i) { this.gpr[(i >> 16) & 0x1F] = BigInt.asIntN(16, BigInt(this.mmu.read16(Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)))))); }
    opLHU(i) { this.gpr[(i >> 16) & 0x1F] = BigInt.asUintN(16, BigInt(this.mmu.read16(Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)))))); }
    opLW(i) { this.gpr[(i >> 16) & 0x1F] = BigInt.asIntN(32, BigInt(this.mmu.read32(Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)))))); }
    opLWU(i) { this.gpr[(i >> 16) & 0x1F] = BigInt.asUintN(32, BigInt(this.mmu.read32(Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)))))); }
    opLD(i) { this.gpr[(i >> 16) & 0x1F] = this.mmu.read64(Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)))); }

    opSB(i) { this.mmu.write8(Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF))), Number(this.gpr[(i >> 16) & 0x1F] & 0xFFn)); }
    opSH(i) { this.mmu.write16(Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF))), Number(this.gpr[(i >> 16) & 0x1F] & 0xFFFFn)); }
    opSW(i) { this.mmu.write32(Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF))), Number(this.gpr[(i >> 16) & 0x1F] & 0xFFFFFFFFn)); }
    opSD(i) { this.mmu.write64(Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF))), this.gpr[(i >> 16) & 0x1F]); }

    opLWL(i) {
        const a = Number((this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF))) & 0xFFFFFFFFn);
        const w = this.mmu.read32(a & ~3);
        const v = Number(this.gpr[(i >> 16) & 0x1F] & 0xFFFFFFFFn);
        const s = a & 3;
        let r;
        if (s === 0) r = w;
        else if (s === 1) r = (v & 0xFF) | (w << 8);
        else if (s === 2) r = (v & 0xFFFF) | (w << 16);
        else r = (v & 0xFFFFFF) | (w << 24);
        this.gpr[(i >> 16) & 0x1F] = BigInt.asIntN(32, BigInt(r | 0));
    }

    opLWR(i) {
        const a = Number((this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF))) & 0xFFFFFFFFn);
        const w = this.mmu.read32(a & ~3);
        const v = Number(this.gpr[(i >> 16) & 0x1F] & 0xFFFFFFFFn);
        const s = a & 3;
        let r;
        if (s === 0) r = (v & 0xFFFFFF00) | (w >>> 24);
        else if (s === 1) r = (v & 0xFFFF0000) | (w >>> 16);
        else if (s === 2) r = (v & 0xFF000000) | (w >>> 8);
        else r = w;
        this.gpr[(i >> 16) & 0x1F] = BigInt.asIntN(32, BigInt(r | 0));
    }

    opSWL(i) {
        const a = Number((this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF))) & 0xFFFFFFFFn);
        const w = this.mmu.read32(a & ~3);
        const v = Number(this.gpr[(i >> 16) & 0x1F] & 0xFFFFFFFFn);
        const s = a & 3;
        let r;
        if (s === 0) r = v;
        else if (s === 1) r = (w & 0xFF000000) | (v >>> 8);
        else if (s === 2) r = (w & 0xFFFF0000) | (v >>> 16);
        else r = (w & 0xFFFFFF00) | (v >>> 24);
        this.mmu.write32(a & ~3, r >>> 0);
    }

    opSWR(i) {
        const a = Number((this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF))) & 0xFFFFFFFFn);
        const w = this.mmu.read32(a & ~3);
        const v = Number(this.gpr[(i >> 16) & 0x1F] & 0xFFFFFFFFn);
        const s = a & 3;
        let r;
        if (s === 0) r = (w & 0x00FFFFFF) | (v << 24);
        else if (s === 1) r = (w & 0x0000FFFF) | (v << 16);
        else if (s === 2) r = (w & 0x000000FF) | (v << 8);
        else r = v;
        this.mmu.write32(a & ~3, r >>> 0);
    }

    opLDL(i) {
        const a = Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)));
        const d = this.mmu.read64(a & ~7);
        const v = BigInt.asUintN(64, this.gpr[(i >> 16) & 0x1F]);
        const s = a & 7;
        this.gpr[(i >> 16) & 0x1F] = BigInt.asIntN(64, (s === 0) ? d : ((v & ((1n << (BigInt(s) * 8n)) - 1n)) | (d << (BigInt(s) * 8n))));
    }

    opLDR(i) {
        const a = Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)));
        const d = this.mmu.read64(a & ~7);
        const v = BigInt.asUintN(64, this.gpr[(i >> 16) & 0x1F]);
        const s = a & 7;
        this.gpr[(i >> 16) & 0x1F] = BigInt.asIntN(64, (s === 7) ? d : ((v & ~((1n << (BigInt(s + 1) * 8n)) - 1n)) | (d >> (BigInt(7 - s) * 8n))));
    }

    opSDL(i) {
        const a = Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)));
        const d = this.mmu.read64(a & ~7);
        const v = BigInt.asUintN(64, this.gpr[(i >> 16) & 0x1F]);
        const s = a & 7;
        this.mmu.write64(a & ~7, (s === 0) ? v : (d & ~((1n << (BigInt(8 - s) * 8n)) - 1n)) | (v >> BigInt(s * 8)));
    }

    opSDR(i) {
        const a = Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)));
        const d = this.mmu.read64(a & ~7);
        const v = BigInt.asUintN(64, this.gpr[(i >> 16) & 0x1F]);
        const s = a & 7;
        this.mmu.write64(a & ~7, (s === 7) ? v : (d & ((1n << (BigInt(s + 1) * 8n)) - 1n)) | (v << BigInt((7 - s) * 8)));
    }

    opLL(i) { this.opLW(i); }
    opLLD(i) { this.opLD(i); }
    opSC(i) { this.opSW(i); this.gpr[(i >> 16) & 0x1F] = 1n; }
    opSCD(i) { this.opSD(i); this.gpr[(i >> 16) & 0x1F] = 1n; }

    getFprAddr32(fs) {
        const fr = (this.cp0Registers[12] & 0x04000000n) !== 0n;
        if (!fr && (fs & 1)) return (fs - 1) * 8; // Upper 32 bits of even register
        return fs * 8 + 4; // Lower 32 bits
    }

    opLWC1(i) {
        const addr = Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)));
        const fs = (i >> 16) & 0x1F;
        this.fprView.setUint32(this.getFprAddr32(fs), this.mmu.read32(addr), false);
    }

    opLDC1(i) {
        const addr = Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)));
        const fs = (i >> 16) & 0x1F;
        this.fprView.setBigUint64(fs * 8, this.mmu.read64(addr), false);
    }

    opSWC1(i) {
        const addr = Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)));
        const fs = (i >> 16) & 0x1F;
        this.mmu.write32(addr, this.fprView.getUint32(this.getFprAddr32(fs), false));
    }

    opSDC1(i) {
        const addr = Number(this.gpr[(i >> 21) & 0x1F] + BigInt.asIntN(16, BigInt(i & 0xFFFF)));
        const fs = (i >> 16) & 0x1F;
        this.mmu.write64(addr, this.fprView.getBigUint64(fs * 8, false));
    }

    opCOP1(i, pc, ds) {
        const sub = (i >> 21) & 0x1F, rt = (i >> 16) & 0x1F, fs = (i >> 11) & 0x1F, fd = (i >> 6) & 0x1F, f = i & 0x3F;

        if (sub === 0x08) { // Branch
            const c = (this.fcr31 & 0x00800000) !== 0;
            const t = (i >> 16) & 3;
            const imm = BigInt.asIntN(16, BigInt(i & 0xFFFF));
            let tk = (t === 0 && !c) || (t === 1 && c) || (t === 2 && !c) || (t === 3 && c);
            if (tk) {
                this.branchTarget = pc + 4n + (imm << 2n);
                this.branchTaken = true;
                return pc + 4n;
            } else if (t >= 2) { // Likely
                return pc + 8n;
            } else {
                this.branchTarget = pc + 8n;
                this.branchTaken = true;
                return pc + 4n;
            }
        }

        if (sub === 0x00) this.gpr[rt] = BigInt.asIntN(32, BigInt(this.fprView.getUint32(this.getFprAddr32(fs), false)));
        else if (sub === 0x01) this.gpr[rt] = this.fprView.getBigInt64(fs * 8, false);
        else if (sub === 0x04) this.fprView.setUint32(this.getFprAddr32(fs), Number(this.gpr[rt] & 0xFFFFFFFFn), false);
        else if (sub === 0x05) this.fprView.setBigInt64(fs * 8, this.gpr[rt], false);
        else if (sub === 0x02) this.gpr[rt] = BigInt.asIntN(32, BigInt(fs === 0 ? this.fcr0 : this.fcr31));
        else if (sub === 0x06) { if (fs === 31) this.fcr31 = Number(this.gpr[rt] & 0xFFFFFFFFn); }
        else if (sub >= 0x10) {
            const fmt = sub & 7;
            if (fmt === 0) { // S
                const v1 = this.fprView.getFloat32(fs * 8 + 4, false), v2 = this.fprView.getFloat32(rt * 8 + 4, false);
                if (f === 0x00) this.fprView.setFloat32(fd * 8 + 4, v1 + v2, false);
                else if (f === 0x01) this.fprView.setFloat32(fd * 8 + 4, v1 - v2, false);
                else if (f === 0x02) this.fprView.setFloat32(fd * 8 + 4, v1 * v2, false);
                else if (f === 0x03) this.fprView.setFloat32(fd * 8 + 4, v1 / v2, false);
                else if (f === 0x04) this.fprView.setFloat32(fd * 8 + 4, Math.sqrt(v1), false);
                else if (f === 0x05) this.fprView.setFloat32(fd * 8 + 4, Math.abs(v1), false);
                else if (f === 0x06) this.fprView.setFloat32(fd * 8 + 4, v1, false);
                else if (f === 0x07) this.fprView.setFloat32(fd * 8 + 4, -v1, false);
                else if (f === 0x0C) this.fprView.setInt32(fd * 8 + 4, Math.round(v1), false);
                else if (f === 0x0D) this.fprView.setInt32(fd * 8 + 4, Math.trunc(v1), false);
                else if (f === 0x0E) this.fprView.setInt32(fd * 8 + 4, Math.ceil(v1), false);
                else if (f === 0x0F) this.fprView.setInt32(fd * 8 + 4, Math.floor(v1), false);
                else if (f === 0x21) this.fprView.setFloat64(fd * 8, v1, false);
                else if (f === 0x24) this.fprView.setInt32(fd * 8 + 4, Math.trunc(v1), false);
                else if (f === 0x25) this.fprView.setBigInt64(fd * 8, BigInt(Math.trunc(v1)), false);
                else if ((f & 0x30) === 0x30) {
                    let cnd = false, n = isNaN(v1) || isNaN(v2);
                    switch (f & 0xF) {
                        case 0: cnd = false; break; case 1: cnd = n; break; case 2: cnd = !n && v1 === v2; break; case 3: cnd = n || v1 === v2; break;
                        case 4: cnd = !n && v1 < v2; break; case 5: cnd = n || v1 < v2; break; case 6: cnd = !n && v1 <= v2; break; case 7: cnd = n || v1 <= v2; break;
                        case 12: cnd = !n && v1 < v2; break; case 13: cnd = n || v1 < v2; break; case 14: cnd = !n && v1 <= v2; break; case 15: cnd = n || v1 <= v2; break;
                    }
                    if (cnd) this.fcr31 |= 0x00800000; else this.fcr31 &= ~0x00800000;
                }
            }
            else if (fmt === 1) { // D
                const v1 = this.fprView.getFloat64(fs * 8, false), v2 = this.fprView.getFloat64(rt * 8, false);
                if (f === 0x00) this.fprView.setFloat64(fd * 8, v1 + v2, false);
                else if (f === 0x01) this.fprView.setFloat64(fd * 8, v1 - v2, false);
                else if (f === 0x02) this.fprView.setFloat64(fd * 8, v1 * v2, false);
                else if (f === 0x03) this.fprView.setFloat64(fd * 8, v1 / v2, false);
                else if (f === 0x04) this.fprView.setFloat64(fd * 8, Math.sqrt(v1), false);
                else if (f === 0x05) this.fprView.setFloat64(fd * 8, Math.abs(v1), false);
                else if (f === 0x06) this.fprView.setFloat64(fd * 8, v1, false);
                else if (f === 0x07) this.fprView.setFloat64(fd * 8, -v1, false);
                else if (f === 0x0C) this.fprView.setInt32(fd * 8 + 4, Math.round(v1), false);
                else if (f === 0x0D) this.fprView.setInt32(fd * 8 + 4, Math.trunc(v1), false);
                else if (f === 0x0E) this.fprView.setInt32(fd * 8 + 4, Math.ceil(v1), false);
                else if (f === 0x0F) this.fprView.setInt32(fd * 8 + 4, Math.floor(v1), false);
                else if (f === 0x20) this.fprView.setFloat32(fd * 8 + 4, v1, false);
                else if (f === 0x24) this.fprView.setInt32(fd * 8 + 4, Math.trunc(v1), false);
                else if (f === 0x25) this.fprView.setBigInt64(fd * 8, BigInt(Math.trunc(v1)), false);
                else if ((f & 0x30) === 0x30) {
                    let cnd = false, n = isNaN(v1) || isNaN(v2);
                    switch (f & 0xF) {
                        case 0: cnd = false; break; case 1: cnd = n; break; case 2: cnd = !n && v1 === v2; break; case 3: cnd = n || v1 === v2; break;
                        case 4: cnd = !n && v1 < v2; break; case 5: cnd = n || v1 < v2; break; case 6: cnd = !n && v1 <= v2; break; case 7: cnd = n || v1 <= v2; break;
                        case 12: cnd = !n && v1 < v2; break; case 13: cnd = n || v1 < v2; break; case 14: cnd = !n && v1 <= v2; break; case 15: cnd = n || v1 <= v2; break;
                    }
                    if (cnd) this.fcr31 |= 0x00800000; else this.fcr31 &= ~0x00800000;
                }
            }
            else if (fmt === 4) { // W
                const v = this.fprView.getInt32(fs * 8 + 4, false);
                if (f === 0x20) this.fprView.setFloat32(fd * 8 + 4, v, false);
                else if (f === 0x21) this.fprView.setFloat64(fd * 8, v, false);
            }
            else if (fmt === 5) { // L
                const v = this.fprView.getBigInt64(fs * 8, false);
                if (f === 0x20) this.fprView.setFloat32(fd * 8 + 4, Number(v), false);
                else if (f === 0x21) this.fprView.setFloat64(fd * 8, Number(v), false);
            }
        }
        return pc + 4n;
    }

    opCOP0(i, pc, ds) {
        const sub = (i >> 21) & 0x1F, rt = (i >> 16) & 0x1F, rd = (i >> 11) & 0x1F;
        if (sub === 0x00) this.gpr[rt] = BigInt.asIntN(32, this.cp0Registers[rd]);
        else if (sub === 0x01) this.gpr[rt] = this.cp0Registers[rd];
        else if (sub === 0x04) {
            this.cp0Registers[rd] = BigInt.asIntN(32, this.gpr[rt]);
            if (rd === 11) this.cp0Registers[13] &= ~0x00008000n;
        }
        else if (sub === 0x05) {
            this.cp0Registers[rd] = this.gpr[rt];
            if (rd === 11) this.cp0Registers[13] &= ~0x00008000n;
        }
        else if (sub >= 0x10 && (i & 0x3F) === 0x18) { // ERET
            if (this.cp0Registers[12] & 4n) {
                this.pc = this.cp0Registers[30];
                this.cp0Registers[12] &= ~4n;
            } else {
                this.pc = this.cp0Registers[14];
                this.cp0Registers[12] &= ~2n;
            }
            return null;
        }
        return pc + 4n;
    }

    raiseException(code, pc, ds) {
        if (code === 0) console.log(`Interrupt at PC=0x${pc.toString(16)}`);
        if (code !== 0) {
            let instr = 0;
            try { instr = this.mmu.read32(Number(pc & ~3n)); } catch(e) {}
            console.warn(`Exception ${code} at PC=0x${pc.toString(16)} DS=${ds} Instr=0x${instr.toString(16)} Status=0x${this.cp0Registers[12].toString(16)} Cause=0x${this.cp0Registers[13].toString(16)}`);
            if (code === 13) {
                console.warn(`Trap Registers: v0=0x${this.gpr[2].toString(16)} a0=0x${this.gpr[4].toString(16)} a1=0x${this.gpr[5].toString(16)} ra=0x${this.gpr[31].toString(16)}`);
            }
            console.warn("PC History:", Array.from(this.pcHistory).map(x => x.toString(16)).join(", "));
        }
        const status = this.cp0Registers[12], bev = (status >> 22n) & 1n;
        const vector = bev ? 0xBFC00380n : 0x80000180n;
        this.cp0Registers[13] = (this.cp0Registers[13] & ~0x7Cn) | (BigInt(code) << 2n);

        if (!(status & 2n)) {
            if (ds) {
                this.cp0Registers[13] |= 0x80000000n;
                this.cp0Registers[14] = pc - 4n;
            } else {
                this.cp0Registers[13] &= ~0x80000000n;
                this.cp0Registers[14] = pc;
            }
            this.cp0Registers[12] |= 2n;
        }
        this.pc = vector;
        this.exceptionRaised = true;
        this.branchTaken = false;
        return null;
    }

    decompressMIO0(input, offset) {
        const view = new DataView(input, offset);
        if (view.getUint32(0, false) !== 0x4D494F30) return null;

        const destSize = view.getUint32(4, false);
        const compOffset = view.getUint32(8, false);
        const uncompOffset = view.getUint32(12, false);
        const output = new Uint8Array(destSize);

        let outIdx = 0, bitIdx = 0, compIdx = compOffset, uncompIdx = uncompOffset, ctrlIdx = 16;
        while (outIdx < destSize) {
            const bit = (view.getUint8(ctrlIdx + (bitIdx >> 3)) >> (7 - (bitIdx & 7))) & 1;
            bitIdx++;
            if (bit) {
                output[outIdx++] = view.getUint8(uncompIdx++);
            } else {
                const pair = view.getUint16(compIdx, false);
                compIdx += 2;
                const len = (pair >> 12) + 3;
                const dist = (pair & 0xFFF) + 1;
                let lOff = outIdx - dist;
                for (let i = 0; i < len && outIdx < destSize; i++) {
                    output[outIdx++] = (lOff >= 0) ? output[lOff++] : 0;
                }
            }
            if (bitIdx === 8 * (compOffset - 16)) break;
        }
        return output;
    }
}
