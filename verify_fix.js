const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log(`PAGE LOG: ${msg.text()}`);
  });

  const url = 'http://localhost:8080/index.html';
  console.log(`Loading ${url}`);
  await page.goto(url);

  console.log("Waiting for emulator to run for 15 seconds...");
  await page.waitForTimeout(15000);

  const status = await page.evaluate(() => {
    return {
      pc: window.cpu ? window.cpu.pc.toString(16) : 'N/A',
      ic: window.cpu ? window.cpu.instructionCount : 0,
      vi_origin: window.mmu ? window.mmu.viRegisters[1].toString(16) : 'N/A',
      is_running: window.cpu ? window.cpu.isRunning : false
    };
  });

  console.log('Final Status:', status);

  await page.screenshot({ path: 'final_frame.png' });
  await browser.close();
})();
