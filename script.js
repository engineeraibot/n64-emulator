document.addEventListener('DOMContentLoaded', () => {
    const romFileInput = document.getElementById('rom-file'), romLoaderDiv = document.getElementById('rom-loader'), canvas = document.getElementById('screen');
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), renderer = new THREE.WebGLRenderer({ canvas: canvas });
    const FB_WIDTH = 320, FB_HEIGHT = 240, framebuffer = new Uint8Array(FB_WIDTH * FB_HEIGHT * 4);
    const ram = new Memory(8 * 1024 * 1024), mmu = new MMU(ram), rcp = new RCP(mmu, framebuffer), cpu = new CPU(mmu, rcp);
    mmu.cpu = cpu; mmu.rcp = rcp; window.mmu = mmu; window.cpu = cpu; window.rcp = rcp;

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

    setInterval(() => {
        if (cpu.isRunning) {
            console.log(`Status: PC=0x${cpu.pc.toString(16)} Instr=${cpu.instructionCount} VI_Origin=0x${mmu.viRegisters[1].toString(16)}`);
        }
    }, 2000);

    const texture = new THREE.DataTexture(framebuffer, FB_WIDTH, FB_HEIGHT, THREE.RGBAFormat);
    texture.flipY = true; texture.needsUpdate = true;
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: texture })));

    let lastOrigin = -1, lastWidth = -1, lastType = -1;

    function resize() {
        const w = window.innerWidth, h = window.innerHeight - (document.querySelector('.controls')?.offsetHeight || 0);
        renderer.setSize(w, h);
        const aspect = w / h, fbAspect = FB_WIDTH / FB_HEIGHT;
        if (aspect > fbAspect) { camera.left = -fbAspect; camera.right = fbAspect; camera.top = 1; camera.bottom = -1; }
        else { camera.left = -aspect; camera.right = aspect; camera.top = aspect / fbAspect; camera.bottom = -aspect / fbAspect; }
        camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize); resize();

    function update() {
        const origin = mmu.viRegisters[1] & 0x7FFFFF, width = mmu.viRegisters[2] & 0xFFF, type = mmu.viRegisters[0] & 0x3;

        if (origin !== lastOrigin || width !== lastWidth || type !== lastType) {
            console.log(`VI Change: origin=0x${origin.toString(16)} width=${width} type=${type}`);
            lastOrigin = origin; lastWidth = width; lastType = type;
        }

        if (width > 0 && type >= 2) {
            const rd = new DataView(ram.rdram), bpp = (type === 3) ? 4 : 2;
            let fbIdx = 0;
            const drawWidth = Math.min(width, FB_WIDTH);
            const drawHeight = FB_HEIGHT;

            for (let y = 0; y < drawHeight; y++) {
                const lineOff = origin + y * width * bpp;
                for (let x = 0; x < FB_WIDTH; x++) {
                    if (x < drawWidth) {
                        const a = (lineOff + x * bpp) & 0x7FFFFF;
                        if (type === 2) {
                            const v = rd.getUint16(a, false);
                            framebuffer[fbIdx++] = ((v >> 11) & 0x1F) << 3;
                            framebuffer[fbIdx++] = ((v >> 6) & 0x1F) << 3;
                            framebuffer[fbIdx++] = ((v >> 1) & 0x1F) << 3;
                            framebuffer[fbIdx++] = 255;
                        } else {
                            framebuffer[fbIdx++] = rd.getUint8(a);
                            framebuffer[fbIdx++] = rd.getUint8(a + 1);
                            framebuffer[fbIdx++] = rd.getUint8(a + 2);
                            framebuffer[fbIdx++] = rd.getUint8(a + 3);
                        }
                    } else {
                        framebuffer[fbIdx++] = 0; framebuffer[fbIdx++] = 0; framebuffer[fbIdx++] = 0; framebuffer[fbIdx++] = 255;
                    }
                }
            }
            texture.needsUpdate = true;
        }
    }

    (function animate() { requestAnimationFrame(animate); update(); renderer.render(scene, camera); })();

    const masks = { 'a-btn': 0x8000, 'b-btn': 0x4000, 'z-btn': 0x2000, 'start-btn': 0x1000, 'd-up': 0x0800, 'd-down': 0x0400, 'd-left': 0x0200, 'd-right': 0x0100, 'l-btn': 0x0020, 'r-btn': 0x0010, 'c-up': 0x0008, 'c-down': 0x0004, 'c-left': 0x0002, 'c-right': 0x0001 };
    document.querySelectorAll('.btn').forEach(b => {
        const m = masks[b.id];
        const down = () => { mmu.buttons |= m; mmu.updateController(mmu.buttons, mmu.stickX, mmu.stickY); };
        const up = () => { mmu.buttons &= ~m; mmu.updateController(mmu.buttons, mmu.stickX, mmu.stickY); };
        b.addEventListener('mousedown', down); b.addEventListener('mouseup', up);
        b.addEventListener('touchstart', (e) => { e.preventDefault(); down(); }); b.addEventListener('touchend', (e) => { e.preventDefault(); up(); });
    });
});
