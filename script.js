document.addEventListener('DOMContentLoaded', () => {
    const romFileInput = document.getElementById('rom-file');
    const romLoaderDiv = document.getElementById('rom-loader');


    const canvas = document.getElementById('screen');
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new THREE.WebGLRenderer({ canvas: canvas });

    const FB_WIDTH = 320;
    const FB_HEIGHT = 240;

    const framebuffer = new Uint8Array(FB_WIDTH * FB_HEIGHT * 4);

    const ram = new Memory(8 * 1024 * 1024);
    const mmu = new MMU(ram);
    window.mmu = mmu;
    const rcp = new RCP(mmu, framebuffer);
    const cpu = new CPU(mmu, rcp);
    mmu.cpu = cpu;
    mmu.rcp = rcp;

    romFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const romBuffer = e.target.result;
                console.log(`ROM loaded: ${file.name} (${romBuffer.byteLength} bytes)`);
                ram.loadRom(romBuffer);
                romLoaderDiv.style.display = 'none';
                cpu.run();
            };
            reader.readAsArrayBuffer(file);
        }
    });

    const framebufferTexture = new THREE.DataTexture(framebuffer, FB_WIDTH, FB_HEIGHT, THREE.RGBAFormat);
    framebufferTexture.flipY = true;
    framebufferTexture.needsUpdate = true;

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.MeshBasicMaterial({ map: framebufferTexture });
    const screenQuad = new THREE.Mesh(geometry, material);
    scene.add(screenQuad);

    function resizeRenderer() {
        const controls = document.querySelector('.controls');
        const controlsHeight = controls ? controls.offsetHeight : 0;
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight - controlsHeight;

        renderer.setSize(newWidth, newHeight);

        const screenAspect = newWidth / newHeight;
        const fbAspect = FB_WIDTH / FB_HEIGHT;

        if (screenAspect > fbAspect) {
            camera.left = -fbAspect; camera.right = fbAspect;
            camera.top = 1; camera.bottom = -1;
        } else {
            camera.left = -screenAspect; camera.right = screenAspect;
            camera.top = screenAspect / fbAspect; camera.bottom = -screenAspect / fbAspect;
        }
        camera.updateProjectionMatrix();
    }

    window.addEventListener('resize', resizeRenderer);
    resizeRenderer();

    let lastViOrigin = -1;
    function updateDisplay() {
        mmu.viRegisters[4] = mmu.viRegisters[3];
        mmu.miRegisters[2] |= 0x08; // VI Interrupt
        mmu.updateInterrupts();

        const status = mmu.viRegisters[0];
        const origin = mmu.viRegisters[1] & 0x00FFFFFF;
        const width = mmu.viRegisters[2] & 0xFFF;
        const type = status & 0x03; // 2: 16-bit, 3: 32-bit

        if (origin !== lastViOrigin && width !== 0) {
            console.log(`VI Update: Origin=0x${origin.toString(16)} Width=${width} Type=${type}`);
            lastViOrigin = origin;
        }

        if (width === 0 || type < 2) return;

        const rdramView = new DataView(ram.rdram);
        let fbIdx = 0;
        const bpp = (type === 3) ? 4 : 2;

        for (let y = 0; y < FB_HEIGHT; y++) {
            const lineOffset = origin + y * width * bpp;
            for (let x = 0; x < FB_WIDTH; x++) {
                if (x < width) {
                    const addr = lineOffset + x * bpp;
                    if (addr + bpp <= ram.rdram.byteLength) {
                        if (type === 2) { // 16-bit RGBA5551
                            const val = rdramView.getUint16(addr, false);
                            framebuffer[fbIdx++] = ((val >> 11) & 0x1F) << 3;
                            framebuffer[fbIdx++] = ((val >> 6) & 0x1F) << 3;
                            framebuffer[fbIdx++] = ((val >> 1) & 0x1F) << 3;
                            framebuffer[fbIdx++] = 255;
                        } else if (type === 3) { // 32-bit RGBA8888
                            framebuffer[fbIdx++] = rdramView.getUint8(addr);
                            framebuffer[fbIdx++] = rdramView.getUint8(addr + 1);
                            framebuffer[fbIdx++] = rdramView.getUint8(addr + 2);
                            framebuffer[fbIdx++] = 255; // Alpha
                        } else { fbIdx += 4; }
                    } else { fbIdx += 4; }
                } else {
                    framebuffer[fbIdx++] = 0;
                    framebuffer[fbIdx++] = 0;
                    framebuffer[fbIdx++] = 0;
                    framebuffer[fbIdx++] = 255;
                }
            }
        }
        framebufferTexture.needsUpdate = true;
    }

    function animate() {
        requestAnimationFrame(animate);
        updateDisplay();
        renderer.render(scene, camera);
    }

    animate();

    const buttonMasks = {
        'a-btn': 0x8000, 'b-btn': 0x4000, 'z-btn': 0x2000, 'start-btn': 0x1000,
        'd-up': 0x0800, 'd-down': 0x0400, 'd-left': 0x0200, 'd-right': 0x0100,
        'l-btn': 0x0020, 'r-btn': 0x0010,
        'c-up': 0x0008, 'c-down': 0x0004, 'c-left': 0x0002, 'c-right': 0x0001
    };

    let currentButtons = 0;
    let currentStickX = 0;
    let currentStickY = 0;

    const buttons = document.querySelectorAll('.btn');
    const joystick = document.querySelector('.joystick');

    buttons.forEach(button => {
        const mask = buttonMasks[button.id];
        const onPress = () => { currentButtons |= mask; mmu.updateController(currentButtons, currentStickX, currentStickY); };
        const onRelease = () => { currentButtons &= ~mask; mmu.updateController(currentButtons, currentStickX, currentStickY); };

        button.addEventListener('mousedown', onPress);
        button.addEventListener('mouseup', onRelease);
        button.addEventListener('touchstart', (e) => { e.preventDefault(); onPress(); });
        button.addEventListener('touchend', (e) => { e.preventDefault(); onRelease(); });
    });

    if (joystick) {
        const onMove = (e) => {
            const rect = joystick.getBoundingClientRect();
            const clientX = e.clientX || e.touches[0].clientX;
            const clientY = e.clientY || e.touches[0].clientY;
            const x = ((clientX - rect.left) / rect.width - 0.5) * 2;
            const y = ((clientY - rect.top) / rect.height - 0.5) * -2;
            currentStickX = Math.max(-128, Math.min(127, Math.floor(x * 127)));
            currentStickY = Math.max(-128, Math.min(127, Math.floor(y * 127)));
            mmu.updateController(currentButtons, currentStickX, currentStickY);
        };
        const onEnd = () => {
            currentStickX = 0;
            currentStickY = 0;
            mmu.updateController(currentButtons, currentStickX, currentStickY);
        };

        joystick.addEventListener('mousemove', (e) => { if (e.buttons & 1) onMove(e); });
        joystick.addEventListener('touchmove', (e) => { e.preventDefault(); onMove(e); });
        joystick.addEventListener('mouseup', onEnd);
        joystick.addEventListener('touchend', onEnd);
    }
});
