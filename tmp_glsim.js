// tmp_glsim.js — Task #40 verification: a software WebGL1 stub ("FakeGL") that
// implements exactly the subset of the WebGL API gl-renderer.js uses, plus a JS
// twin of its two shaders. N64GLRenderer runs UNMODIFIED against this, so the
// whole capture/batch/texture/uniform path is exercised end-to-end in node and
// the output can be compared against the software-RDP PNG baselines.
//
// GPU semantics modeled: pixel-center sampling, perspective-correct varyings
// (sum(v*b/w)/sum(b/w)), screen-linear depth, LEQUAL depth test, fixed-function
// blending (SRC_ALPHA/CONSTANT_ALPHA factor sets), scissored clears, shared
// depth renderbuffers. Not modeled: MSAA, exact fill rules, derivatives.
'use strict';

const GL = {
    VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82,
    ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88E4, DYNAMIC_DRAW: 0x88E8,
    TEXTURE_2D: 0x0DE1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, FLOAT: 0x1406,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, NEAREST: 0x2600, CLAMP_TO_EDGE: 0x812F,
    FRAMEBUFFER: 0x8D40, COLOR_ATTACHMENT0: 0x8CE0, DEPTH_ATTACHMENT: 0x8D00,
    RENDERBUFFER: 0x8D41, DEPTH_COMPONENT16: 0x81A5,
    COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x100,
    SCISSOR_TEST: 0x0C11, DEPTH_TEST: 0x0B71, BLEND: 0x0BE2, LEQUAL: 0x0203,
    ZERO: 0, ONE: 1, SRC_ALPHA: 0x302, ONE_MINUS_SRC_ALPHA: 0x303,
    DST_ALPHA: 0x304, ONE_MINUS_DST_ALPHA: 0x305,
    CONSTANT_ALPHA: 0x8003, ONE_MINUS_CONSTANT_ALPHA: 0x8004,
    TEXTURE0: 0x84C0, TRIANGLES: 4, UNPACK_ALIGNMENT: 0x0CF5
};

class FakeGL {
    constructor(width, height) {
        Object.assign(this, GL);
        this.drawingBufferWidth = width; this.drawingBufferHeight = height;
        this._canvasPixels = new Uint8Array(width * height * 4);
        this._progSeq = 0;
        this._curProg = null;
        this._buffers = new Map(); this._curArrayBuf = null;
        this._curTex = null; this._curFbo = null; this._curRb = null;
        this._attribs = {};        // idx -> {buf, size, stride, offset, enabled}
        this._clearColor = [0,0,0,1]; this._clearDepth = 1;
        this._scissorOn = false; this._scissor = [0,0,width,height];
        this._depthTest = false; this._depthMask = true;
        this._blendOn = false; this._blendSrc = GL.ONE; this._blendDst = GL.ZERO;
        this._blendColor = [0,0,0,0];
        this._viewport = [0,0,width,height];
        this.stats = { draws: 0, pixels: 0 };
    }
    // shaders/programs --------------------------------------------------------
    createShader(t) { return { type: t, src: '' }; }
    shaderSource(s, src) { s.src = src; }
    compileShader() {}
    getShaderParameter() { return true; }
    getShaderInfoLog() { return ''; }
    createProgram() { return { id: this._progSeq++, uniforms: {}, attrs: { aPos: 0, aCol: 1, aST: 2, aP: 0 } }; }
    attachShader() {}
    linkProgram() {}
    getProgramParameter() { return true; }
    getProgramInfoLog() { return ''; }
    getUniformLocation(p, name) { return { p, name }; }
    getAttribLocation(p, name) { return p.attrs[name] !== undefined ? p.attrs[name] : -1; }
    useProgram(p) { this._curProg = p; }
    uniform1i(l, v) { if (l) l.p.uniforms[l.name] = v; }
    uniform2f(l, a, b) { if (l) l.p.uniforms[l.name] = [a, b]; }
    uniform4f(l, a, b, c, d) { if (l) l.p.uniforms[l.name] = [a, b, c, d]; }
    uniform4i(l, a, b, c, d) { if (l) l.p.uniforms[l.name] = [a, b, c, d]; }
    uniform4fv(l, v) { if (l) l.p.uniforms[l.name] = Array.from(v); }
    // buffers -----------------------------------------------------------------
    createBuffer() { return { data: null }; }
    bindBuffer(t, b) { if (t === GL.ARRAY_BUFFER) this._curArrayBuf = b; }
    bufferData(t, data, usage) { if (t === GL.ARRAY_BUFFER && this._curArrayBuf) this._curArrayBuf.data = new Float32Array(data); }
    enableVertexAttribArray(i) { (this._attribs[i] = this._attribs[i] || {}).enabled = true; }
    disableVertexAttribArray(i) { if (this._attribs[i]) this._attribs[i].enabled = false; }
    vertexAttribPointer(i, size, type, norm, stride, offset) {
        const a = this._attribs[i] = this._attribs[i] || {};
        a.buf = this._curArrayBuf; a.size = size; a.stride = stride / 4; a.offset = offset / 4;
    }
    // textures ----------------------------------------------------------------
    createTexture() { return { pixels: null, W: 0, H: 0 }; }
    bindTexture(t, tex) { this._curTex = tex; }
    activeTexture() {}
    pixelStorei() {}
    texParameteri() {}
    texImage2D(t, lvl, ifmt, w, h, border, fmt, type, pixels) {
        this._curTex.W = w; this._curTex.H = h;
        this._curTex.pixels = pixels ? new Uint8Array(pixels) : new Uint8Array(w * h * 4);
    }
    deleteTexture() {}
    // fbos / renderbuffers ----------------------------------------------------
    createFramebuffer() { return { colorTex: null, depthRb: null }; }
    bindFramebuffer(t, f) { this._curFbo = f; }
    framebufferTexture2D(t, att, tt, tex) { this._curFbo.colorTex = tex; }
    createRenderbuffer() { return { depth: null, W: 0, H: 0 }; }
    bindRenderbuffer(t, rb) { this._curRb = rb; }
    renderbufferStorage(t, fmt, w, h) { this._curRb.W = w; this._curRb.H = h; this._curRb.depth = new Float32Array(w * h).fill(1); }
    framebufferRenderbuffer(t, att, rt, rb) { this._curFbo.depthRb = rb; }
    // state -------------------------------------------------------------------
    viewport(x, y, w, h) { this._viewport = [x, y, w, h]; }
    scissor(x, y, w, h) { this._scissor = [x, y, w, h]; }
    enable(c) { if (c === GL.SCISSOR_TEST) this._scissorOn = true; else if (c === GL.DEPTH_TEST) this._depthTest = true; else if (c === GL.BLEND) this._blendOn = true; }
    disable(c) { if (c === GL.SCISSOR_TEST) this._scissorOn = false; else if (c === GL.DEPTH_TEST) this._depthTest = false; else if (c === GL.BLEND) this._blendOn = false; }
    depthFunc() {}
    getError() { return 0; }
    depthMask(v) { this._depthMask = !!v; }
    blendFunc(s, d) { this._blendSrc = s; this._blendDst = d; }
    blendColor(r, g, b, a) { this._blendColor = [r, g, b, a]; }
    clearColor(r, g, b, a) { this._clearColor = [r, g, b, a]; }
    clearDepth(v) { this._clearDepth = v; }
    clear(bits) {
        const target = this._targetPixels();
        const [tw, th] = this._targetSize();
        let x0 = 0, y0 = 0, x1 = tw, y1 = th;
        if (this._scissorOn) {
            x0 = Math.max(0, this._scissor[0]); y0 = Math.max(0, this._scissor[1]);
            x1 = Math.min(tw, this._scissor[0] + this._scissor[2]); y1 = Math.min(th, this._scissor[1] + this._scissor[3]);
        }
        if (bits & GL.COLOR_BUFFER_BIT) {
            const [r, g, b, a] = this._clearColor.map(v => Math.round(v * 255));
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
                const o = (y * tw + x) * 4;
                target[o] = r; target[o+1] = g; target[o+2] = b; target[o+3] = a;
            }
        }
        if ((bits & GL.DEPTH_BUFFER_BIT) && this._curFbo && this._curFbo.depthRb && this._curFbo.depthRb.depth) {
            const d = this._curFbo.depthRb.depth;
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d[y * tw + x] = this._clearDepth;
        }
    }
    readPixels(x, y, w, h, fmt, type, out) {
        const target = this._targetPixels();
        const [tw] = this._targetSize();
        for (let yy = 0; yy < h; yy++) {
            const src = ((y + yy) * tw + x) * 4;
            out.set(target.subarray(src, src + w * 4), yy * w * 4);
        }
    }
    _targetPixels() {
        if (this._curFbo && this._curFbo.colorTex) return this._curFbo.colorTex.pixels;
        return this._canvasPixels;
    }
    _targetSize() {
        if (this._curFbo && this._curFbo.colorTex) return [this._curFbo.colorTex.W, this._curFbo.colorTex.H];
        return [this.drawingBufferWidth, this.drawingBufferHeight];
    }

    // ------------------------------------------------------------- rasterizer
    _attr(idx, vi) {
        const a = this._attribs[idx];
        const base = a.offset + vi * a.stride;
        return a.buf.data.subarray(base, base + a.size);
    }

    drawArrays(mode, first, count) {
        const u = this._curProg.uniforms;
        if (this._curProg.id !== 0) return; // present prog: not needed for harness readback
        const target = this._targetPixels();
        const [tw, th] = this._targetSize();
        const depth = (this._curFbo && this._curFbo.depthRb) ? this._curFbo.depthRb.depth : null;
        const [vx, vy, vw, vh] = this._viewport;
        this.stats.draws++;

        for (let t = first; t + 2 < first + count; t += 3) {
            // vertex shader twin
            const V = [];
            for (let k = 0; k < 3; k++) {
                const pos = this._attr(0, t + k), col = this._attr(1, t + k), st = this._attr(2, t + k);
                const w = Math.max(pos[3], 1e-4);
                const nx = ((pos[0] + 0.5) / u.uFbSize[0]) * 2 - 1;
                const ny = 1 - ((pos[1] + 0.5) / u.uFbSize[1]) * 2;
                const nz = pos[2] * 2 - 1;
                V.push({
                    // window coords (GL: y up, origin bottom-left of viewport)
                    wx: vx + (nx + 1) / 2 * vw,
                    wy: vy + (ny + 1) / 2 * vh,
                    z01: (nz + 1) / 2,
                    invW: 1 / w,
                    colW: [col[0] * w, col[1] * w, col[2] * w, col[3] * w],
                    vW: w,
                    st: [st[0], st[1]]
                });
            }
            const [A, B, C] = V;
            const det = (B.wy - C.wy) * (A.wx - C.wx) + (C.wx - B.wx) * (A.wy - C.wy);
            if (Math.abs(det) < 1e-9) continue;
            let minX = Math.max(Math.floor(Math.min(A.wx, B.wx, C.wx)), Math.max(0, vx));
            let maxX = Math.min(Math.ceil(Math.max(A.wx, B.wx, C.wx)), Math.min(tw, vx + vw));
            let minY = Math.max(Math.floor(Math.min(A.wy, B.wy, C.wy)), Math.max(0, vy));
            let maxY = Math.min(Math.ceil(Math.max(A.wy, B.wy, C.wy)), Math.min(th, vy + vh));
            for (let py = minY; py < maxY; py++) {
                const cy = py + 0.5;
                for (let px = minX; px < maxX; px++) {
                    const cx = px + 0.5;
                    const b0 = ((B.wy - C.wy) * (cx - C.wx) + (C.wx - B.wx) * (cy - C.wy)) / det;
                    const b1 = ((C.wy - A.wy) * (cx - C.wx) + (A.wx - C.wx) * (cy - C.wy)) / det;
                    const b2 = 1 - b0 - b1;
                    if (b0 < 0 || b1 < 0 || b2 < 0) continue;
                    // depth: screen-linear; varyings: perspective-correct
                    const z = A.z01 * b0 + B.z01 * b1 + C.z01 * b2;
                    const o = py * tw + px;
                    if (this._depthTest && depth) {
                        if (z > depth[o]) continue;
                    }
                    const pw = A.invW * b0 + B.invW * b1 + C.invW * b2; // sum(b/w)
                    const pc = (i) => (A.colW[i] * A.invW * b0 + B.colW[i] * B.invW * b1 + C.colW[i] * C.invW * b2) / pw;
                    const vColW = [pc(0), pc(1), pc(2), pc(3)];
                    const vW = (A.vW * A.invW * b0 + B.vW * B.invW * b1 + C.vW * C.invW * b2) / pw;
                    const vST = [
                        (A.st[0] * A.invW * b0 + B.st[0] * B.invW * b1 + C.st[0] * C.invW * b2) / pw,
                        (A.st[1] * A.invW * b0 + B.st[1] * B.invW * b1 + C.st[1] * C.invW * b2) / pw
                    ];
                    const frag = fragmentShader(u, this._boundTexture, vColW, vW, vST);
                    if (!frag) continue; // discard
                    if (this._depthTest && depth && this._depthMask) depth[o] = z;
                    const oo = o * 4;
                    let [r, g, b, a] = frag; // 0..1
                    if (this._blendOn) {
                        const dr = target[oo] / 255, dg = target[oo+1] / 255, db = target[oo+2] / 255, da = target[oo+3] / 255;
                        const f = (factor, sa, dsta) => {
                            switch (factor) {
                                case GL.ONE: return 1; case GL.ZERO: return 0;
                                case GL.SRC_ALPHA: return sa; case GL.ONE_MINUS_SRC_ALPHA: return 1 - sa;
                                case GL.DST_ALPHA: return dsta; case GL.ONE_MINUS_DST_ALPHA: return 1 - dsta;
                                case GL.CONSTANT_ALPHA: return this._blendColor[3];
                                case GL.ONE_MINUS_CONSTANT_ALPHA: return 1 - this._blendColor[3];
                            }
                            return 1;
                        };
                        const sf = f(this._blendSrc, a, da), df = f(this._blendDst, a, da);
                        r = r * sf + dr * df; g = g * sf + dg * df; b = b * sf + db * df; a = a * sf + da * df;
                    }
                    target[oo]   = Math.max(0, Math.min(255, Math.round(r * 255)));
                    target[oo+1] = Math.max(0, Math.min(255, Math.round(g * 255)));
                    target[oo+2] = Math.max(0, Math.min(255, Math.round(b * 255)));
                    target[oo+3] = Math.max(0, Math.min(255, Math.round(a * 255)));
                    this.stats.pixels++;
                }
            }
        }
    }
    get _boundTexture() { return this._curTex; }
}

// ------------------------------ fragment shader twin (mirrors FS in gl-renderer.js)
function texAddr(c, mask, cm, size) {
    if (cm >= 2) {
        const hi = size > 0 ? size - 1 : (mask > 0 ? Math.pow(2, mask) - 1 : 1023);
        return Math.min(Math.max(c, 0), hi);
    }
    if (mask > 0) {
        const wrap = Math.pow(2, mask);
        if (cm % 2 >= 1) {
            const period = 2 * wrap;
            let m = c % period; if (m < 0) m += period;
            return m < wrap ? m : period - 1 - m;
        }
        let m = c % wrap; if (m < 0) m += wrap;
        return m;
    }
    if (size > 0) return Math.min(Math.max(c, 0), size - 1);
    let m = c % 1024; if (m < 0) m += 1024;
    return m;
}
function fetchTexelI(u, tex, i, j) {
    let ts = texAddr(i, u.uAddrS[0], u.uAddrS[1], u.uAddrS[2]);
    let tt = texAddr(j, u.uAddrT[0], u.uAddrT[1], u.uAddrT[2]);
    ts = Math.min(Math.max(ts, 0), u.uTexSize[0] - 1);
    tt = Math.min(Math.max(tt, 0), u.uTexSize[1] - 1);
    const o = ((tt | 0) * tex.W + (ts | 0)) * 4;
    return [tex.pixels[o], tex.pixels[o+1], tex.pixels[o+2], tex.pixels[o+3]];
}
// Twin of the shader's 3-point bilinear (Task #45).
function fetchTexel(u, tex, st) {
    const bx = Math.floor(st[0]), by = Math.floor(st[1]);
    if (!u.uBilerp) return fetchTexelI(u, tex, bx, by);
    const fx = st[0] - bx, fy = st[1] - by;
    const t00 = fetchTexelI(u, tex, bx, by);
    const t10 = fetchTexelI(u, tex, bx + 1, by);
    const t01 = fetchTexelI(u, tex, bx, by + 1);
    const out = [0, 0, 0, 0];
    if (fx + fy <= 1) {
        for (let k = 0; k < 4; k++) out[k] = t00[k] + fx * (t10[k] - t00[k]) + fy * (t01[k] - t00[k]);
    } else {
        const t11 = fetchTexelI(u, tex, bx + 1, by + 1);
        for (let k = 0; k < 4; k++) out[k] = t11[k] + (1 - fx) * (t01[k] - t11[k]) + (1 - fy) * (t10[k] - t11[k]);
    }
    return out;
}
const clampc = (v) => Math.min(Math.max(v, 0), 255);
function cs4(u, sel, t, s, c1, comb) {
    if (sel === 0) return c1 ? comb : [0,0,0];
    if (sel === 1 || sel === 2) return t;
    if (sel === 3) return u.uPrim.slice(0,3);
    if (sel === 4) return s;
    if (sel === 5) return u.uEnv.slice(0,3);
    if (sel === 6) return [255,255,255];
    return [0,0,0];
}
function cs5(u, sel, t, s, ta, sa, c1, comb, combA) {
    if (sel === 0) return c1 ? comb : [0,0,0];
    if (sel === 1 || sel === 2) return t;
    if (sel === 3) return u.uPrim.slice(0,3);
    if (sel === 4) return s;
    if (sel === 5) return u.uEnv.slice(0,3);
    if (sel === 6) return [255,255,255];
    if (sel === 7) return c1 ? [combA,combA,combA] : [0,0,0];
    if (sel === 8 || sel === 9) return [ta,ta,ta];
    if (sel === 10) return [u.uPrim[3],u.uPrim[3],u.uPrim[3]];
    if (sel === 11) return [sa,sa,sa];
    if (sel === 12) return [u.uEnv[3],u.uEnv[3],u.uEnv[3]];
    if (sel === 13 || sel === 14) return [255,255,255];
    return [0,0,0];
}
function asel(u, sel, ta, sa, c1, comb) {
    if (sel === 0) return c1 ? comb : 0;
    if (sel === 1 || sel === 2) return ta;
    if (sel === 3) return u.uPrim[3];
    if (sel === 4) return sa;
    if (sel === 5) return u.uEnv[3];
    if (sel === 6) return 255;
    return 0;
}
function combineCycle(u, cm, am, tex, shade, c1, comb, combA) {
    const A = cs4(u, cm[0], tex, shade, c1, comb), B = cs4(u, cm[1], tex, shade, c1, comb);
    const Cc = cs5(u, cm[2], tex, shade, tex[3], shade[3], c1, comb, combA), D = cs4(u, cm[3], tex, shade, c1, comb);
    const rgb = [0,1,2].map(i => clampc((A[i] - B[i]) * Cc[i] / 255 + D[i]));
    const a = clampc((asel(u, am[0], tex[3], shade[3], c1, combA) - asel(u, am[1], tex[3], shade[3], c1, combA)) *
                     asel(u, am[2], tex[3], shade[3], c1, combA) / 255 + asel(u, am[3], tex[3], shade[3], c1, combA));
    return { rgb, a };
}
function blSel(u, sel, px) {
    if (sel === 2) return u.uBlendC.slice(0,3);
    if (sel === 3) return u.uFog.slice(0,3);
    return px;
}
function blendCycle(u, mux, px, pixA, shadeA) {
    let A;
    if (mux[1] === 0) A = pixA / 255;
    else if (mux[1] === 1) A = u.uFog[3] / 255;
    else if (mux[1] === 2) A = shadeA / 255;
    else A = 0;
    let B;
    if (mux[3] === 0) B = 1 - A;
    else if (mux[3] === 2) B = 1;
    else B = 0;
    const P = blSel(u, mux[0], px), M = blSel(u, mux[2], px);
    return [0,1,2].map(i => clampc(P[i] * A + M[i] * B));
}
function fragmentShader(u, tex, vColW, vW, vST) {
    const shade = vColW.map(v => clampc(v / Math.max(vW, 1e-6)));
    const t = (u.uUseTex && tex && tex.pixels) ? fetchTexel(u, tex, vST) : [255,255,255,255];
    let rgb, a;
    if (u.uMode === 2) {
        if (u.uCopyGate && t[3] < 1) return null;
        rgb = [t[0], t[1], t[2]]; a = t[3];
    } else if (u.uMode === 1) {
        const c0 = combineCycle(u, u.uCmbC0, u.uCmbA0, t, shade, false, [0,0,0], 0);
        if (u.uC2) {
            const c1 = combineCycle(u, u.uCmbC1, u.uCmbA1, t, shade, true, c0.rgb, c0.a);
            rgb = c1.rgb; a = c1.a;
        } else { rgb = c0.rgb; a = c0.a; }
    } else {
        if (u.uUseTex) {
            rgb = [0,1,2].map(i => clampc(shade[i] * t[i] / 255));
            a = clampc(shade[3] * t[3] / 255);
        } else { rgb = shade.slice(0,3); a = shade[3]; }
    }
    if (u.uAlphaGate === 1 && a < 1) return null;
    const pixA = (u.uCvgSel && u.uUseTex) ? t[3] : a;
    if (u.uBl0On) rgb = blendCycle(u, u.uBl0, rgb, pixA, shade[3]);
    if (u.uBl1On) rgb = blendCycle(u, u.uBl1, rgb, pixA, shade[3]);
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, pixA / 255];
}

function makeFakeCanvas(width, height) {
    const gl = new FakeGL(width, height);
    return { width, height, getContext: () => gl, _gl: gl };
}

module.exports = { FakeGL, makeFakeCanvas };
