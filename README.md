# n64-emulator

A web-based Nintendo 64 emulator for mobile browsers.

## Current Status: Super Mario 64 Emulation
Estimated completion: **45%**

### Progress:
- [x] CPU: Basic MIPS III/IV instructions (64-bit)
- [x] CPU: FPU (Single & Double precision)
- [x] CPU: Basic CP0 (Interrupts, Timer)
- [x] MMU: KSEG0/KSEG1 translation
- [x] MMU: Hardware register mapping (VI, PI, SI, MI, AI, RI, SP, DPC)
- [x] MMU: PI DMA (Cartridge to RAM)
- [x] RCP: RSP HLE (Decompression task)
- [x] RCP: RDP Command processing skeleton
- [x] HLE Boot: Skip IPL3, load entry point from ROM header
- [ ] RCP: Full Fast3D RSP Microcode HLE (Required for SM64 graphics)
- [ ] RCP: Full RDP Rasterization (Required for SM64 graphics)
- [ ] Audio Interface (AI) implementation
- [ ] SI: Full Controller/EEPROM support
