const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCoreClasses() {
    const context = {
        console: { log() {}, warn() {}, error() {} },
        ArrayBuffer,
        DataView,
        Uint8Array,
        Uint16Array,
        Uint32Array,
        Int8Array,
        Int16Array,
        Int32Array,
        Float32Array,
        Float64Array,
        BigInt64Array,
        BigUint64Array,
        BigInt
    };
    vm.createContext(context);

    const memoryCode = fs.readFileSync(path.join(__dirname, '..', 'memory.js'), 'utf8');
    const mmuCode = fs.readFileSync(path.join(__dirname, '..', 'mmu.js'), 'utf8');
    vm.runInContext(`${memoryCode}\nthis.Memory = Memory;`, context);
    vm.runInContext(`${mmuCode}\nthis.MMU = MMU;`, context);
    return { Memory: context.Memory, MMU: context.MMU };
}

function createMmu() {
    const { Memory, MMU } = loadCoreClasses();
    const memory = new Memory(8 * 1024 * 1024);
    return new MMU(memory);
}

test('PIF RAM tail reads do not throw and zero-fill bytes past 0x1FC007FF', () => {
    const mmu = createMmu();
    mmu.pifRam[0x3D] = 0xAA;
    mmu.pifRam[0x3E] = 0xBB;
    mmu.pifRam[0x3F] = 0xCC;

    assert.doesNotThrow(() => mmu.read32(0x1FC007FD));
    assert.equal(mmu.read32(0x1FC007FD), 0xAABBCC00);
});

test('PIF RAM tail writes do not throw and only update in-range bytes', () => {
    const mmu = createMmu();
    mmu.handlePifCommand = () => {};

    assert.doesNotThrow(() => mmu.write32(0x1FC007FD, 0x11223344));
    assert.equal(mmu.pifRam[0x3D], 0x11);
    assert.equal(mmu.pifRam[0x3E], 0x22);
    assert.equal(mmu.pifRam[0x3F], 0x33);
});

test('PIF command handler runs on SI completion when a 32-bit write overlaps command byte 0x3F', () => {
    const mmu = createMmu();
    mmu.cpu = { instructionCount: 0, cp0Registers: new Int32Array(32) };
    let commandHandled = false;
    mmu.handlePifCommand = () => { commandHandled = true; };

    mmu.write32(0x1FC007FD, 0x01020304);
    assert.equal(commandHandled, false);
    assert.equal(mmu.siDmaDirection, 3);
    assert.equal(mmu.siRegisters[6] & 0x01, 0x01);

    mmu.cpu.instructionCount = mmu.siBusyUntil;
    mmu.checkInternalEvents();

    assert.equal(commandHandled, true);
    assert.equal(mmu.siDmaDirection, 0);
    assert.equal(mmu.siRegisters[6] & 0x01, 0x00);
    assert.equal(mmu.miRegisters[2] & 0x02, 0x02);
});
