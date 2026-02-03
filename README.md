# n64-emulator

A web-based Nintendo 64 emulator for mobile browsers.

## Current Status: Super Mario 64 Emulation
Estimated completion: **85%**

### Progress:
- [x] CPU: Basic MIPS III/IV instructions (64-bit)
- [x] CPU: FPU (Single & Double precision)
- [x] CPU: Basic CP0 (Interrupts, Timer)
- [x] MMU: KSEG0/KSEG1 translation
- [x] MMU: Hardware register mapping (VI, PI, SI, MI, AI, RI, SP, DPC)
- [x] MMU: PI DMA (Cartridge to RAM)
- [x] MMU: SI DMA (Controller/PIF)
- [x] MMU: PIF HLE (Controller info, EEPROM stubs)
- [x] RCP: RSP HLE (Decompression task)
- [x] RCP: RSP HLE (Graphics task: Fast3D skeleton, Display List parser)
- [x] RCP: RDP Basic Rasterization (Solid triangles, barycentric colors)
- [x] HLE Boot: Skip IPL3, load entry point from ROM header
- [x] Input: Mobile-first controller UI hooked to MMU
- [x] RCP: Matrix stack and coordinate transformations (Required for 3D)
- [x] RCP: Texture mapping and RDP Tile management
- [x] Audio Interface (AI) implementation
- [ ] SI: Full EEPROM/SRAM support
