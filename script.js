document.addEventListener('DOMContentLoaded', () => {
    const romFileInput = document.getElementById('rom-file'), romLoaderDiv = document.getElementById('rom-loader'), canvas = document.getElementById('screen');
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), renderer = new THREE.WebGLRenderer({ canvas: canvas });
    const FB_WIDTH = 320, FB_HEIGHT = 240, framebuffer = new Uint8Array(FB_WIDTH * FB_HEIGHT * 4);
    const ram = new Memory(8 * 1024 * 1024), mmu = new MMU(ram), rcp = new RCP(mmu, framebuffer), cpu = new CPU(mmu, rcp);
    mmu.cpu = cpu; mmu.rcp = rcp; window.mmu = mmu;

    romFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => { ram.loadRom(ev.target.result); romLoaderDiv.style.display = 'none'; cpu.run(); };
            reader.readAsArrayBuffer(file);
        }
    });

    const texture = new THREE.DataTexture(framebuffer, FB_WIDTH, FB_HEIGHT, THREE.RGBAFormat);
    texture.flipY = true; texture.needsUpdate = true;
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: texture })));

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
        if (rcp.rdpCommandCount > 0) console.log(`RDP Commands: ${rcp.rdpCommandCount}`);
        const origin = mmu.viRegisters[1] & 0x7FFFFF, width = mmu.viRegisters[2] & 0xFFF, type = mmu.viRegisters[0] & 0x3;
        if (width > 0 && type >= 2) {
            const rd = new DataView(ram.rdram), bpp = (type === 3) ? 4 : 2;
            let fbIdx = 0;
            for (let y = 0; y < FB_HEIGHT; y++) {
                const off = origin + y * width * bpp;
                for (let x = 0; x < FB_WIDTH; x++) {
                    const a = off + x * bpp;
                    if (a + bpp <= 8*1024*1024) {
                        if (type === 2) {
                            const v = rd.getUint16(a, false);
                            framebuffer[fbIdx++] = ((v >> 11) & 0x1F) << 3; framebuffer[fbIdx++] = ((v >> 6) & 0x1F) << 3; framebuffer[fbIdx++] = ((v >> 1) & 0x1F) << 3; framebuffer[fbIdx++] = 255;
                        } else {
                            framebuffer[fbIdx++] = rd.getUint8(a); framebuffer[fbIdx++] = rd.getUint8(a+1); framebuffer[fbIdx++] = rd.getUint8(a+2); framebuffer[fbIdx++] = 255;
                        }
                    } else { fbIdx += 4; }
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
