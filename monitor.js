const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    page.on('console', msg => {
        console.log(`PAGE LOG [${msg.type()}]: ${msg.text()}`);
    });

    await page.goto('http://localhost:8000');

    console.log("Monitoring for 30 seconds...");
    for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const state = await page.evaluate(() => {
            if (!window.cpu || !window.rcp || !window.mmu) return { error: "Not initialized" };
            return {
                pc: window.cpu.pc.toString(16),
                instr: window.cpu.instructionCount,
                viOrigin: window.mmu.viRegisters[1].toString(16),
                rspTasks: window.rcp.rspTaskCount,
                rdpCmds: window.rcp.rdpCommandCount
            };
        });
        console.log(`State: PC=0x${state.pc} Instr=${state.instr} VI=0x${state.viOrigin} RSP=${state.rspTasks} RDP=${state.rdpCmds}`);
    }

    await browser.close();
})();
