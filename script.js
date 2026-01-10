document.addEventListener('DOMContentLoaded', () => {
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

    // Fill the framebuffer with a test pattern (gradient)
    for (let j = 0; j < FB_HEIGHT; j++) {
        for (let i = 0; i < FB_WIDTH; i++) {
            const index = (j * FB_WIDTH + i) * 4;
            framebuffer[index] = (i / FB_WIDTH) * 255;     // R
            framebuffer[index + 1] = (j / FB_HEIGHT) * 255; // G
            framebuffer[index + 2] = 0;                     // B
            framebuffer[index + 3] = 255;                   // A (opaque)
        }
    }

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
        // In the future, we'll update the framebufferTexture here
        // For now, it's static
        renderer.render(scene, camera);
    }

    animate();

    // --- Emulator Core ---
    const ram = new Memory();
    const cpu = new CPU(ram);

    // Create a small test program
    // ADDIU R1, R0, 1
    // ADDIU R2, R1, 1
    // ADDIU R3, R2, 1
    ram.write32(0x00000000, 0x24010001);
    ram.write32(0x00000004, 0x24220001);
    ram.write32(0x00000008, 0x24430001);

    // Start the CPU
    cpu.run();


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
