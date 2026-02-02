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
    const rcp = new RCP(mmu, framebuffer);
    const cpu = new CPU(mmu, rcp);

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

    function updateDisplay() {
        mmu.miRegisters[2] |= 0x08; // VI Interrupt

        const origin = mmu.viRegisters[1] & 0x00FFFFFF;
        const width = mmu.viRegisters[2] & 0xFFF;

        if (width === 0) return;

        const rdramView = new DataView(ram.rdram);
        let fbIdx = 0;
        for (let y = 0; y < FB_HEIGHT; y++) {
            for (let x = 0; x < FB_WIDTH; x++) {
                if (x < width) {
                    const addr = origin + (y * width + x) * 2;
                    if (addr + 2 <= ram.rdram.byteLength) {
                        const val = rdramView.getUint16(addr, false);
                        framebuffer[fbIdx++] = ((val >> 11) & 0x1F) << 3;
                        framebuffer[fbIdx++] = ((val >> 6) & 0x1F) << 3;
                        framebuffer[fbIdx++] = ((val >> 1) & 0x1F) << 3;
                        framebuffer[fbIdx++] = 255;
                    } else { fbIdx += 4; }
                } else { fbIdx += 4; }
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

    const buttons = document.querySelectorAll('.btn');
    const joystick = document.querySelector('.joystick');

    buttons.forEach(button => {
        button.addEventListener('mousedown', () => console.log(`${button.id} pressed`));
        button.addEventListener('mouseup', () => console.log(`${button.id} released`));
        button.addEventListener('touchstart', (e) => { e.preventDefault(); console.log(`${button.id} pressed`); });
        button.addEventListener('touchend', (e) => { e.preventDefault(); console.log(`${button.id} released`); });
    });

    if (joystick) {
        joystick.addEventListener('mousedown', handleJoystickMove);
        joystick.addEventListener('touchstart', (e) => { e.preventDefault(); handleJoystickMove(e.touches[0]); });
    }

    function handleJoystickMove(event) {
        const rect = joystick.getBoundingClientRect();
        const x = event.clientX - rect.left - (rect.width / 2);
        const y = event.clientY - rect.top - (rect.height / 2);
        console.log(`Joystick move: x=${x}, y=${y}`);
    }
});
