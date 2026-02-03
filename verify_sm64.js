const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    await page.goto('file://' + path.resolve(__dirname, 'index.html'));

    const romPath = path.resolve(__dirname, 'Super Mario 64 (Europe) (En,Fr,De).n64');
    if (fs.existsSync(romPath)) {
        console.log('Loading ROM...');
        const input = await page.$('#rom-file');
        await input.setInputFiles(romPath);

        // Wait for some time to let it run
        await page.waitForTimeout(5000);

        await page.screenshot({ path: 'screenshot.png' });
    } else {
        console.log('ROM not found');
    }

    await browser.close();
})();
