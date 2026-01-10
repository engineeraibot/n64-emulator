document.addEventListener('DOMContentLoaded', () => {
    const romFileInput = document.getElementById('rom-file');
    const romLoaderDiv = document.getElementById('rom-loader');


    const canvas = document.getElementById('screen');
    const scene = new THREE.Scene();
    // Use an orthographic camera to display the 2D framebuffer without perspective
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new THREE.WebGLRenderer({ canvas: canvas });

    // N64 framebuffer dimensions
    const FB_WIDTH = 320;
    const FB_HEIGHT = 240;

    // Create a buffer to hold the framebuffer data (RGBA)
    const framebuffer = new Uint8Array(FB_WIDTH * FB_HEIGHT * 4);

    // --- Emulator Core ---
    const ram = new Memory();
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

                // Hide the ROM loader and start the emulator
                romLoaderDiv.style.display = 'none';
                cpu.run();
            };
            reader.readAsArrayBuffer(file);
        }
    });

    // The framebuffer is now managed by the RCP, so we don't need to fill it here.

    // Create a Three.js texture from the framebuffer data
    const framebufferTexture = new THREE.DataTexture(framebuffer, FB_WIDTH, FB_HEIGHT, THREE.RGBAFormat);
    framebufferTexture.needsUpdate = true; // Important!

    // Create a plane geometry to cover the screen
    const geometry = new THREE.PlaneGeometry(2, 2);
    // Create a material using the framebuffer texture
    const material = new THREE.MeshBasicMaterial({ map: framebufferTexture });
    // Create a mesh and add it to the scene
    const screenQuad = new THREE.Mesh(geometry, material);
    scene.add(screenQuad);

    function resizeRenderer() {
        const controlsHeight = document.querySelector('.controls').offsetHeight;
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight - controlsHeight;

        renderer.setSize(newWidth, newHeight);

        // Adjust camera to maintain aspect ratio of the framebuffer
        const screenAspect = newWidth / newHeight;
        const fbAspect = FB_WIDTH / FB_HEIGHT;

        if (screenAspect > fbAspect) {
            camera.left = -fbAspect;
            camera.right = fbAspect;
            camera.top = 1;
            camera.bottom = -1;
        } else {
            camera.left = -screenAspect;
            camera.right = screenAspect;
            camera.top = screenAspect / fbAspect;
            camera.bottom = -screenAspect / fbAspect;
        }
        camera.updateProjectionMatrix();
    }

    window.addEventListener('resize', resizeRenderer);


    // Initial resize
    resizeRenderer();

    function animate() {
        requestAnimationFrame(animate);

        // Continuously update the texture with the framebuffer data from the RCP
        framebufferTexture.needsUpdate = true;

        renderer.render(scene, camera);
    }

    animate();

    // --- Emulator Core ---


    const buttons = document.querySelectorAll('.btn');
    const joystick = document.querySelector('.joystick');

    buttons.forEach(button => {
        button.addEventListener('mousedown', () => handleButtonPress(button.id));
        button.addEventListener('mouseup', () => handleButtonRelease(button.id));
        button.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleButtonPress(button.id);
        });
        button.addEventListener('touchend', (e) => {
            e.preventDefault();
            handleButtonRelease(button.id);
        });
    });

    joystick.addEventListener('mousedown', handleJoystickMove);
    joystick.addEventListener('mouseup', handleJoystickRelease);
    joystick.addEventListener('mousemove', handleJoystickMove);

    joystick.addEventListener('touchstart', (e) => {
        e.preventDefault();
        handleJoystickMove(e.touches[0]);
    });
    joystick.addEventListener('touchmove', (e) => {
        e.preventDefault();
        handleJoystickMove(e.touches[0]);
    });
    joystick.addEventListener('touchend', (e) => {
        e.preventDefault();
        handleJoystickRelease();
    });


    function handleButtonPress(buttonId) {
        console.log(`${buttonId} pressed`);
    }

    function handleButtonRelease(buttonId) {
        console.log(`${buttonId} released`);
    }

    function handleJoystickMove(event) {
        const rect = joystick.getBoundingClientRect();
        const x = event.clientX - rect.left - (rect.width / 2);
        const y = event.clientY - rect.top - (rect.height / 2);
        console.log(`Joystick move: x=${x}, y=${y}`);
    }

    function handleJoystickRelease() {
        console.log('Joystick released');
    }
});
