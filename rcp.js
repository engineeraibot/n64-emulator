class RCP {
    constructor(mmu, framebuffer) {
        console.log("RCP Initialized");
        this.mmu = mmu;
        this.framebuffer = framebuffer;
        this.reset();
    }

    reset() {
        console.log("RCP Reset");
    }

    executeCommand(command) {
        // This is a placeholder for a real RCP command processor.
        // For now, we'll use a simple command to change the background color.
        const commandType = (command >> 24) & 0xFF;
        if (commandType === 0x01) { // Set background color
            const color = command & 0x00FFFFFF;
            const r = (color >> 16) & 0xFF;
            const g = (color >> 8) & 0xFF;
            const b = color & 0xFF;
            this.fillFramebuffer(r, g, b);
        }
    }

    fillFramebuffer(r, g, b) {
        for (let i = 0; i < this.framebuffer.length; i += 4) {
            this.framebuffer[i] = r;
            this.framebuffer[i + 1] = g;
            this.framebuffer[i + 2] = b;
            this.framebuffer[i + 3] = 255;
        }
    }
}
