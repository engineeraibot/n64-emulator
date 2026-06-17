// gl-renderer.js — Task #40: WebGL triangle-batch renderer for real-time browser play.
//
// The software RDP in rcp.js is the byte-exact verification reference; this renderer
// replaces ONLY the per-pixel rasterization (measured at 81% of in-game wall time,
// Task #39). rcp.js still interprets display lists, transforms/lights/clips vertices
// and decodes all RDP state exactly as before; when rcp.glr is set, drawTriangle /
// handleG_TEXRECT / handleG_FILLRECT hand the post-clip primitives here instead of
// running the software per-pixel loop.
//
// Mapping of the SW pipeline onto GL:
//   - Screen-space verts (x,y px, z 0..1, |w|) -> gl_Position = (ndc*w, (2z-1)*w, w)
//     so the GPU's perspective-correct varyings reproduce the SW sOverW/invW math.
//     Shade is interpolated SCREEN-LINEARLY in SW (and on real RDP hardware), so the
//     shade varying is passed pre-multiplied by w and divided by interpolated w.
//   - sampleTexture()'s TMEM formats are decoded to RGBA8 textures (same flat-TMEM
//     reads); mask/mirror/clamp addressing runs in the fragment shader (texAddr()
//     mirrors applyTexAddr()). Tile shift folds into the per-vertex texel coords.
//   - The 1/2-cycle combiner runs generically in the fragment shader ((A-B)*C/255+D,
//     TEXEL1 aliases TEXEL0 like the SW renderer).
//   - Blender: cycles that don't read the framebuffer run in the shader (e.g. the
//     2-cycle G_RM_FOG_SHADE_A fog cycle); the (at most one) memory cycle maps to
//     fixed-function GL blending. This matches blendPixel()'s approximations.
//   - One FBO per (colorImage addr, width, depthImage addr); FILLRECT to the depth
//     image becomes a depth clear, FILLRECT to a color image a scissored color clear.
//     present(viOrigin) blits the FBO the VI is scanning out onto the canvas.
//
// NOT byte-exact with the SW renderer (GPU float interpolation); verified visually
// against the SW PNG baselines instead (title / SELECT FILE / state_playable).

(function () {
'use strict';

const VS = `
attribute vec4 aPos;   // x,y in pixels, z 0..1, w (positive)
attribute vec4 aCol;   // 0..255
attribute vec2 aST;    // texel units (scale+shift folded in)
uniform vec2 uFbSize;
varying vec4 vColW;
varying float vW;
varying vec2 vST;
void main() {
  float w = max(aPos.w, 1e-4);
  float nx = ((aPos.x + 0.5) / uFbSize.x) * 2.0 - 1.0;
  float ny = 1.0 - ((aPos.y + 0.5) / uFbSize.y) * 2.0;
  gl_Position = vec4(nx * w, ny * w, (aPos.z * 2.0 - 1.0) * w, w);
  vColW = aCol * w;
  vW = w;
  vST = aST;
}
`;

const FS = `
precision highp float;
varying vec4 vColW;
varying float vW;
varying vec2 vST;

uniform sampler2D uTex;
uniform vec2 uTexSize;          // decoded texture W,H in texels
uniform bool uUseTex;
uniform bool uBilerp;           // N64 3-point bilinear (G_TF_BILERP/AVERAGE)
uniform vec4 uAddrS;            // maskS, cmS, sizeS(texels, 0=none), unused
uniform vec4 uAddrT;            // maskT, cmT, sizeT, unused

uniform int uMode;              // 0 = combiner off, 1 = combine, 2 = COPY (raw texel)
uniform bool uC2;               // 2-cycle combiner
uniform ivec4 uCmbC0;           // cycle0 color A,B,C,D selects
uniform ivec4 uCmbA0;           // cycle0 alpha A,B,C,D selects
uniform ivec4 uCmbC1;           // cycle1 color selects
uniform ivec4 uCmbA1;           // cycle1 alpha selects
uniform vec4 uPrim;             // 0..255
uniform vec4 uEnv;              // 0..255
uniform vec4 uFog;              // 0..255 (a = fog alpha)
uniform vec4 uBlendC;           // 0..255

uniform int uAlphaGate;         // 1: discard if out alpha < 1 (alpha compare / texrect gate)
uniform bool uCvgSel;           // ALPHA_CVG_SEL -> blend alpha comes from texel alpha
uniform bool uCopyGate;         // COPY mode: discard texel alpha < 1
uniform bool uBl0On;            // in-shader blend cycle 0
uniform ivec4 uBl0;             // p,a,m,b selects
uniform bool uBl1On;            // in-shader blend cycle 1
uniform ivec4 uBl1;

float texAddr(float c, float mask, float cm, float size) {
  if (cm >= 2.0) {  // clamp
    float hi = size > 0.0 ? size - 1.0 : (mask > 0.0 ? exp2(mask) - 1.0 : 1023.0);
    return clamp(c, 0.0, hi);
  }
  if (mask > 0.0) {
    float wrap = exp2(mask);
    if (mod(cm, 2.0) >= 1.0) {  // mirror
      float period = 2.0 * wrap;
      float m = mod(c, period);
      if (m < 0.0) m += period;
      return m < wrap ? m : period - 1.0 - m;
    }
    float m = mod(c, wrap);
    if (m < 0.0) m += wrap;
    return m;
  }
  if (size > 0.0) return clamp(c, 0.0, size - 1.0);
  float m = mod(c, 1024.0);
  if (m < 0.0) m += 1024.0;
  return m;
}

vec4 fetchTexelI(vec2 ij) {
  float ts = texAddr(ij.x, uAddrS.x, uAddrS.y, uAddrS.z);
  float tt = texAddr(ij.y, uAddrT.x, uAddrT.y, uAddrT.z);
  ts = clamp(ts, 0.0, uTexSize.x - 1.0);
  tt = clamp(tt, 0.0, uTexSize.y - 1.0);
  return texture2D(uTex, (vec2(ts, tt) + 0.5) / uTexSize) * 255.0;
}

// N64 3-point bilinear (Task #45): blend the 3 texels of the triangle the
// sample point falls in (no half-texel offset — the RDP fracs the 10.5 ST
// directly, which is why GL LINEAR would look shifted). Each tap goes through
// the same mask/mirror/clamp addressing as point sampling.
vec4 fetchTexel(vec2 st) {
  vec2 base = floor(st);
  if (!uBilerp) return fetchTexelI(base);
  vec2 f = st - base;
  vec4 t00 = fetchTexelI(base);
  vec4 t10 = fetchTexelI(base + vec2(1.0, 0.0));
  vec4 t01 = fetchTexelI(base + vec2(0.0, 1.0));
  if (f.x + f.y <= 1.0) return t00 + f.x * (t10 - t00) + f.y * (t01 - t00);
  vec4 t11 = fetchTexelI(base + vec2(1.0, 1.0));
  return t11 + (1.0 - f.x) * (t01 - t11) + (1.0 - f.y) * (t10 - t11);
}

// Combiner source picks. sel codes follow the RDP mux (SW _cs4/_cs5/_as);
// comb is the cycle-0 result for cycle-1 (sel 0 / alpha-of-combined 7).
vec3 cs4(int sel, vec3 t, vec3 s, bool c1, vec3 comb) {
  if (sel == 0) return c1 ? comb : vec3(0.0);
  if (sel == 1 || sel == 2) return t;
  if (sel == 3) return uPrim.rgb;
  if (sel == 4) return s;
  if (sel == 5) return uEnv.rgb;
  if (sel == 6) return vec3(255.0);
  return vec3(0.0);
}
vec3 cs5(int sel, vec3 t, vec3 s, float ta, float sa, bool c1, vec3 comb, float combA) {
  if (sel == 0) return c1 ? comb : vec3(0.0);
  if (sel == 1 || sel == 2) return t;
  if (sel == 3) return uPrim.rgb;
  if (sel == 4) return s;
  if (sel == 5) return uEnv.rgb;
  if (sel == 6) return vec3(255.0);
  if (sel == 7) return c1 ? vec3(combA) : vec3(0.0);
  if (sel == 8 || sel == 9) return vec3(ta);
  if (sel == 10) return vec3(uPrim.a);
  if (sel == 11) return vec3(sa);
  if (sel == 12) return vec3(uEnv.a);
  if (sel == 13 || sel == 14) return vec3(255.0);
  return vec3(0.0);
}
float asel(int sel, float ta, float sa, bool c1, float comb) {
  if (sel == 0) return c1 ? comb : 0.0;
  if (sel == 1 || sel == 2) return ta;
  if (sel == 3) return uPrim.a;
  if (sel == 4) return sa;
  if (sel == 5) return uEnv.a;
  if (sel == 6) return 255.0;
  return 0.0;
}

// In-shader blender cycle (memory not referenced): out = P*A + M*B.
vec3 blSel(int sel, vec3 px) {
  if (sel == 2) return uBlendC.rgb;
  if (sel == 3) return uFog.rgb;
  return px; // 0=pixel (1=memory unsupported here -> pixel)
}
vec3 blendCycle(ivec4 mux, vec3 px, float pixA, float shadeA) {
  float A;
  if (mux.y == 0) A = pixA / 255.0;
  else if (mux.y == 1) A = uFog.a / 255.0;
  else if (mux.y == 2) A = shadeA / 255.0;
  else A = 0.0;
  float B;
  if (mux.w == 0) B = 1.0 - A;
  else if (mux.w == 2) B = 1.0;
  else B = 0.0;
  return clamp(blSel(mux.x, px) * A + blSel(mux.z, px) * B, 0.0, 255.0);
}

void main() {
  vec4 shade = clamp(vColW / max(vW, 1e-6), 0.0, 255.0);
  vec4 tex = uUseTex ? fetchTexel(vST) : vec4(255.0);

  vec3 rgb; float a;
  if (uMode == 2) {                 // COPY: raw texel, no combine/blend
    if (uCopyGate && tex.a < 1.0) discard;
    rgb = tex.rgb; a = tex.a;
  } else if (uMode == 1) {          // generic combiner
    vec3 c0 = clamp((cs4(uCmbC0.x, tex.rgb, shade.rgb, false, vec3(0.0)) -
                     cs4(uCmbC0.y, tex.rgb, shade.rgb, false, vec3(0.0))) *
                    cs5(uCmbC0.z, tex.rgb, shade.rgb, tex.a, shade.a, false, vec3(0.0), 0.0) / 255.0 +
                    cs4(uCmbC0.w, tex.rgb, shade.rgb, false, vec3(0.0)), 0.0, 255.0);
    float a0 = clamp((asel(uCmbA0.x, tex.a, shade.a, false, 0.0) -
                      asel(uCmbA0.y, tex.a, shade.a, false, 0.0)) *
                     asel(uCmbA0.z, tex.a, shade.a, false, 0.0) / 255.0 +
                     asel(uCmbA0.w, tex.a, shade.a, false, 0.0), 0.0, 255.0);
    if (uC2) {
      vec3 c1 = clamp((cs4(uCmbC1.x, tex.rgb, shade.rgb, true, c0) -
                       cs4(uCmbC1.y, tex.rgb, shade.rgb, true, c0)) *
                      cs5(uCmbC1.z, tex.rgb, shade.rgb, tex.a, shade.a, true, c0, a0) / 255.0 +
                      cs4(uCmbC1.w, tex.rgb, shade.rgb, true, c0), 0.0, 255.0);
      float a1 = clamp((asel(uCmbA1.x, tex.a, shade.a, true, a0) -
                        asel(uCmbA1.y, tex.a, shade.a, true, a0)) *
                       asel(uCmbA1.z, tex.a, shade.a, true, a0) / 255.0 +
                       asel(uCmbA1.w, tex.a, shade.a, true, a0), 0.0, 255.0);
      rgb = c1; a = a1;
    } else { rgb = c0; a = a0; }
  } else {                          // combiner off: shade (modulated by texel if any)
    if (uUseTex) {
      rgb = clamp(shade.rgb * tex.rgb / 255.0, 0.0, 255.0);
      a = clamp(shade.a * tex.a / 255.0, 0.0, 255.0);
    } else { rgb = shade.rgb; a = shade.a; }
  }

  if (uAlphaGate == 1 && a < 1.0) discard;

  float pixA = (uCvgSel && uUseTex) ? tex.a : a;
  if (uBl0On) rgb = blendCycle(uBl0, rgb, pixA, shade.a);
  if (uBl1On) rgb = blendCycle(uBl1, rgb, pixA, shade.a);

  gl_FragColor = vec4(rgb / 255.0, pixA / 255.0);
}
`;

const PRESENT_VS = `
attribute vec2 aP;
varying vec2 vUV;
void main() { vUV = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }
`;
const PRESENT_FS = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uTex;
void main() { gl_FragColor = vec4(texture2D(uTex, vUV).rgb, 1.0); }
// NB: no Y flip here. N64 y=0 maps to clip +1 in the batch VS, so the FBO already
// holds the frame with N64-top at t=1 — same orientation the canvas blit needs.
// (readTarget() flips on readback instead, because readPixels row 0 = bottom.)
`;

function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('shader: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
}
function link(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
    return p;
}

const FLOATS_PER_VERT = 10; // x,y,z,w, r,g,b,a, s,t
const H = 240;

class N64GLRenderer {
    constructor(canvas) {
        const gl = canvas.getContext('webgl', {
            alpha: false, antialias: false, depth: false, stencil: false,
            preserveDrawingBuffer: true, premultipliedAlpha: false
        });
        if (!gl) throw new Error('WebGL unavailable');
        this.gl = gl;
        this.canvas = canvas;

        this.prog = link(gl, VS, FS);
        this.unif = {};
        for (const n of ['uFbSize','uTex','uTexSize','uUseTex','uAddrS','uAddrT','uMode','uC2',
                         'uCmbC0','uCmbA0','uCmbC1','uCmbA1','uPrim','uEnv','uFog','uBlendC',
                         'uAlphaGate','uCvgSel','uCopyGate','uBilerp','uBl0On','uBl0','uBl1On','uBl1']) {
            this.unif[n] = gl.getUniformLocation(this.prog, n);
        }
        this.attr = {
            aPos: gl.getAttribLocation(this.prog, 'aPos'),
            aCol: gl.getAttribLocation(this.prog, 'aCol'),
            aST: gl.getAttribLocation(this.prog, 'aST')
        };
        this.vbo = gl.createBuffer();

        this.presentProg = link(gl, PRESENT_VS, PRESENT_FS);
        this.presentAttr = gl.getAttribLocation(this.presentProg, 'aP');
        this.presentUTex = gl.getUniformLocation(this.presentProg, 'uTex');
        this.presentVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.presentVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

        this.verts = new Float32Array(FLOATS_PER_VERT * 4096);
        this.vcount = 0;
        this.state = null;            // current batch state
        this.targets = new Map();     // colorAddr -> {fbo,tex,addr,width,zAddr,depthRb,lastUse}
        this.depthBufs = new Map();   // zAddr|width -> renderbuffer
        this.pendingDepthClear = new Map(); // zAddr -> value 0..1
        this.texCache = new Map();    // hash -> {tex,W,H}
        this.texCacheOrder = [];
        this.depthAddrs = new Set();
        this.presentSeq = 0;
        this.stats = { draws: 0, tris: 0, texUploads: 0, flushes: 0 };
        this._white = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._white);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                      new Uint8Array([255,255,255,255]));
    }

    attach(rcp) { rcp.glr = this; this.rcp = rcp; }

    // ---------------------------------------------------------------- targets
    _depthBufFor(zAddr, width) {
        const key = zAddr + ':' + width;
        let rb = this.depthBufs.get(key);
        if (!rb) {
            const gl = this.gl;
            rb = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, H);
            this.depthBufs.set(key, rb);
        }
        return rb;
    }

    // One FBO per (color buffer addr, width). Depth renderbuffers are attached
    // lazily when a depth-enabled draw arrives (texrects/menus never need one).
    _target(addr, width) {
        const key = addr + ':' + width;
        let t = this.targets.get(key);
        if (!t) {
            const gl = this.gl;
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
            gl.clearColor(0, 0, 0, 1);
            gl.disable(gl.SCISSOR_TEST);
            gl.clear(gl.COLOR_BUFFER_BIT);
            t = { fbo, tex, addr, width, zAddr: 0, depthRb: null, lastUse: 0 };
            this.targets.set(key, t);
        }
        t.lastUse = ++this.presentSeq;
        return t;
    }

    // Make sure `target` has a depth attachment backed by zAddr's renderbuffer.
    _ensureDepth(target, zAddr) {
        if (target.zAddr === zAddr && target.depthRb) return;
        const gl = this.gl;
        const rb = this._depthBufFor(zAddr, target.width);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
        target.depthRb = rb;
        target.zAddr = zAddr;
        // Fresh attachment: depth content is undefined; initialize from the last
        // depth clear the game issued for this z address (or "far").
        const v = this.pendingDepthClear.has(zAddr) ? this.pendingDepthClear.get(zAddr) : 1.0;
        gl.disable(gl.SCISSOR_TEST);
        gl.depthMask(true);
        gl.clearDepth(v);
        gl.clear(gl.DEPTH_BUFFER_BIT);
    }

    // ------------------------------------------------------------- texturing
    _hashTile(rcp, tileIdx) {
        const tile = rcp.rspState.tiles[tileIdx];
        const tmem = rcp.tmem;
        const sizeS = tile.lrs > tile.uls ? (((tile.lrs - tile.uls) >> 2) + 1) : 0;
        const sizeT = tile.lrt > tile.ult ? (((tile.lrt - tile.ult) >> 2) + 1) : 0;
        let W = sizeS > 0 ? sizeS : (tile.maskS ? (1 << tile.maskS) : 0);
        let Hh = sizeT > 0 ? sizeT : (tile.maskT ? (1 << tile.maskT) : 0);
        if (!W || !Hh) {
            const rowBytes = Math.max(1, tile.line * 8);
            const texPerRow = tile.size === 0 ? rowBytes * 2 : tile.size === 1 ? rowBytes :
                              tile.size === 2 ? rowBytes >> 1 : rowBytes >> 2;
            if (!W) W = Math.max(1, Math.min(1024, texPerRow));
            if (!Hh) Hh = Math.max(1, Math.min(1024, Math.floor((4096 - tile.tmem * 8) / rowBytes)));
        }
        W = Math.max(1, Math.min(1024, W));
        Hh = Math.max(1, Math.min(1024, Hh));
        while (W * Hh > 65536) Hh >>= 1; // TMEM is 4KB; bound decode size
        if (Hh < 1) Hh = 1;

        // FNV-1a over tile params + the TMEM region the decode will read (+TLUT for CI).
        let h = 0x811c9dc5;
        const mix = (v) => { h ^= (v & 0xFF); h = (h * 0x01000193) >>> 0; };
        mix(tile.format); mix(tile.size); mix(tile.line); mix(tile.tmem & 0xFF); mix(tile.tmem >> 8);
        mix(tile.palette); mix(W & 0xFF); mix(W >> 8); mix(Hh & 0xFF); mix(Hh >> 8);
        const rowBytes = Math.max(1, tile.line * 8);
        const start = tile.tmem * 8;
        const end = Math.min(4096, start + rowBytes * Hh);
        for (let i = start; i < end; i++) { h ^= tmem[i]; h = (h * 0x01000193) >>> 0; }
        if (tile.format === 2) { // CI -> include the palette area
            const ps = 2048 + tile.palette * 32;
            const pe = Math.min(4096, tile.size === 1 ? 2048 + 512 : ps + 32);
            for (let i = ps; i < pe; i++) { h ^= tmem[i]; h = (h * 0x01000193) >>> 0; }
        }
        return { hash: h >>> 0, W, H: Hh };
    }

    // Decode tile texels (ts,tt) exactly like rcp.sampleTexture's flat-TMEM reads.
    _decodeTile(rcp, tileIdx, W, Hh) {
        const tile = rcp.rspState.tiles[tileIdx];
        const tmem = rcp.tmem;
        const out = new Uint8Array(W * Hh * 4);
        let o = 0;
        for (let tt = 0; tt < Hh; tt++) {
            for (let ts = 0; ts < W; ts++, o += 4) {
                let r = 255, g = 255, b = 255, a = 255;
                if (tile.format === 0 && tile.size === 2) {        // RGBA16
                    const p = (tile.tmem + tt * tile.line + (ts >> 2)) * 8 + (ts & 3) * 2;
                    if (p + 1 < 4096) {
                        const v = (tmem[p] << 8) | tmem[p + 1];
                        r = ((v >> 11) & 0x1F) << 3; g = ((v >> 6) & 0x1F) << 3;
                        b = ((v >> 1) & 0x1F) << 3; a = (v & 1) ? 255 : 0;
                    }
                } else if (tile.format === 0 && tile.size === 3) { // RGBA32
                    const p = tile.tmem * 8 + tt * tile.line * 8 + ts * 4;
                    if (p + 3 < 4096) { r = tmem[p]; g = tmem[p+1]; b = tmem[p+2]; a = tmem[p+3]; }
                } else if (tile.format === 2) {                    // CI4/CI8 + TLUT
                    const p = tile.tmem * 8 + tt * tile.line * 8 + (tile.size === 1 ? ts : ts >> 1);
                    if (p < 4096) {
                        const idx = (tile.size === 1) ? tmem[p] : (ts & 1 ? tmem[p] & 0xF : tmem[p] >> 4);
                        const palOff = 2048 + (tile.palette * 16 + idx) * 2;
                        if (palOff + 1 < 4096) {
                            const v = (tmem[palOff] << 8) | tmem[palOff + 1];
                            r = ((v >> 11) & 0x1F) << 3; g = ((v >> 6) & 0x1F) << 3;
                            b = ((v >> 1) & 0x1F) << 3; a = (v & 1) ? 255 : 0;
                        }
                    }
                } else if (tile.format === 3 && tile.size === 2) { // IA16
                    const p = tile.tmem * 8 + tt * tile.line * 8 + ts * 2;
                    if (p + 1 < 4096) { const i = tmem[p]; r = g = b = i; a = tmem[p + 1]; }
                } else if (tile.format === 3 && tile.size === 0) { // IA4
                    const p = tile.tmem * 8 + tt * tile.line * 8 + (ts >> 1);
                    if (p < 4096) {
                        const v = (ts & 1) ? (tmem[p] & 0xF) : (tmem[p] >> 4);
                        const i3 = (v >> 1) & 0x7;
                        const i = (i3 << 5) | (i3 << 2) | (i3 >> 1);
                        r = g = b = i; a = (v & 1) ? 255 : 0;
                    }
                } else if (tile.format === 3 && tile.size === 1) { // IA8
                    const p = tile.tmem * 8 + tt * tile.line * 8 + ts;
                    if (p < 4096) { const v = tmem[p]; const i = (v >> 4) << 4; r = g = b = i; a = (v & 0xF) << 4; }
                } else if (tile.format === 4) {                    // I4/I8
                    const p = tile.tmem * 8 + tt * tile.line * 8 + (tile.size === 1 ? ts : ts >> 1);
                    if (p < 4096) {
                        const v = (tile.size === 1) ? tmem[p] : (ts & 1 ? (tmem[p] & 0xF) << 4 : tmem[p] & 0xF0);
                        // I (intensity) format: alpha = intensity (matches SW sampler
                        // / N64 HW). Lets the combiner's TEXEL0_ALPHA mask alpha-faded
                        // I textures (MK64 sun-flare, OoT logo backdrop). Was a=255.
                        r = g = b = v; a = v;
                    }
                }
                out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
            }
        }
        return out;
    }

    _textureFor(rcp, tileIdx) {
        const { hash, W, H: Hh } = this._hashTile(rcp, tileIdx);
        let entry = this.texCache.get(hash);
        if (!entry) {
            const gl = this.gl;
            const pixels = this._decodeTile(rcp, tileIdx, W, Hh);
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, Hh, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            entry = { tex, W, H: Hh, hash };
            this.texCache.set(hash, entry);
            this.texCacheOrder.push(hash);
            this.stats.texUploads++;
            if (this.texCacheOrder.length > 512) {
                const old = this.texCacheOrder.shift();
                const e = this.texCache.get(old);
                if (e) { gl.deleteTexture(e.tex); this.texCache.delete(old); }
            }
        }
        return entry;
    }

    // ---------------------------------------------------------- state/batching
    // kind: 0 = triangle, 1 = texrect
    _stateFor(rcp, kind, tileIdx) {
        const rs = rcp.rspState;
        const cyc = (rs.otherModeHi >>> 20) & 3;
        const copy = kind === 1 && cyc === 2;
        const combineActive = !!(rs.combine.hi || rs.combine.lo);
        const useTex = kind === 1 ? (rs.textureImage !== 0) : (kind === 2 ? false : rs.useTexture);
        const depthEnabled = kind === 0 && !!rs.depthImage && ((rs.geometryMode & 1) !== 0);
        const tile = rs.tiles[tileIdx];
        const texEntry = useTex ? this._textureFor(rcp, tileIdx) : null;
        const blActive = rcp.blenderActive();

        const s = {
            kind, copy,
            target: rs.colorImage & 0x7FFFFF,
            width: (rs.colorImageWidth | 0) || 320,
            zAddr: depthEnabled ? (rs.depthImage & 0x7FFFFF) : 0,
            depthEnabled,
            combineActive,
            mode: copy ? 2 : (combineActive ? 1 : 0),
            c2: ((rs.otherModeHi >>> 20) & 3) === 1,
            cmbHi: rs.combine.hi >>> 0, cmbLo: rs.combine.lo >>> 0,
            omLo: rs.otherModeLo >>> 0, omHi: rs.otherModeHi >>> 0,
            prim: rs.primColor >>> 0, env: rs.envColor >>> 0,
            fog: rs.fogColor >>> 0, blend: rs.blendColor >>> 0,
            useTex,
            texHash: texEntry ? texEntry.hash : 0,
            texEntry,
            maskS: tile.maskS, maskT: tile.maskT, cmS: tile.cmS, cmT: tile.cmT,
            sizeS: tile.lrs > tile.uls ? (((tile.lrs - tile.uls) >> 2) + 1) : 0,
            sizeT: tile.lrt > tile.ult ? (((tile.lrt - tile.ult) >> 2) + 1) : 0,
            blActive,
            // texrect alpha gate: SW skips a<1 writes when the blender is off
            alphaGate: copy ? 0 : ((kind === 1 || kind === 2) ? (blActive ? 0 : 1) : ((rs.otherModeLo & 0x4000) ? 1 : 0)),
            copyGate: copy && ((rs.otherModeLo & 1) !== 0),
            cvgSel: (rs.otherModeLo & 0x2000) !== 0
        };
        if (rs.depthImage) this.depthAddrs.add(rs.depthImage & 0x7FFFFF);
        return s;
    }

    _sameState(a, b) {
        return a && b &&
            a.kind === b.kind && a.copy === b.copy && a.target === b.target &&
            a.width === b.width && a.zAddr === b.zAddr && a.depthEnabled === b.depthEnabled &&
            a.mode === b.mode && a.c2 === b.c2 && a.cmbHi === b.cmbHi && a.cmbLo === b.cmbLo &&
            a.omLo === b.omLo && a.omHi === b.omHi && a.prim === b.prim && a.env === b.env &&
            a.fog === b.fog && a.blend === b.blend && a.useTex === b.useTex &&
            a.texHash === b.texHash && a.maskS === b.maskS && a.maskT === b.maskT &&
            a.cmS === b.cmS && a.cmT === b.cmT && a.sizeS === b.sizeS && a.sizeT === b.sizeT;
    }

    _ensureState(rcp, kind, tileIdx) {
        const s = this._stateFor(rcp, kind, tileIdx);
        if (!this._sameState(this.state, s)) {
            this._flushBatch();
            this.state = s;
        }
        return this.state;
    }

    _pushVert(x, y, z, w, r, g, b, a, st, tt) {
        if ((this.vcount + 1) * FLOATS_PER_VERT > this.verts.length) {
            const next = new Float32Array(this.verts.length * 2);
            next.set(this.verts);
            this.verts = next;
        }
        const o = this.vcount * FLOATS_PER_VERT;
        const v = this.verts;
        v[o] = x; v[o+1] = y; v[o+2] = z; v[o+3] = w;
        v[o+4] = r; v[o+5] = g; v[o+6] = b; v[o+7] = a;
        v[o+8] = st; v[o+9] = tt;
        this.vcount++;
    }

    // ------------------------------------------------------------ capture API
    // Fold the tile shift into a texel-coordinate scale (sampleTexture floors
    // before shifting; floor(floor(x)/2^k) == floor(x/2^k), so folding is safe
    // for right shifts; the rare left-shift case is approximated).
    _shiftScale(shift) {
        if (shift > 0 && shift <= 10) return 1 / (1 << shift);
        if (shift > 10) return (1 << (16 - shift));
        return 1;
    }

    triFan(poly, rcp) {
        const rs = rcp.rspState;
        const s = this._ensureState(rcp, 0, rs.currentTile);
        const tile = rs.tiles[rs.currentTile];
        const fs = (rs.textureScaleS / 32) * this._shiftScale(tile.shiftS);
        const ft = (rs.textureScaleT / 32) * this._shiftScale(tile.shiftT);
        for (let i = 1; i < poly.length - 1; i++) {
            const a = poly[0], b = poly[i], c = poly[i + 1];
            for (const v of [a, b, c]) {
                const aw = Math.abs(v.w ?? 1);
                const w = aw > 1e-6 ? aw : 1.0;
                this._pushVert(v.x, v.y, v.z, w, v.r, v.g, v.b, v.a, v.s * fs, v.t * ft);
            }
            this.stats.tris++;
        }
        if (this.vcount * FLOATS_PER_VERT > 60000) this._flushBatch();
    }

    texRect(rcp, tileIdx, left, top, right, bottom, s0, t0, sStep, dtdy, flip) {
        const s = this._ensureState(rcp, 1, tileIdx);
        const tile = rcp.rspState.tiles[tileIdx];
        const fScale = this._shiftScale(tile.shiftS);
        const tScale = this._shiftScale(tile.shiftT);
        // Texel coords: s_texel(x) = s0/32 + sStep*(x - left)/1024, sampled by the
        // SW loop at integer x; the GPU samples fragment centers (x+0.5), so bias
        // the corners by half a step.
        const dw = right - left, dh = bottom - top;
        const sA = (s0 / 32 - (sStep / 1024) * 0.5) * fScale;
        const sB = (s0 / 32 + (sStep / 1024) * ((flip ? dh : dw) - 0.5)) * fScale;
        const tA = (t0 / 32 - (dtdy / 1024) * 0.5) * tScale;
        const tB = (t0 / 32 + (dtdy / 1024) * ((flip ? dw : dh) - 0.5)) * tScale;
        // Corner texel coords; flip swaps which screen axis advances s vs t.
        const stTL = flip ? [sA, tA] : [sA, tA];
        const stTR = flip ? [sA, tB] : [sB, tA];
        const stBL = flip ? [sB, tA] : [sA, tB];
        const stBR = flip ? [sB, tB] : [sB, tB];
        // Geometry: pixel rect [left,right) x [top,bottom); shift by -0.5 because
        // the vertex shader adds the +0.5 fragment-center bias for triangles.
        const x0 = left - 0.5, x1 = right - 0.5, y0 = top - 0.5, y1 = bottom - 0.5;
        const W = 255;
        this._pushVert(x0, y0, 0, 1, W, W, W, W, stTL[0], stTL[1]);
        this._pushVert(x1, y0, 0, 1, W, W, W, W, stTR[0], stTR[1]);
        this._pushVert(x0, y1, 0, 1, W, W, W, W, stBL[0], stBL[1]);
        this._pushVert(x1, y0, 0, 1, W, W, W, W, stTR[0], stTR[1]);
        this._pushVert(x1, y1, 0, 1, W, W, W, W, stBR[0], stBR[1]);
        this._pushVert(x0, y1, 0, 1, W, W, W, W, stBL[0], stBL[1]);
        this.stats.tris += 2;
    }

    fillRect(rcp, xStart, yStart, xEnd, yEnd) {
        this._flushBatch();
        const gl = this.gl;
        const rs = rcp.rspState;
        const addr = rs.colorImage & 0x7FFFFF;
        const width = (rs.colorImageWidth | 0) || 320;
        const fill = rs.fillColor >>> 0;

        // FILLRECT aimed at a depth image = depth clear (SM64 clears Z this way).
        if (this.depthAddrs.has(addr) || addr === (rs.depthImage & 0x7FFFFF)) {
            const z16 = (fill >>> 16) & 0xFFFF;
            const v = Math.max(0, Math.min(1, z16 / 0xFFFF));
            this.pendingDepthClear.set(addr, v);
            for (const t of this.targets.values()) {
                if (t.zAddr === addr) {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
                    gl.disable(gl.SCISSOR_TEST);
                    gl.depthMask(true);
                    gl.clearDepth(v);
                    gl.clear(gl.DEPTH_BUFFER_BIT);
                }
            }
            return;
        }

        this._target(addr, width); // ensure the color target exists
        const fill16 = (fill >>> 16) & 0xFFFF;
        let r, g, b;
        if (rs.colorImageSize === 3) {
            r = (fill >>> 24) & 0xFF; g = (fill >>> 16) & 0xFF; b = (fill >>> 8) & 0xFF;
        } else {
            r = ((fill16 >> 11) & 0x1F) << 3; g = ((fill16 >> 6) & 0x1F) << 3; b = ((fill16 >> 1) & 0x1F) << 3;
        }
        for (const tgt of this._targetsFor(addr, width)) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fbo);
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(xStart, H - 1 - yEnd, Math.max(0, xEnd - xStart + 1), Math.max(0, yEnd - yStart + 1));
            gl.clearColor(r / 255, g / 255, b / 255, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.disable(gl.SCISSOR_TEST);
        }
    }

    // Composite a 1-/2-cycle G_FILLRECT (OoT fade / letterbox overlay) as a
    // non-textured screen-space quad through the SAME batched combiner+blender
    // path as a triangle/texrect (kind 2 -> useTex=false, no depth). Mirrors the
    // SW _compositeOverlayFillRect so the GL OoT logo/title fades match SW.
    // F3DEX2-gated in rcp.handleG_FILLRECT, so SM64/MK64 never reach here.
    compositeFillRect(rcp, hi, lo) {
        const rs = rcp.rspState;
        const w = (rs.colorImageWidth | 0);
        if (w <= 0) return;
        const x2 = (hi >>> 12) & 0xFFF, y2 = hi & 0xFFF, x1 = (lo >>> 12) & 0xFFF, y1 = lo & 0xFFF;
        const xStart = Math.max(0, Math.floor(x1 / 4));
        const xEnd   = Math.min(w - 1, Math.floor(x2 / 4));
        const yStart = Math.max(0, Math.floor(y1 / 4));
        const yEnd   = Math.min(239, Math.floor(y2 / 4));
        if (xStart > xEnd || yStart > yEnd) return;
        this._target(rs.colorImage & 0x7FFFFF, w); // ensure the color target exists
        this._ensureState(rcp, 2, rs.currentTile);
        // Pixel rect [xStart,xEnd] x [yStart,yEnd] inclusive; the vertex shader
        // adds +0.5, so the -0.5/+0.5 corners cover exactly those pixel centres.
        const gx0 = xStart - 0.5, gx1 = xEnd + 0.5, gy0 = yStart - 0.5, gy1 = yEnd + 0.5;
        const C = 255;
        this._pushVert(gx0, gy0, 0, 1, C, C, C, C, 0, 0);
        this._pushVert(gx1, gy0, 0, 1, C, C, C, C, 0, 0);
        this._pushVert(gx0, gy1, 0, 1, C, C, C, C, 0, 0);
        this._pushVert(gx1, gy0, 0, 1, C, C, C, C, 0, 0);
        this._pushVert(gx1, gy1, 0, 1, C, C, C, C, 0, 0);
        this._pushVert(gx0, gy1, 0, 1, C, C, C, C, 0, 0);
        this.stats.tris += 2;
    }

    _targetsFor(addr, width) {
        const out = [];
        for (const t of this.targets.values()) if (t.addr === addr && t.width === width) out.push(t);
        return out;
    }

    // ------------------------------------------------------------- GL flush
    // Map the blender to (in-shader cycles, GL fixed-function memory cycle).
    _blendSetup(s) {
        const gl = this.gl;
        const lo = s.omLo;
        const out = { bl0On: false, bl0: [0,0,0,0], bl1On: false, bl1: [0,0,0,0], glBlend: null };
        if (!s.blActive || s.copy) return out;
        const c0 = [(lo >>> 30) & 3, (lo >>> 26) & 3, (lo >>> 22) & 3, (lo >>> 18) & 3];
        const two = ((s.omHi >>> 20) & 3) === 1;
        const c1 = two ? [(lo >>> 28) & 3, (lo >>> 24) & 3, (lo >>> 20) & 3, (lo >>> 16) & 3] : null;
        const refsMem = (c) => c[0] === 1 || c[2] === 1 || c[3] === 1;
        const cycles = two ? [c0, c1] : [c0];
        let memCycle = null;
        const shaderCycles = [];
        for (const c of cycles) {
            if (refsMem(c) && !memCycle) memCycle = c;       // first mem cycle -> GL blend
            else if (refsMem(c)) { /* second mem cycle unsupported; skip */ }
            else shaderCycles.push(c);
        }
        if (shaderCycles.length > 0) { out.bl0On = true; out.bl0 = shaderCycles[0]; }
        if (shaderCycles.length > 1) { out.bl1On = true; out.bl1 = shaderCycles[1]; }
        if (memCycle) {
            const aSel = memCycle[1], bSel = memCycle[3];
            const cvg = (lo & 0x2000) !== 0;
            let src, dst, constA = null;
            if (aSel === 1) { // fog alpha as blend factor -> GL constant alpha
                constA = (s.fog & 0xFF) / 255;
                src = gl.CONSTANT_ALPHA;
                dst = (cvg || bSel === 0) ? gl.ONE_MINUS_CONSTANT_ALPHA :
                      bSel === 1 ? gl.DST_ALPHA : bSel === 2 ? gl.ONE : gl.ZERO;
            } else {
                src = gl.SRC_ALPHA;
                dst = (cvg || bSel === 0) ? gl.ONE_MINUS_SRC_ALPHA :
                      bSel === 1 ? gl.DST_ALPHA : bSel === 2 ? gl.ONE : gl.ZERO;
            }
            out.glBlend = { src, dst, constA };
        }
        return out;
    }

    _flushBatch() {
        const s = this.state;
        const n = this.vcount;
        if (!s || n === 0) { this.vcount = 0; return; }
        const gl = this.gl;
        this.stats.flushes++;
        this.stats.draws++;

        const target = this._target(s.target, s.width);
        if (s.depthEnabled) this._ensureDepth(target, s.zAddr);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.viewport(0, 0, s.width, H);
        gl.disable(gl.SCISSOR_TEST);

        gl.useProgram(this.prog);
        const u = this.unif;
        gl.uniform2f(u.uFbSize, s.width, H);

        // depth
        if (s.depthEnabled && target.depthRb) {
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);
            gl.depthMask(true);
        } else {
            gl.disable(gl.DEPTH_TEST);
            gl.depthMask(false);
        }

        // texture
        gl.activeTexture(gl.TEXTURE0);
        if (s.useTex && s.texEntry) {
            gl.bindTexture(gl.TEXTURE_2D, s.texEntry.tex);
            gl.uniform2f(u.uTexSize, s.texEntry.W, s.texEntry.H);
        } else {
            gl.bindTexture(gl.TEXTURE_2D, this._white);
            gl.uniform2f(u.uTexSize, 1, 1);
        }
        gl.uniform1i(u.uTex, 0);
        gl.uniform1i(u.uUseTex, s.useTex ? 1 : 0);
        gl.uniform4f(u.uAddrS, s.maskS, s.cmS, s.sizeS, 0);
        gl.uniform4f(u.uAddrT, s.maskT, s.cmT, s.sizeT, 0);

        // combiner
        gl.uniform1i(u.uMode, s.mode);
        gl.uniform1i(u.uC2, (s.mode === 1 && s.c2) ? 1 : 0);
        const hi = s.cmbHi, lo = s.cmbLo;
        gl.uniform4i(u.uCmbC0, (hi >>> 20) & 0xF, (lo >>> 28) & 0xF, (hi >>> 15) & 0x1F, (lo >>> 15) & 0x7);
        gl.uniform4i(u.uCmbA0, (hi >>> 12) & 0x7, (lo >>> 12) & 0x7, (hi >>> 9) & 0x7, (lo >>> 9) & 0x7);
        gl.uniform4i(u.uCmbC1, (hi >>> 5) & 0xF, (lo >>> 24) & 0xF, hi & 0x1F, (lo >>> 6) & 0x7);
        gl.uniform4i(u.uCmbA1, (lo >>> 21) & 0x7, (lo >>> 3) & 0x7, (lo >>> 18) & 0x7, lo & 0x7);
        const c4 = (v) => [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF];
        gl.uniform4fv(u.uPrim, c4(s.prim));
        gl.uniform4fv(u.uEnv, c4(s.env));
        gl.uniform4fv(u.uFog, c4(s.fog));
        gl.uniform4fv(u.uBlendC, c4(s.blend));

        gl.uniform1i(u.uAlphaGate, s.alphaGate);
        gl.uniform1i(u.uCvgSel, s.cvgSel ? 1 : 0);
        gl.uniform1i(u.uCopyGate, s.copyGate ? 1 : 0);
        // G_MDSFT_TEXTFILT (omHi bits 12-13): 0=POINT, 2=BILERP, 3=AVERAGE.
        // Bit 13 covers both filtered modes; COPY mode never filters.
        gl.uniform1i(u.uBilerp, (s.mode !== 2 && ((s.omHi >>> 13) & 1) !== 0) ? 1 : 0);

        // blender
        const bl = this._blendSetup(s);
        gl.uniform1i(u.uBl0On, bl.bl0On ? 1 : 0);
        gl.uniform4i(u.uBl0, bl.bl0[0], bl.bl0[1], bl.bl0[2], bl.bl0[3]);
        gl.uniform1i(u.uBl1On, bl.bl1On ? 1 : 0);
        gl.uniform4i(u.uBl1, bl.bl1[0], bl.bl1[1], bl.bl1[2], bl.bl1[3]);
        if (bl.glBlend) {
            gl.enable(gl.BLEND);
            gl.blendFunc(bl.glBlend.src, bl.glBlend.dst);
            if (bl.glBlend.constA !== null) gl.blendColor(0, 0, 0, bl.glBlend.constA);
        } else {
            gl.disable(gl.BLEND);
        }

        // vertices
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.verts.subarray(0, n * FLOATS_PER_VERT), gl.DYNAMIC_DRAW);
        const stride = FLOATS_PER_VERT * 4;
        gl.enableVertexAttribArray(this.attr.aPos);
        gl.vertexAttribPointer(this.attr.aPos, 4, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(this.attr.aCol);
        gl.vertexAttribPointer(this.attr.aCol, 4, gl.FLOAT, false, stride, 16);
        gl.enableVertexAttribArray(this.attr.aST);
        gl.vertexAttribPointer(this.attr.aST, 2, gl.FLOAT, false, stride, 32);
        gl.drawArrays(gl.TRIANGLES, 0, n);
        if (!this._drawErrChecked) {
            this._drawErrChecked = true;
            const e = gl.getError();
            if (e) console.warn('N64GL: GL error on first batch draw:', '0x' + e.toString(16));
        }
        this.vcount = 0;
    }

    flush() { this._flushBatch(); }

    // Blit the FBO the VI is scanning out onto the canvas (letterboxed).
    present(viOrigin, viWidth) {
        this._flushBatch();
        const gl = this.gl;
        const origin = viOrigin & 0x7FFFFF;
        let best = null;
        for (const t of this.targets.values()) {
            // VI_ORIGIN points a line or two into the buffer (draw origin + 0x280
            // for 320x16-bit). Use a tight window — SM64's buffers are spaced only
            // one frame apart, so a frame-sized window would match the neighbor.
            const windowBytes = t.width * 4 * 8; // 8 lines, 32-bit worst case
            const d = (origin - t.addr) & 0x7FFFFF;
            if (d < windowBytes && (!best || t.lastUse > best.lastUse)) best = t;
        }
        if (!best) return false;

        const cw = this.canvas.width, ch = this.canvas.height;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.disable(gl.BLEND);
        gl.disable(gl.SCISSOR_TEST);
        gl.viewport(0, 0, cw, ch);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const scale = Math.min(cw / best.width, ch / H);
        const dw = Math.max(1, Math.floor(best.width * scale));
        const dh = Math.max(1, Math.floor(H * scale));
        gl.viewport(((cw - dw) / 2) | 0, ((ch - dh) / 2) | 0, dw, dh);

        gl.useProgram(this.presentProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, best.tex);
        gl.uniform1i(this.presentUTex, 0);
        // leftover batch attrib arrays (aCol/aST) must not stay enabled here
        for (let i = 0; i < 4; i++) if (i !== this.presentAttr) gl.disableVertexAttribArray(i);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.presentVbo);
        gl.enableVertexAttribArray(this.presentAttr);
        gl.vertexAttribPointer(this.presentAttr, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!this._presErrChecked) {
            this._presErrChecked = true;
            const e = gl.getError();
            if (e) console.warn('N64GL: GL error on first present:', '0x' + e.toString(16));
        }
        return true;
    }

    // Read back a target's pixels (verification harness). Returns {width,height,data RGBA}.
    readTarget(addrOrNull) {
        this._flushBatch();
        const gl = this.gl;
        let best = null;
        for (const t of this.targets.values()) {
            if (addrOrNull != null && t.addr !== (addrOrNull & 0x7FFFFF)) continue;
            if (!best || t.lastUse > best.lastUse) best = t;
        }
        if (!best) return null;
        gl.bindFramebuffer(gl.FRAMEBUFFER, best.fbo);
        const data = new Uint8Array(best.width * H * 4);
        gl.readPixels(0, 0, best.width, H, gl.RGBA, gl.UNSIGNED_BYTE, data);
        // flip rows (FBO row 0 = bottom)
        const row = best.width * 4;
        const flipped = new Uint8Array(data.length);
        for (let y = 0; y < H; y++) flipped.set(data.subarray(y * row, (y + 1) * row), (H - 1 - y) * row);
        return { width: best.width, height: H, addr: best.addr, data: flipped };
    }
}

if (typeof window !== 'undefined') window.N64GLRenderer = N64GLRenderer;
if (typeof module !== 'undefined' && module.exports) module.exports = { N64GLRenderer };
})();
