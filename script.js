document.addEventListener('DOMContentLoaded', () => {
    const romFileInput = document.getElementById('rom-file'), romLoaderDiv = document.getElementById('rom-loader'), canvas = document.getElementById('screen');
    const videoUtils = window.N64VideoUtils || {};
    const decodeRgba5551 = videoUtils.decodeRgba5551 || ((v) => ({
        r: ((v >> 11) & 0x1F) << 3,
        g: ((v >> 6) & 0x1F) << 3,
        b: ((v >> 1) & 0x1F) << 3,
        a: (v & 1) ? 255 : 0
    }));
    const shouldRenderVideoFrame = videoUtils.shouldRenderVideoFrame || ((args) => args.width > 0 && args.type >= 2);
    // Renderer selection (Task #40): WebGL by default (the real-time path; the
    // software RDP stays the byte-exact verification reference). ?gl=0 forces SW.
    const wantGL = new URLSearchParams(window.location.search).get('gl') !== '0';
    let glRenderer = null;
    if (wantGL && window.N64GLRenderer) {
        try { glRenderer = new window.N64GLRenderer(canvas); }
        catch (e) {
            console.error('WebGL init failed, switching to the software renderer:', e);
            // the canvas may already own a (broken) webgl context -> reload on the SW path
            const u = new URL(window.location.href);
            if (u.searchParams.get('gl') !== '0') { u.searchParams.set('gl', '0'); window.location.replace(u.href); return; }
        }
    }
    const screenCtx = glRenderer ? null : canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!glRenderer && !screenCtx) {
        console.error("Neither WebGL nor 2D canvas is available.");
        return;
    }
    if (screenCtx) screenCtx.imageSmoothingEnabled = false;
    const FB_WIDTH = 320, FB_HEIGHT = 240, framebuffer = new Uint8Array(FB_WIDTH * FB_HEIGHT * 4);
    const ram = new Memory(8 * 1024 * 1024), mmu = new MMU(ram), rcp = new RCP(mmu, framebuffer), cpu = new CPU(mmu, rcp);
    mmu.cpu = cpu; mmu.rcp = rcp; window.mmu = mmu; window.cpu = cpu; window.rcp = rcp;
    if (glRenderer) { glRenderer.attach(rcp); console.log('Renderer: WebGL (append ?gl=0 for software)'); }
    else console.log('Renderer: software');

    // --- Audio output: stream AI DMA PCM (filled by the HLE audio RSP task) to WebAudio ---
    // The N64 hands AI 16-bit signed stereo PCM; mmu.emitAudioBuffer forwards each block here.
    let audioCtx = null, audioTime = 0;
    const AUDIO_GAIN = 0.6;
    function initAudio() {
        if (audioCtx) return;
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
    }
    // Resume the context on first user gesture (browsers block autoplay).
    document.addEventListener('pointerdown', () => { initAudio(); if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }, { once: false });
    mmu.audioSink = (pcm, dacRate) => {
        if (!audioCtx || pcm.length < 2) return;
        // AI_DACRATE encodes the sample rate: rate = VI_clock / (dacRate + 1). PAL VI clock ~49.66MHz.
        let rate = dacRate > 0 ? Math.round(48681812 / (dacRate + 1)) : 32000;
        if (!(rate >= 8000 && rate <= 48000)) rate = 32000;
        const frames = pcm.length >> 1;
        const buf = audioCtx.createBuffer(2, frames, rate);
        const L = buf.getChannelData(0), R = buf.getChannelData(1);
        for (let i = 0; i < frames; i++) {
            L[i] = (pcm[i * 2] / 32768) * AUDIO_GAIN;
            R[i] = (pcm[i * 2 + 1] / 32768) * AUDIO_GAIN;
        }
        const src = audioCtx.createBufferSource();
        src.buffer = buf; src.connect(audioCtx.destination);
        const now = audioCtx.currentTime;
        if (audioTime < now) audioTime = now + 0.02; // small lead to avoid underruns
        src.start(audioTime);
        audioTime += frames / rate;
    };
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = FB_WIDTH;
    frameCanvas.height = FB_HEIGHT;
    const frameCtx = frameCanvas.getContext('2d', { alpha: false });
    const frameImageData = new ImageData(new Uint8ClampedArray(framebuffer.buffer), FB_WIDTH, FB_HEIGHT);

    romFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => { ram.loadRom(ev.target.result); romLoaderDiv.style.display = 'none'; cpu.run(); };
            reader.readAsArrayBuffer(file);
        }
    });

    // Auto-load ROM if available
    fetch("Super Mario 64 (Europe) (En,Fr,De).n64").then(r => r.arrayBuffer()).then(buf => {
        console.log("Auto-loading ROM...");
        ram.loadRom(buf);
        romLoaderDiv.style.display = 'none';
        cpu.run();
    }).catch(e => console.warn("Auto-load ROM failed:", e));

    let lastOrigin = -1, lastWidth = -1, lastType = -1;
    let frameIsBlank = false;
    let lastRenderKey = '';
    let lastUpdateTime = 0;
    const updateIntervalMs = 33;

    function resize() {
        const controlsHeight = document.querySelector('.controls')?.offsetHeight || 0;
        const loaderHeight = romLoaderDiv.style.display === 'none' ? 0 : (romLoaderDiv.offsetHeight || 0);
        canvas.width = Math.max(1, window.innerWidth);
        canvas.height = Math.max(1, window.innerHeight - controlsHeight - loaderHeight);
        if (screenCtx) screenCtx.imageSmoothingEnabled = false; // null in GL mode (Task #40 fix: this threw and killed the render loop)
    }
    window.addEventListener('resize', resize); resize();

    function presentFrame() {
        frameCtx.putImageData(frameImageData, 0, 0);
        const cw = canvas.width;
        const ch = canvas.height;
        screenCtx.fillStyle = '#000';
        screenCtx.fillRect(0, 0, cw, ch);

        const scale = Math.min(cw / FB_WIDTH, ch / FB_HEIGHT);
        const drawW = Math.max(1, Math.floor(FB_WIDTH * scale));
        const drawH = Math.max(1, Math.floor(FB_HEIGHT * scale));
        const dx = ((cw - drawW) / 2) | 0;
        const dy = ((ch - drawH) / 2) | 0;
        screenCtx.drawImage(frameCanvas, 0, 0, FB_WIDTH, FB_HEIGHT, dx, dy, drawW, drawH);
    }

    function estimateViHeight() {
        const vStartReg = mmu.viRegisters[10] >>> 0;
        const yScaleReg = mmu.viRegisters[13] >>> 0;
        const vStart = (vStartReg >>> 16) & 0x3FF;
        const vEnd = vStartReg & 0x3FF;
        const yScale = (yScaleReg & 0xFFF) / 1024;
        const delta = vEnd - vStart;
        if (delta > 0 && yScale > 0) {
            return Math.max(1, Math.min(FB_HEIGHT, Math.floor((delta * yScale) / 2)));
        }
        return FB_HEIGHT;
    }

    function readRdram8(rd, address) {
        return rd.getUint8(address & 0x7FFFFF);
    }

    function readRdram16(rd, address) {
        const hi = readRdram8(rd, address);
        const lo = readRdram8(rd, address + 1);
        return (hi << 8) | lo;
    }

    function blitFrame(rd, origin, width, type, height) {
        if (width <= 0 || height <= 0 || type < 2 || type > 3) return false;
        const bpp = (type === 3) ? 4 : 2;
        const drawWidth = Math.min(width, FB_WIDTH);
        const drawHeight = Math.min(height, FB_HEIGHT);
        let fbIdx = 0;

        for (let y = 0; y < FB_HEIGHT; y++) {
            const inVisibleHeight = y < drawHeight;
            const lineOff = origin + y * width * bpp;
            for (let x = 0; x < FB_WIDTH; x++) {
                if (inVisibleHeight && x < drawWidth) {
                    const addr = (lineOff + x * bpp) & 0x7FFFFF;
                    if (type === 2) {
                        const rgba = decodeRgba5551(readRdram16(rd, addr));
                        framebuffer[fbIdx++] = rgba.r;
                        framebuffer[fbIdx++] = rgba.g;
                        framebuffer[fbIdx++] = rgba.b;
                        framebuffer[fbIdx++] = 255;
                    } else {
                        framebuffer[fbIdx++] = readRdram8(rd, addr);
                        framebuffer[fbIdx++] = readRdram8(rd, addr + 1);
                        framebuffer[fbIdx++] = readRdram8(rd, addr + 2);
                        framebuffer[fbIdx++] = 255;
                    }
                } else {
                    framebuffer[fbIdx++] = 0;
                    framebuffer[fbIdx++] = 0;
                    framebuffer[fbIdx++] = 0;
                    framebuffer[fbIdx++] = 255;
                }
            }
        }

        return true;
    }

    function blitSnapshot(snapshot) {
        if (!snapshot || !snapshot.data) return false;
        const width = snapshot.width | 0;
        const type = snapshot.type | 0;
        const height = Math.max(1, Math.min(FB_HEIGHT, snapshot.height | 0));
        if (width <= 0 || type < 2 || type > 3) return false;
        const bpp = (type === 3) ? 4 : 2;
        const drawWidth = Math.min(width, FB_WIDTH);
        const drawHeight = Math.min(height, FB_HEIGHT);
        const data = snapshot.data;
        let fbIdx = 0;

        for (let y = 0; y < FB_HEIGHT; y++) {
            const inVisibleHeight = y < drawHeight;
            const rowBase = y * width * bpp;
            for (let x = 0; x < FB_WIDTH; x++) {
                if (inVisibleHeight && x < drawWidth) {
                    const off = rowBase + x * bpp;
                    if (type === 2) {
                        if (off + 1 >= data.length) return false;
                        const rgba = decodeRgba5551((data[off] << 8) | data[off + 1]);
                        framebuffer[fbIdx++] = rgba.r;
                        framebuffer[fbIdx++] = rgba.g;
                        framebuffer[fbIdx++] = rgba.b;
                        framebuffer[fbIdx++] = 255;
                    } else {
                        if (off + 2 >= data.length) return false;
                        framebuffer[fbIdx++] = data[off];
                        framebuffer[fbIdx++] = data[off + 1];
                        framebuffer[fbIdx++] = data[off + 2];
                        framebuffer[fbIdx++] = 255;
                    }
                } else {
                    framebuffer[fbIdx++] = 0;
                    framebuffer[fbIdx++] = 0;
                    framebuffer[fbIdx++] = 0;
                    framebuffer[fbIdx++] = 255;
                }
            }
        }

        return true;
    }

    function framebufferIsAllBlack() {
        for (let i = 0; i < framebuffer.length; i += 4) {
            if (framebuffer[i] !== 0 || framebuffer[i + 1] !== 0 || framebuffer[i + 2] !== 0) {
                return false;
            }
        }
        return true;
    }

    function getSnapshotRenderKey(snapshot) {
        if (!snapshot) return 'snap:none';
        return `snap:${snapshot.sequence | 0}:${snapshot.origin | 0}:${snapshot.width | 0}:${snapshot.type | 0}:${snapshot.height | 0}`;
    }

    function getFrameRenderKey(selectedFrame) {
        if (!selectedFrame) return 'frame:none';
        if (selectedFrame.snapshot) return getSnapshotRenderKey(rcp.lastRichVideoSnapshot);
        return [
            'frame',
            selectedFrame.source || 'raw',
            selectedFrame.origin & 0x7FFFFF,
            selectedFrame.width | 0,
            selectedFrame.type | 0,
            selectedFrame.height | 0,
            selectedFrame.sequence | 0,
            (rcp.latestVideoTarget && (rcp.latestVideoTarget.sequence | 0)) || 0,
            rcp.f3dTaskCount | 0,
            rcp.f3dex2TaskCount | 0
        ].join(':');
    }

    function update() {
        const origin = mmu.viRegisters[1] & 0x7FFFFF, width = mmu.viRegisters[2] & 0xFFF, type = mmu.viRegisters[0] & 0x3;

        if (origin !== lastOrigin || width !== lastWidth || type !== lastType) {
            lastOrigin = origin; lastWidth = width; lastType = type;
        }

        const canRenderFrame = shouldRenderVideoFrame({
            origin,
            width,
            type,
            rspTaskCount: rcp.rspTaskCount,
            rdpCommandCount: rcp.rdpCommandCount
        });

        const rd = new DataView(ram.rdram);
        let rendered = false;
        let selectedFrame = null;

        if (typeof rcp.getDeterministicVideoTarget === 'function') {
            selectedFrame = rcp.getDeterministicVideoTarget(origin, width, type);
        }

        if (!selectedFrame && canRenderFrame) {
            const estimated = estimateViHeight();
            const viHeight = (estimated >= 200 && estimated <= FB_HEIGHT) ? estimated : FB_HEIGHT;
            selectedFrame = {
                origin,
                width,
                type,
                height: viHeight
            };
        }

        const requestedRenderKey = getFrameRenderKey(selectedFrame);
        if (requestedRenderKey === lastRenderKey && !frameIsBlank) return;
        let effectiveRenderKey = requestedRenderKey;

        if (selectedFrame) {
            if (selectedFrame.snapshot) {
                // Prefer the finished, actually-displayed front buffer captured at VBlank.
                const snap = (selectedFrame.source === 'vi-vblank' && rcp.displayedFrameSnapshot)
                    ? rcp.displayedFrameSnapshot
                    : rcp.lastRichVideoSnapshot;
                if (snap) {
                    rendered = blitSnapshot(snap);
                    effectiveRenderKey = getSnapshotRenderKey(snap);
                }
            }
            if (!rendered) {
                const drawHeight = selectedFrame.height || FB_HEIGHT;
                rendered = blitFrame(
                    rd,
                    selectedFrame.origin & 0x7FFFFF,
                    selectedFrame.width | 0,
                    selectedFrame.type | 0,
                    drawHeight
                );
            }
        }

        if (
            rendered &&
            rcp.lastRichVideoSnapshot &&
            !selectedFrame?.snapshot &&
            (rcp.lastRichVideoSnapshot.nonBlack | 0) > 0 &&
            framebufferIsAllBlack()
        ) {
            rendered = blitSnapshot(rcp.lastRichVideoSnapshot);
            effectiveRenderKey = getSnapshotRenderKey(rcp.lastRichVideoSnapshot);
        }

        if (!rendered && rcp.lastRichVideoSnapshot) {
            rendered = blitSnapshot(rcp.lastRichVideoSnapshot);
            effectiveRenderKey = getSnapshotRenderKey(rcp.lastRichVideoSnapshot);
        }

        if (rendered) {
            frameIsBlank = false;
            lastRenderKey = effectiveRenderKey;
        } else if (!frameIsBlank) {
            framebuffer.fill(0);
            for (let i = 3; i < framebuffer.length; i += 4) framebuffer[i] = 255;
            frameIsBlank = true;
            lastRenderKey = 'blank';
        }
    }

    // Status overlay (boot takes ~100M steps => tens of seconds of black screen;
    // show progress so that's visible). Click to hide.
    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'position:fixed;top:4px;right:6px;z-index:50;color:#8f8;background:rgba(0,0,0,.55);font:11px monospace;padding:2px 6px;border-radius:3px;cursor:pointer;pointer-events:auto;white-space:pre';
    statusEl.textContent = (glRenderer ? 'WebGL' : 'software') + ' | waiting for ROM…';
    statusEl.addEventListener('click', () => statusEl.remove());
    document.body.appendChild(statusEl);
    let lastStat = { t: 0, steps: 0, frames: 0 };
    let presentedOnce = false;
    function updateStatus(ts) {
        if (!statusEl.isConnected || ts - lastStat.t < 1000) return;
        const steps = cpu.instructionCount || 0;
        const frames = (rcp.f3dTaskCount | 0) + (rcp.f3dex2TaskCount | 0);
        const dt = (ts - lastStat.t) / 1000;
        const mips = ((steps - lastStat.steps) / dt / 1e6).toFixed(1);
        const fps = ((frames - lastStat.frames) / dt).toFixed(1);
        const phase = !cpu.isRunning ? 'waiting for ROM…' : (presentedOnce ? fps + ' fps' : 'booting…');
        statusEl.textContent = (glRenderer ? 'WebGL' : 'software') + ' | ' + mips + 'M steps/s | ' + phase;
        lastStat = { t: ts, steps, frames };
    }

    function animate(ts) {
        requestAnimationFrame(animate);
        updateStatus(ts);
        if (glRenderer) {
            // GL path: blit the FBO the VI is scanning out. The RDRAM framebuffer
            // is not written in GL mode, so the 2D blit path doesn't apply.
            try {
                if (glRenderer.present(mmu.viRegisters[1] & 0x7FFFFF, mmu.viRegisters[2] & 0xFFF)) presentedOnce = true;
            } catch (e) {
                console.error('WebGL present failed, switching to the software renderer:', e);
                const u = new URL(window.location.href);
                if (u.searchParams.get('gl') !== '0') { u.searchParams.set('gl', '0'); window.location.replace(u.href); }
            }
            return;
        }
        if (!lastUpdateTime || (ts - lastUpdateTime) >= updateIntervalMs) {
            update();
            lastUpdateTime = ts;
        }
        presentFrame();
    }
    requestAnimationFrame(animate);

    // Keyboard controls: WASD = analog stick, J=A, K=B, Space=Z, Enter=START,
    // Q/E = L/R, arrow keys = C-buttons. (D-pad has no keyboard binding.)
    const keyMap = {
        'KeyJ': 0x8000, 'KeyK': 0x4000, 'Space': 0x2000, 'Enter': 0x1000,
        'KeyQ': 0x0020, 'KeyE': 0x0010,
        'ArrowUp': 0x0008, 'ArrowDown': 0x0004, 'ArrowLeft': 0x0002, 'ArrowRight': 0x0001
    };
    const stickKeys = { 'KeyW': [0, 80], 'KeyS': [0, -80], 'KeyA': [-80, 0], 'KeyD': [80, 0] };
    const stickHeld = { x: 0, y: 0 };
    function applyInput() { mmu.updateController(mmu.buttons, stickHeld.x, stickHeld.y); mmu.stickX = stickHeld.x; mmu.stickY = stickHeld.y; }
    document.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (keyMap[e.code] !== undefined) { mmu.buttons |= keyMap[e.code]; applyInput(); e.preventDefault(); }
        else if (stickKeys[e.code]) {
            const [sx, sy] = stickKeys[e.code];
            if (sx) stickHeld.x = sx; if (sy) stickHeld.y = sy;
            applyInput(); e.preventDefault();
        }
    });
    document.addEventListener('keyup', (e) => {
        if (keyMap[e.code] !== undefined) { mmu.buttons &= ~keyMap[e.code]; applyInput(); e.preventDefault(); }
        else if (stickKeys[e.code]) {
            const [sx, sy] = stickKeys[e.code];
            if (sx && stickHeld.x === sx) stickHeld.x = 0;
            if (sy && stickHeld.y === sy) stickHeld.y = 0;
            applyInput(); e.preventDefault();
        }
    });

    const masks = { 'a-btn': 0x8000, 'b-btn': 0x4000, 'z-btn': 0x2000, 'start-btn': 0x1000, 'd-up': 0x0800, 'd-down': 0x0400, 'd-left': 0x0200, 'd-right': 0x0100, 'l-btn': 0x0020, 'r-btn': 0x0010, 'c-up': 0x0008, 'c-down': 0x0004, 'c-left': 0x0002, 'c-right': 0x0001 };
    document.querySelectorAll('.btn').forEach(b => {
        const m = masks[b.id];
        const down = () => { mmu.buttons |= m; mmu.updateController(mmu.buttons, mmu.stickX, mmu.stickY); };
        const up = () => { mmu.buttons &= ~m; mmu.updateController(mmu.buttons, mmu.stickX, mmu.stickY); };
        b.addEventListener('mousedown', down); b.addEventListener('mouseup', up);
        b.addEventListener('touchstart', (e) => { e.preventDefault(); down(); }); b.addEventListener('touchend', (e) => { e.preventDefault(); up(); });
    });
});
