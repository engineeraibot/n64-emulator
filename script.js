document.addEventListener('DOMContentLoaded', () => {
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
