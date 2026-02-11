const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    page.on('console', msg => {
        console.log(`[Browser] ${msg.text()}`);
    });

    await page.goto('file://' + __dirname + '/index.html');

    const romPath = __dirname + '/Super Mario 64 (Europe) (En,Fr,De).n64';

    const upload = await page.$('input[type="file"]');
    await upload.setInputFiles(romPath);

    console.log("ROM uploaded, waiting for execution...");

    // Run for 30 seconds
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
            const status = await page.evaluate(() => {
                const cpu = window.mmu.cpu;
                if (!cpu) return null;
                return {
                    pc: cpu.pc.toString(16),
                    count: cpu.instructionCount,
                    running: cpu.isRunning
                };
            });
            if (status) {
                console.log(`Status: PC=0x${status.pc} Instructions=${status.count} Running=${status.running}`);
            }
        } catch (e) {}
    }

    await page.screenshot({ path: 'screenshot_v4.png' });
    console.log("Screenshot taken: screenshot_v4.png");

    await browser.close();
})();
