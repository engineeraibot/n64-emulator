// Self-contained tests for the new combiner + near-plane clipping logic.
// Mirrors what's in rcp.js. If rcp.js's algorithms change, update here too.

const test = require('node:test');
const assert = require('node:assert/strict');

function clamp255(v) {
    if (!isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 255) return 255;
    return v | 0;
}

function combineColor(state, shade, tex) {
    const hi = state.combine.hi;
    const lo = state.combine.lo;
    const prim = state.primColor >>> 0;
    const env  = state.envColor  >>> 0;
    const primRGBA = { r: (prim >>> 24) & 0xFF, g: (prim >>> 16) & 0xFF, b: (prim >>> 8) & 0xFF, a: prim & 0xFF };
    const envRGBA  = { r: (env  >>> 24) & 0xFF, g: (env  >>> 16) & 0xFF, b: (env  >>> 8) & 0xFF, a: env  & 0xFF };

    const colorSrc = (sel, ch) => {
        switch (sel & 0xF) {
            case 0: return 0;
            case 1: return tex[ch];
            case 2: return tex[ch];
            case 3: return primRGBA[ch];
            case 4: return shade[ch];
            case 5: return envRGBA[ch];
            case 6: return 255;
            case 7: return 0;
            default: return 0;
        }
    };
    const colorCSrc = (sel, ch) => {
        switch (sel & 0x1F) {
            case 0: return 0;
            case 1: return tex[ch];
            case 2: return tex[ch];
            case 3: return primRGBA[ch];
            case 4: return shade[ch];
            case 5: return envRGBA[ch];
            case 6: return 255;
            case 7: return 0;
            case 8: return tex.a;
            case 9: return tex.a;
            case 10: return primRGBA.a;
            case 11: return shade.a;
            case 12: return envRGBA.a;
            case 13: return 255;
            case 14: return 255;
            default: return 0;
        }
    };
    const alphaSrc = (sel) => {
        switch (sel & 0x7) {
            case 0: return 0;
            case 1: return tex.a;
            case 2: return tex.a;
            case 3: return primRGBA.a;
            case 4: return shade.a;
            case 5: return envRGBA.a;
            case 6: return 255;
            case 7: return 0;
        }
        return 0;
    };

    const cA = (hi >>> 20) & 0xF, cB = (lo >>> 28) & 0xF;
    const cC = (hi >>> 15) & 0x1F, cD = (lo >>> 15) & 0x7;
    const aA = (hi >>> 12) & 0x7, aB = (lo >>> 12) & 0x7;
    const aC = (hi >>> 9) & 0x7, aD = (lo >>> 9) & 0x7;

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
    const aOut = clamp255(((alphaSrc(aA) - alphaSrc(aB)) * alphaSrc(aC)) / 255 + alphaSrc(aD));
    return { r: compute('r'), g: compute('g'), b: compute('b'), a: aOut };
}

function encodeSetCombine({ cA, cB, cC, cD, aA, aB, aC, aD }) {
    const hi = ((cA & 0xF) << 20) | ((cC & 0x1F) << 15) | ((aA & 0x7) << 12) | ((aC & 0x7) << 9);
    const lo = ((cB & 0xF) << 28) | ((cD & 0x7) << 15) | ((aB & 0x7) << 12) | ((aD & 0x7) << 9);
    return { hi: hi >>> 0, lo: lo >>> 0 };
}

const newState = (overrides = {}) => ({
    combine: { hi: 0, lo: 0 },
    primColor: 0xFFFFFFFF,
    envColor: 0,
    ...overrides
});

test('combineColor MODULATERGBA (tex * shade) produces correct modulation', () => {
    const combine = encodeSetCombine({
        cA: 1, cB: 7, cC: 4, cD: 7,
        aA: 1, aB: 7, aC: 4, aD: 7
    });
    const state = newState({ combine });
    const tex = { r: 200, g: 100, b: 50, a: 255 };
    const shade = { r: 128, g: 128, b: 128, a: 200 };
    const out = combineColor(state, shade, tex);
    assert.equal(out.r, ((200 * 128) / 255) | 0);
    assert.equal(out.g, ((100 * 128) / 255) | 0);
    assert.equal(out.b, ((50 * 128) / 255) | 0);
    assert.equal(out.a, ((255 * 200) / 255) | 0);
});

test('combineColor SHADE-only passes shade through', () => {
    const combine = encodeSetCombine({
        cA: 7, cB: 7, cC: 7, cD: 4,
        aA: 7, aB: 7, aC: 7, aD: 4
    });
    const state = newState({ combine });
    const out = combineColor(state, { r: 200, g: 150, b: 100, a: 255 }, { r: 9, g: 9, b: 9, a: 9 });
    assert.equal(out.r, 200);
    assert.equal(out.g, 150);
    assert.equal(out.b, 100);
    assert.equal(out.a, 255);
});

test('combineColor DECAL ignores shade', () => {
    const combine = encodeSetCombine({
        cA: 7, cB: 7, cC: 7, cD: 1,
        aA: 7, aB: 7, aC: 7, aD: 4
    });
    const state = newState({ combine });
    const tex = { r: 200, g: 100, b: 50, a: 128 };
    const out = combineColor(state, { r: 1, g: 2, b: 3, a: 4 }, tex);
    assert.equal(out.r, 200);
    assert.equal(out.g, 100);
    assert.equal(out.b, 50);
    assert.equal(out.a, 4);
});

test('combineColor PRIMITIVE picks primColor channels', () => {
    const combine = encodeSetCombine({
        cA: 7, cB: 7, cC: 7, cD: 3,
        aA: 7, aB: 7, aC: 7, aD: 3
    });
    const state = newState({ combine, primColor: 0x10203040 });
    const out = combineColor(state, { r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 0 });
    assert.equal(out.r, 0x10);
    assert.equal(out.g, 0x20);
    assert.equal(out.b, 0x30);
    assert.equal(out.a, 0x40);
});

test('combineColor zero combiner falls back to shade*tex modulate', () => {
    const state = newState({ combine: { hi: 0, lo: 0 } });
    const out = combineColor(state, { r: 128, g: 64, b: 200, a: 200 }, { r: 255, g: 255, b: 255, a: 255 });
    assert.equal(out.r, 128);
    assert.equal(out.g, 64);
    assert.equal(out.b, 200);
    assert.equal(out.a, 200);
});

test('combineColor clamps overflow and underflow', () => {
    const c1 = encodeSetCombine({ cA: 6, cB: 7, cC: 6, cD: 6, aA: 6, aB: 7, aC: 6, aD: 6 });
    const o1 = combineColor(newState({ combine: c1 }), { r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 0 });
    assert.equal(o1.r, 255);
    assert.equal(o1.a, 255);
    const c2 = encodeSetCombine({ cA: 7, cB: 6, cC: 6, cD: 7, aA: 7, aB: 6, aC: 6, aD: 7 });
    const o2 = combineColor(newState({ combine: c2 }), { r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 0 });
    assert.equal(o2.r, 0);
    assert.equal(o2.a, 0);
});

function multiplyMatrices(a, b) {
    const res = new Array(16).fill(0);
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            res[r * 4 + c] = a[r*4+0]*b[0*4+c] + a[r*4+1]*b[1*4+c] + a[r*4+2]*b[2*4+c] + a[r*4+3]*b[3*4+c];
        }
    }
    return res;
}
function transformVertex(mvp, x, y, z) {
    return {
        tx: x*mvp[0] + y*mvp[4] + z*mvp[8]  + mvp[12],
        ty: x*mvp[1] + y*mvp[5] + z*mvp[9]  + mvp[13],
        tz: x*mvp[2] + y*mvp[6] + z*mvp[10] + mvp[14],
        tw: x*mvp[3] + y*mvp[7] + z*mvp[11] + mvp[15]
    };
}

test('libultra perspective row-vector convention: W = -z_eye for visible point', () => {
    const P = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, -1, -1,
        0, 0, -20.02, 0
    ];
    const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    const mvp = multiplyMatrices(I, P);
    const v = transformVertex(mvp, 10, 20, -100);
    assert.equal(v.tw, 100);
    assert.equal(v.tx, 10);
    assert.equal(v.ty, 20);
});

test('multiplyMatrices(mv, p) composes v_row * MV * P correctly', () => {
    const MV = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        5, -3, 7, 1
    ];
    const P = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    const mvp = multiplyMatrices(MV, P);
    const v = transformVertex(mvp, 100, 200, 300);
    assert.equal(v.tx, 105);
    assert.equal(v.ty, 197);
    assert.equal(v.tz, 307);
    assert.equal(v.tw, 1);
});

function clipTriangleNearPlane(v1, v2, v3) {
    const poly = [v1, v2, v3];
    let sign = 0;
    for (const v of poly) {
        const cw = v.cw !== undefined ? v.cw : v.w;
        if (Math.abs(cw) > 1e-4) { sign = cw > 0 ? 1 : -1; break; }
    }
    if (sign === 0) return [];
    const nearW = 1.0;
    const sw = (v) => sign * (v.cw !== undefined ? v.cw : v.w);
    const inside = (v) => sw(v) >= nearW;

    const lerp = (a, b, t) => {
        if (!isFinite(t)) t = 0;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const L = (x, y) => x + (y - x) * t;
        return { cx: L(a.cx, b.cx), cy: L(a.cy, b.cy), cz: L(a.cz, b.cz), cw: L(a.cw, b.cw) };
    };
    const out = [];
    for (let i = 0; i < poly.length; i++) {
        const curr = poly[i];
        const prev = poly[(i + poly.length - 1) % poly.length];
        if (inside(curr)) {
            if (!inside(prev)) out.push(lerp(prev, curr, (nearW - sw(prev)) / (sw(curr) - sw(prev))));
            out.push(curr);
        } else if (inside(prev)) {
            out.push(lerp(prev, curr, (nearW - sw(prev)) / (sw(curr) - sw(prev))));
        }
    }
    return out;
}

test('near-plane clip keeps fully-in-front triangle', () => {
    const tri = [
        { cx: 0, cy: 0, cz: 0, cw: 10 },
        { cx: 1, cy: 0, cz: 0, cw: 10 },
        { cx: 0, cy: 1, cz: 0, cw: 10 }
    ];
    assert.equal(clipTriangleNearPlane(tri[0], tri[1], tri[2]).length, 3);
});

test('near-plane clip culls fully-behind triangle', () => {
    const tri = [
        { cx: 0, cy: 0, cz: 0, cw: 0.5 },
        { cx: 1, cy: 0, cz: 0, cw: 0.4 },
        { cx: 0, cy: 1, cz: 0, cw: 0.1 }
    ];
    assert.equal(clipTriangleNearPlane(tri[0], tri[1], tri[2]).length, 0);
});

test('near-plane clip produces a quad from a straddling triangle', () => {
    const tri = [
        { cx: 0, cy: 0, cz: 0, cw: 0.1 },
        { cx: 1, cy: 0, cz: 0, cw: 10 },
        { cx: 0, cy: 1, cz: 0, cw: 10 }
    ];
    const out = clipTriangleNearPlane(tri[0], tri[1], tri[2]);
    assert.equal(out.length, 4);
    for (const v of out) assert.ok(v.cw >= 1.0 - 1e-9, 'cw=' + v.cw);
});

test('near-plane clip handles negative-W hemisphere symmetrically', () => {
    const tri = [
        { cx: 0, cy: 0, cz: 0, cw: -0.2 },
        { cx: 1, cy: 0, cz: 0, cw: -10 },
        { cx: 0, cy: 1, cz: 0, cw: -10 }
    ];
    const out = clipTriangleNearPlane(tri[0], tri[1], tri[2]);
    assert.equal(out.length, 4);
    for (const v of out) assert.ok(-v.cw >= 1.0 - 1e-9, 'cw=' + v.cw);
});

test('clamp255 handles NaN, negatives, and overflows', () => {
    assert.equal(clamp255(NaN), 0);
    assert.equal(clamp255(-10), 0);
    assert.equal(clamp255(0), 0);
    assert.equal(clamp255(127.6), 127);
    assert.equal(clamp255(255), 255);
    assert.equal(clamp255(500), 255);
});

function combinerUsesTexture(hi, lo) {
    const isTex4 = (s) => s === 1 || s === 2;
    const isTex5 = (s) => s === 1 || s === 2 || s === 8 || s === 9;
    const isTexA = (s) => s === 1 || s === 2;
    const colorA = (hi >> 20) & 0xF, colorB = (lo >> 28) & 0xF, colorC = (hi >> 15) & 0x1F, colorD = (lo >> 15) & 0x7;
    const alphaA = (hi >> 12) & 0x7, alphaB = (lo >> 12) & 0x7, alphaC = (hi >> 9) & 0x7, alphaD = (lo >> 9) & 0x7;
    return isTex4(colorA) || isTex4(colorB) || isTex5(colorC) || isTex4(colorD) ||
           isTexA(alphaA) || isTexA(alphaB) || isTexA(alphaC) || isTexA(alphaD);
}

test('combinerUsesTexture false for SHADE-only combiner', () => {
    const { hi, lo } = encodeSetCombine({ cA: 7, cB: 7, cC: 7, cD: 4, aA: 7, aB: 7, aC: 7, aD: 4 });
    assert.equal(combinerUsesTexture(hi, lo), false);
});

test('combinerUsesTexture true for MODULATERGBA', () => {
    const { hi, lo } = encodeSetCombine({ cA: 1, cB: 7, cC: 4, cD: 7, aA: 1, aB: 7, aC: 4, aD: 7 });
    assert.equal(combinerUsesTexture(hi, lo), true);
});

test('combinerUsesTexture true when color C picks TEXEL0_ALPHA (5-bit src 8)', () => {
    const { hi, lo } = encodeSetCombine({ cA: 7, cB: 7, cC: 8, cD: 4, aA: 7, aB: 7, aC: 7, aD: 4 });
    assert.equal(combinerUsesTexture(hi, lo), true);
});

test('combinerUsesTexture false for all-zero (COMBINED) combiner', () => {
    const { hi, lo } = encodeSetCombine({ cA: 0, cB: 0, cC: 0, cD: 0, aA: 0, aB: 0, aC: 0, aD: 0 });
    assert.equal(combinerUsesTexture(hi, lo), false);
});

function screenSignedArea(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

test('signed area positive for clockwise verts in Y-down screen space', () => {
    const a = { x: 10, y: 10 }, b = { x: 50, y: 10 }, c = { x: 30, y: 40 };
    assert.ok(screenSignedArea(a, b, c) > 0);
});

test('signed area negative for counter-clockwise verts in Y-down screen space', () => {
    const a = { x: 10, y: 10 }, b = { x: 30, y: 40 }, c = { x: 50, y: 10 };
    assert.ok(screenSignedArea(a, b, c) < 0);
});

// ---------- Lighting (ambient + directional N·L) ----------------------------
function computeLitShade(state, nx, ny, nz) {
    const lights = state.lights;
    const numLights = state.numLights | 0;
    let ambR, ambG, ambB, dirLights;
    if (lights && numLights > 0 && lights[numLights]) {
        const amb = lights[numLights];
        ambR = amb.r; ambG = amb.g; ambB = amb.b;
        dirLights = lights.slice(0, numLights);
    } else {
        ambR = 64; ambG = 64; ambB = 64;
        dirLights = [{ r: 200, g: 200, b: 200, dx: 0.4, dy: 0.7, dz: 0.6 }];
    }
    let R = ambR, G = ambG, B = ambB;
    for (const L of dirLights) {
        const dot = nx * L.dx + ny * L.dy + nz * L.dz;
        const k = dot > 0 ? dot : 0;
        R += L.r * k; G += L.g * k; B += L.b * k;
    }
    return {
        r: R > 255 ? 255 : (R < 0 ? 0 : R | 0),
        g: G > 255 ? 255 : (G < 0 ? 0 : G | 0),
        b: B > 255 ? 255 : (B < 0 ? 0 : B | 0)
    };
}

test('lighting default: surface facing light receives ambient + diffuse', () => {
    // Normal pointing at the default light (0.4, 0.7, 0.6) direction
    const dx = 0.4, dy = 0.7, dz = 0.6;
    const m = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const nx = dx/m, ny = dy/m, nz = dz/m;
    const out = computeLitShade({ lights: null, numLights: 0 }, nx, ny, nz);
    // Ambient (64) + diffuse (200 * dot = 200 * 1.0 = 200) = 264, clamped to 255
    assert.equal(out.r, 255);
    assert.equal(out.g, 255);
    assert.equal(out.b, 255);
});

test('lighting default: surface facing away receives only ambient', () => {
    // Normal opposite to default light direction
    const dx = -0.4, dy = -0.7, dz = -0.6;
    const m = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const nx = dx/m, ny = dy/m, nz = dz/m;
    const out = computeLitShade({ lights: null, numLights: 0 }, nx, ny, nz);
    assert.equal(out.r, 64);
    assert.equal(out.g, 64);
    assert.equal(out.b, 64);
});

test('lighting custom: configured lights override defaults', () => {
    const state = {
        numLights: 1,
        lights: [
            { r: 255, g: 0, b: 0, dx: 1, dy: 0, dz: 0 },  // red light from +X
            { r: 30, g: 30, b: 30 }                       // ambient
        ]
    };
    // Surface facing +X → full red diffuse + ambient
    const out = computeLitShade(state, 1, 0, 0);
    assert.equal(out.r, 30 + 255 > 255 ? 255 : 30 + 255);
    assert.equal(out.g, 30);
    assert.equal(out.b, 30);
});

test('lighting custom: N·L clamps to 0 for back-facing surface', () => {
    const state = {
        numLights: 1,
        lights: [
            { r: 255, g: 0, b: 0, dx: 1, dy: 0, dz: 0 },
            { r: 50, g: 50, b: 50 }
        ]
    };
    const out = computeLitShade(state, -1, 0, 0);  // facing -X
    assert.equal(out.r, 50);
    assert.equal(out.g, 50);
    assert.equal(out.b, 50);
});

// ---------- numLights decoding from G_MOVEWORD ------------------------------
function decodeNumLights(isF3DEX2, raw) {
    let n = isF3DEX2 ? Math.floor(raw / 24) : Math.floor(raw / 32) + 1;
    if (n < 0) n = 0;
    if (n > 8) n = 8;
    return n;
}

test('numLights decoding: Fast3D uses (n-1)*32 encoding', () => {
    assert.equal(decodeNumLights(false, 0),   1);   // 1 light
    assert.equal(decodeNumLights(false, 32),  2);   // 2 lights
    assert.equal(decodeNumLights(false, 64),  3);   // 3 lights
});

test('numLights decoding: F3DEX2 uses n*24 encoding', () => {
    assert.equal(decodeNumLights(true, 24),  1);
    assert.equal(decodeNumLights(true, 48),  2);
    assert.equal(decodeNumLights(true, 72),  3);
});

// ---------- projectClipToScreen depth monotone ------------------------------
// Replicates rcp.js projectClipToScreen depth math for testing. The screen Z
// must be monotonically increasing in |tw| so the depth test orders triangles.
function projectDepth(tw) {
    if (Math.abs(tw) <= 1e-6) return 0;
    return 1.0 - 1.0 / (1.0 + Math.abs(tw));
}

test('projectClipToScreen depth: monotone increasing in |tw|', () => {
    const a = projectDepth(2);
    const b = projectDepth(5);
    const c = projectDepth(20);
    assert.ok(a < b, 'closer (|tw|=2) should map to smaller sz than |tw|=5');
    assert.ok(b < c, 'midrange (|tw|=5) should map to smaller sz than |tw|=20');
});

test('projectClipToScreen depth: bounded to [0, 1)', () => {
    for (const tw of [0.5, 2, 8, 100, 1e6]) {
        const sz = projectDepth(tw);
        assert.ok(sz >= 0 && sz < 1, `tw=${tw} -> sz=${sz} should be in [0, 1)`);
    }
});

test('projectClipToScreen depth: handles negative tw via |tw|', () => {
    assert.equal(projectDepth(-8), projectDepth(8));
    assert.equal(projectDepth(-100), projectDepth(100));
});

test('projectClipToScreen depth: clamps tw near zero to sz=0', () => {
    assert.equal(projectDepth(0), 0);
    assert.equal(projectDepth(1e-7), 0);
});

// ---------- fillrect inclusive-bounds ---------------------------------------
// Replicates the new rcp.js handleG_FILLRECT row/col iteration semantics.
// The old code used `<` upper bound (lost the last row & column); the new code
// uses `<=` so a (0,0)-(w-1,h-1) call covers the full screen.
function fillSpan(x1Q102, y1Q102, x2Q102, y2Q102, width, height) {
    const yStart = Math.max(0, Math.floor(y1Q102 / 4));
    const yEnd   = Math.min(height - 1, Math.floor(y2Q102 / 4));
    const xStart = Math.max(0, Math.floor(x1Q102 / 4));
    const xEnd   = Math.min(width - 1, Math.floor(x2Q102 / 4));
    const cells = [];
    for (let y = yStart; y <= yEnd; y++)
        for (let x = xStart; x <= xEnd; x++)
            cells.push([x, y]);
    return cells;
}

test('handleG_FILLRECT: full-screen rect covers every pixel inclusively', () => {
    // libultra gDPFillRectangle(0, 0, 319, 239) -> Q10.2 (0,0)-(1276,956)
    const cells = fillSpan(0, 0, 1276, 956, 320, 240);
    assert.equal(cells.length, 320 * 240, 'inclusive bounds should cover full screen');
    assert.deepEqual(cells[0], [0, 0]);
    assert.deepEqual(cells[cells.length - 1], [319, 239]);
});

test('handleG_FILLRECT: 1-pixel rect covers exactly one pixel', () => {
    const cells = fillSpan(40, 40, 40, 40, 320, 240); // x=10, y=10 inclusive
    assert.equal(cells.length, 1);
    assert.deepEqual(cells[0], [10, 10]);
});

test('handleG_FILLRECT: clamps to framebuffer bounds', () => {
    // Out-of-range request: floor(-4/4) = -1 (clamped to 0); floor(1500/4)=375 (clamped to w-1)
    const cells = fillSpan(-4, -4, 1500, 1100, 320, 240);
    assert.equal(cells.length, 320 * 240);
});

// ---------- drawTriangle off-screen reject ----------------------------------
function isOffscreenAABB(v1, v2, v3, w, h) {
    if (v1.x < 0 && v2.x < 0 && v3.x < 0) return true;
    if (v1.x >= w && v2.x >= w && v3.x >= w) return true;
    if (v1.y < 0 && v2.y < 0 && v3.y < 0) return true;
    if (v1.y >= h && v2.y >= h && v3.y >= h) return true;
    return false;
}

test('drawTriangle off-screen AABB: all-left triangle rejected', () => {
    const v1 = { x: -50, y: 100 }, v2 = { x: -10, y: 50 }, v3 = { x: -200, y: 150 };
    assert.equal(isOffscreenAABB(v1, v2, v3, 320, 240), true);
});

test('drawTriangle off-screen AABB: straddling triangle NOT rejected', () => {
    const v1 = { x: -50, y: 100 }, v2 = { x: 50, y: 50 }, v3 = { x: 0, y: 200 };
    assert.equal(isOffscreenAABB(v1, v2, v3, 320, 240), false);
});

test('drawTriangle off-screen AABB: all-right of screen rejected', () => {
    const v1 = { x: 400, y: 100 }, v2 = { x: 350, y: 50 }, v3 = { x: 500, y: 150 };
    assert.equal(isOffscreenAABB(v1, v2, v3, 320, 240), true);
});

test('drawTriangle off-screen AABB: all-above of screen rejected', () => {
    const v1 = { x: 100, y: -10 }, v2 = { x: 200, y: -50 }, v3 = { x: 50, y: -200 };
    assert.equal(isOffscreenAABB(v1, v2, v3, 320, 240), true);
});

test('drawTriangle off-screen AABB: all-below of screen rejected', () => {
    const v1 = { x: 100, y: 250 }, v2 = { x: 200, y: 300 }, v3 = { x: 50, y: 500 };
    assert.equal(isOffscreenAABB(v1, v2, v3, 320, 240), true);
});

test('drawTriangle off-screen AABB: visible triangle NOT rejected', () => {
    const v1 = { x: 100, y: 100 }, v2 = { x: 200, y: 150 }, v3 = { x: 150, y: 200 };
    assert.equal(isOffscreenAABB(v1, v2, v3, 320, 240), false);
});
