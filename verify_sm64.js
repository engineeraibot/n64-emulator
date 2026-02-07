const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    page.on('console', msg => {
        console.log(`PAGE LOG: ${msg.text()}`);
    });

    const filePath = 'file://' + path.resolve('index.html');
    await page.goto(filePath);
    await page.waitForSelector('input[type="file"]');

    const romPath = path.resolve('Super Mario 64 (Europe) (En,Fr,De).n64');
    if (!fs.existsSync(romPath)) {
        console.error('ROM file not found!');
        process.exit(1);
    }
    console.log('Loading ROM...');
    await page.setInputFiles('input[type="file"]', romPath);

    console.log('Waiting for emulator to run (30 seconds)...');
    await page.waitForTimeout(30000);

    const state = await page.evaluate(() => {
        if (!window.mmu || !window.mmu.cpu) return "No CPU found";
        const cpu = window.mmu.cpu;
        const rcp = window.mmu.rcp;
        return {
            pc: cpu.pc.toString(16),
            instructionCount: cpu.instructionCount,
            halted: cpu.halted,
            isRunning: cpu.isRunning,
            rdpCommandCount: rcp ? rcp.rdpCommandCount : 0,
            viOrigin: window.mmu.viRegisters[1].toString(16)
        };
    });

    console.log('Emulator State:', state);

    await page.screenshot({ path: 'verification_v3.png' });
    console.log('Screenshot saved to verification_v3.png');

    await browser.close();
})();
