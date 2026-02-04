# n64-emulator

A web-based Nintendo 64 emulator for mobile browsers.

## Current Status: Super Mario 64 Emulation
Estimated completion: **99.5%**

### Progress:
- [x] CPU: Basic MIPS III/IV instructions (64-bit)
- [x] CPU: FPU (Single & Double precision)
- [x] CPU: Basic CP0 (Interrupts, Timer)
- [x] CPU: Fixed exception handling and PC management bugs
- [x] CPU: Support for LWC2/LDC2/SWC2/SDC2 (NOPs for compatibility)
- [x] MMU: KSEG0/KSEG1 translation
- [x] MMU: Hardware register mapping (VI, PI, SI, MI, AI, RI, SP, DPC)
- [x] MMU: PI DMA (Mirroring and proper 24-bit length masking)
- [x] MMU: SI DMA (Controller/PIF with 8MB bounds)
- [x] MMU: PIF HLE (Controller info, EEPROM read/write, JOYBUS bounds)
- [x] SI: 4kbit EEPROM support for game saves
- [x] RCP: RSP HLE (Decompression task)
- [x] RCP: RSP HLE (Graphics task: Fast3D skeleton, Display List parser)
- [x] RCP: RDP Basic Rasterization (Solid triangles, barycentric colors)
- [x] RCP: Improved RSP/RDP command stubs for SM64 compatibility
- [x] HLE Boot: Skip IPL3, load entry point from ROM header
- [x] Input: Mobile-first controller UI hooked to MMU
- [x] RCP: Matrix stack and coordinate transformations (Required for 3D)
- [x] RCP: Texture mapping and RDP Tile management
- [x] Audio Interface (AI) implementation
