const test = require('node:test');
const assert = require('node:assert/strict');

const { decodeRgba5551, shouldRenderVideoFrame } = require('../video-utils.js');

test('decodeRgba5551 expands RGB5551 channels correctly', () => {
    const white = decodeRgba5551(0xFFFF);
    assert.equal(white.r, 255);
    assert.equal(white.g, 255);
    assert.equal(white.b, 255);
    assert.equal(white.a, 255);

    const blackTransparent = decodeRgba5551(0x0000);
    assert.equal(blackTransparent.r, 0);
    assert.equal(blackTransparent.g, 0);
    assert.equal(blackTransparent.b, 0);
    assert.equal(blackTransparent.a, 0);
});

test('shouldRenderVideoFrame blocks boot-noise origin when no graphics tasks have run', () => {
    const shouldBlock = shouldRenderVideoFrame({
        origin: 0x280,
        width: 320,
        type: 2,
        rspTaskCount: 0,
        rdpCommandCount: 0
    });
    assert.equal(shouldBlock, false);
});

test('shouldRenderVideoFrame allows normal frame origins and active graphics tasks', () => {
    const allowNormalOrigin = shouldRenderVideoFrame({
        origin: 0x100000,
        width: 320,
        type: 2,
        rspTaskCount: 0,
        rdpCommandCount: 0
    });
    assert.equal(allowNormalOrigin, true);

    const allowLowOriginWhenGpuActive = shouldRenderVideoFrame({
        origin: 0x280,
        width: 320,
        type: 2,
        rspTaskCount: 1,
        rdpCommandCount: 12
    });
    assert.equal(allowLowOriginWhenGpuActive, true);
});
