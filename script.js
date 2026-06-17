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
    //
    // Pull-model sink (crackle fix): the old per-block BufferSourceNode scheduling
    // underran after nearly every block whenever the emulator ran below real time
    // (~25-45% of PAL speed), producing a click at each buffer edge. Instead we feed a
    // ring buffer drained by an AudioWorklet (audio thread — immune to the saturated
    // main thread). Playback speed follows a windowed estimate of the emulator's
    // actual production rate, hard-capped at 1.05x (Task #42: an integral controller
    // here wound up on bursty arrivals → chipmunk), with a weak fill trim to hold
    // the jitter buffer near target. Below real time the pitch slows with the emu
    // instead of crackling; at full speed it converges to 1.0x. Underruns fade out and
    // resume with a fade-in instead of clicking. ScriptProcessor fallback for browsers
    // without AudioWorklet.
    let audioCtx = null, workletNode = null, fallbackEngine = null, gainNode = null;
    const AUDIO_GAIN = 0.6;

    // Self-contained pull engine: stringified into the worklet blob AND used
    // directly by the ScriptProcessor fallback, so keep it dependency-free.
    function N64AudioPullEngine(outRate) {
        const CAP = 1 << 17;                    // ring capacity in stereo frames (~3s @44.1k)
        const buf = new Float32Array(CAP * 2);  // interleaved L,R
        let w = 0, r = 0, frac = 0, fill = 0;
        let inRate = 32000, started = false, ramp = 0;
        let lastL = 0, lastR = 0;
        const TARGET = 4096;                    // input frames (~130ms @31.4kHz)
        const START = 2048;                     // refill level before (re)starting
        // Production-rate feedforward (Task #42): estimate the input rate over
        // 0.25s windows (EMA-smoothed) and consume at that rate. No integrator,
        // so bursty arrivals cannot wind speed up; the hard cap makes chipmunk
        // impossible. A weak proportional trim (max ±15%) recenters the fill.
        const WIN = 0.25, SPEED_CAP = 1.0; // backpressure (audio-master sync) makes >1.0 headroom unnecessary
        let inAcc = 0, winT = 0, prodRate = 0, haveRate = false;

        function push(pcm, rate) {
            if (rate > 0) inRate = rate;
            const frames = pcm.length >> 1;
            inAcc += frames;
            for (let i = 0; i < frames; i++) {
                if (fill >= CAP - 2) { r = (r + 1) % CAP; fill--; } // overflow: drop oldest
                buf[w * 2] = pcm[i * 2];
                buf[w * 2 + 1] = pcm[i * 2 + 1];
                w = (w + 1) % CAP; fill++;
            }
        }

        function pull(L, R, n) {
            winT += n / outRate;
            if (winT >= WIN) {
                const inst = inAcc / winT;
                prodRate = haveRate ? prodRate * 0.7 + inst * 0.3 : inst;
                haveRate = true;
                inAcc = 0; winT = 0;
            }
            if (!started) {
                if (fill < START || !haveRate || prodRate <= 0) { L.fill(0, 0, n); R.fill(0, 0, n); return; }
                started = true; ramp = 0;
            }
            // Fill at/above target proves production keeps up -> play at native
            // rate (the backpressure throttle holds it there). Below target the
            // production-rate feedforward governs, trimmed slightly toward refill.
            let speed;
            if (fill >= TARGET) {
                speed = SPEED_CAP;
            } else {
                const trim = 1 + Math.max(-0.15, (fill - TARGET) / (TARGET * 8));
                speed = Math.min(SPEED_CAP, Math.max(0.02, (prodRate / inRate) * trim));
            }
            const ratio = (inRate / outRate) * speed;
            for (let i = 0; i < n; i++) {
                if (fill < 2) {
                    // Underrun: exponential fade from the last sample, then silence
                    // until the ring refills to START (declick).
                    started = false;
                    let v = 1;
                    for (let j = i; j < n; j++) {
                        v *= 0.92;
                        L[j] = lastL * v; R[j] = lastR * v;
                    }
                    lastL = 0; lastR = 0;
                    return;
                }
                const a = r * 2, b = ((r + 1) % CAP) * 2;
                if (ramp < 1) ramp = Math.min(1, ramp + 1 / 256); // fade-in after (re)start
                lastL = L[i] = (buf[a] + (buf[b] - buf[a]) * frac) * ramp;
                lastR = R[i] = (buf[a + 1] + (buf[b + 1] - buf[a + 1]) * frac) * ramp;
                frac += ratio;
                const adv = frac | 0;
                if (adv > 0) { frac -= adv; r = (r + adv) % CAP; fill -= adv; }
            }
        }

        return { push, pull, fill: () => fill };
    }

    const workletSrc = 'const N64AudioPullEngine = ' + N64AudioPullEngine.toString() + ';\n' +
        'class N64SinkProcessor extends AudioWorkletProcessor {\n' +
        '  constructor() { super(); this.engine = N64AudioPullEngine(sampleRate);\n' +
        '    this.port.onmessage = (e) => this.engine.push(e.data.pcm, e.data.rate); }\n' +
        '  process(inputs, outputs) { const o = outputs[0];\n' +
        '    this.engine.pull(o[0], o[1] || o[0], o[0].length);\n' +
        '    if (((this.k = (this.k | 0) + 1) & 7) === 0) this.port.postMessage({ fill: this.engine.fill() });\n' +
        '    return true; }\n' +
        '}\n' +
        'registerProcessor("n64-audio-sink", N64SinkProcessor);\n';

    function startAudioFallback() {
        fallbackEngine = N64AudioPullEngine(audioCtx.sampleRate);
        const sp = audioCtx.createScriptProcessor(2048, 1, 2);
        sp.onaudioprocess = (e) => {
            const ob = e.outputBuffer;
            fallbackEngine.pull(ob.getChannelData(0), ob.getChannelData(1), ob.length);
        };
        sp.connect(gainNode);
    }

    function initAudio() {
        if (audioCtx) return;
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { audioCtx = null; return; }
        gainNode = audioCtx.createGain();
        gainNode.gain.value = AUDIO_GAIN;
        gainNode.connect(audioCtx.destination);
        if (audioCtx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
            const url = URL.createObjectURL(new Blob([workletSrc], { type: 'application/javascript' }));
            audioCtx.audioWorklet.addModule(url).then(() => {
                workletNode = new AudioWorkletNode(audioCtx, 'n64-audio-sink',
                    { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
                workletNode.port.onmessage = (e) => { sinkFill = e.data.fill | 0; sinkFillStamp = performance.now(); };
                workletNode.connect(gainNode);
            }).catch((e) => {
                console.warn('AudioWorklet unavailable, using ScriptProcessor fallback:', e);
                startAudioFallback();
            }).finally(() => URL.revokeObjectURL(url));
        } else {
            startAudioFallback();
        }
    }
    // Unlock on first user gesture (browsers block autoplay). keydown too — the
    // game is keyboard-controlled, so mouse-less players must also get sound.
    const unlockAudio = () => { initAudio(); if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); };
    document.addEventListener('pointerdown', unlockAudio);
    document.addEventListener('keydown', unlockAudio);

    mmu.audioSink = (pcm, dacRate) => {
        if (!audioCtx || pcm.length < 2) return;
        // AI_DACRATE encodes the sample rate: rate = VI_clock / (dacRate + 1). PAL VI clock ~49.66MHz.
        let rate = dacRate > 0 ? Math.round(48681812 / (dacRate + 1)) : 32000;
        if (!(rate >= 8000 && rate <= 48000)) rate = 32000;
        const f32 = new Float32Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
        if (workletNode) workletNode.port.postMessage({ pcm: f32, rate }, [f32.buffer]);
        else if (fallbackEngine) fallbackEngine.push(f32, rate);
    };
    // Audio-master sync (Task #42): pause the CPU loop while the sink has >~160ms
    // banked, locking game speed (and pitch) to real time through the audio clock.
    // Only when audio is actually being consumed — never during boot, before the
    // user gesture, or if fill reports go stale (suspended tab, worklet death).
    let sinkFill = 0, sinkFillStamp = 0;
    const THROTTLE_FILL = 5120; // input frames (~163ms @31.4kHz; sink TARGET is 4096)
    const audioThrottle = () => {
        if (!audioCtx || audioCtx.state !== 'running') return false;
        if (fallbackEngine) return fallbackEngine.fill() > THROTTLE_FILL;
        if (!workletNode) return false;
        if (performance.now() - sinkFillStamp > 300) return false;
        return sinkFill > THROTTLE_FILL;
    };
    // VI vblank wall-clock pacer: cap emulated vblanks at the video field rate
    // (PAL 50Hz / NTSC 60Hz) of REAL time. SM64 paces its game logic on vblank
    // messages, so this locks game speed at 1.0x whenever the host can keep up —
    // including before the audio-unlock gesture / with audio suspended, where the
    // audio-master sync (Task #42) cannot engage. It is a pure rate limiter
    // anchored to "now" whenever the emulator is at/behind real time: no debt is
    // accumulated, so a slow stretch is never followed by a fast-forward burst.
    // Gated on the first graphics task: boot (f3d==0, ~40M steps) stays unpaced —
    // the emulator's approximated DMA/timer durations make pre-game emulated time
    // uncalibrated, and pacing it would stall boot (same reason Task #42 rejected
    // a global counts/sec throttle). NOT a counts/sec throttle: vblank count IS
    // the game's own speed clock, independent of count-rate calibration.
    let viPaceCount = -1, viPaceStamp = 0;
    const viPacer = () => {
        if (((rcp.f3dTaskCount | 0) + (rcp.f3dex2TaskCount | 0)) < 1) return false;
        const c = mmu.viInterruptCount | 0;
        const t = performance.now();
        const periodMs = (mmu.viRegisters[6] & 0x3FF) > 0x240 ? 20 : 50 / 3; // mirrors mmu's PAL/NTSC pick
        if (viPaceCount < 0) { viPaceCount = c; viPaceStamp = t; return false; }
        const ahead = (c - viPaceCount) - (t - viPaceStamp) / periodMs;
        if (ahead <= 0) { viPaceCount = c; viPaceStamp = t; return false; } // at/behind real time: re-anchor
        return ahead > 1; // ~1 field of slack absorbs slice-granularity jitter
    };
    cpu.hostThrottle = () => audioThrottle() || viPacer();
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

    // On-screen analog joystick (touch + mouse via Pointer Events). Drag offset
    // from the pad centre maps to the N64 stick range (±80). Screen-down is
    // negative N64 Y, matching the WASD bindings above (W = +80).
    const joystick = document.getElementById('joystick');
    const joyKnob = document.getElementById('joystick-knob');
    if (joystick) {
        const MAX = 80;                 // N64 stick magnitude
        let activeId = null;            // pointerId currently driving the stick
        let cx = 0, cy = 0, radius = 1; // pad centre + travel radius (px)

        const setStick = (sx, sy) => {
            stickHeld.x = Math.round(sx);
            stickHeld.y = Math.round(sy);
            applyInput();
        };
        const moveKnob = (px, py) => {
            joyKnob.style.transform = `translate(${px}px, ${py}px)`;
        };
        const reset = () => {
            activeId = null;
            moveKnob(0, 0);
            setStick(0, 0);
        };
        const update = (clientX, clientY) => {
            let dx = clientX - cx;
            let dy = clientY - cy;
            const dist = Math.hypot(dx, dy);
            if (dist > radius) { dx = dx / dist * radius; dy = dy / dist * radius; }
            moveKnob(dx, dy);
            // dx/dy are in px within [-radius, radius]; scale to ±MAX, invert Y.
            setStick((dx / radius) * MAX, -(dy / radius) * MAX);
        };

        joystick.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            const r = joystick.getBoundingClientRect();
            cx = r.left + r.width / 2;
            cy = r.top + r.height / 2;
            radius = r.width / 2;
            activeId = e.pointerId;
            try { joystick.setPointerCapture(e.pointerId); } catch (_) {}
            update(e.clientX, e.clientY);
        });
        joystick.addEventListener('pointermove', (e) => {
            if (e.pointerId !== activeId) return;
            e.preventDefault();
            update(e.clientX, e.clientY);
        });
        const release = (e) => {
            if (e.pointerId !== activeId) return;
            e.preventDefault();
            try { joystick.releasePointerCapture(e.pointerId); } catch (_) {}
            reset();
        };
        joystick.addEventListener('pointerup', release);
        joystick.addEventListener('pointercancel', release);
    }
});
