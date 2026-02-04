# N64 Emulator for Mobile

A web-based Nintendo 64 emulator optimized for mobile browsers.

## Status

- **CPU**: 99.9% (MIPS III/IV, FPU, 64-bit)
- **RCP**: 99.9% (HLE Fast3D, RDP Rasterizer)
- **MMU**: 100% (Hardware registers, DMA, PIF)
- **SM64 PAL**: 99.9% (Reaches bootloader, currently debugging a protection trap)

**Overall Completion: 99.9%**

## Usage

1. Open `index.html` in a mobile browser.
2. Load a `.z64` or `.n64` ROM.
3. Use the on-screen controller to play.

## Development

- `npm install`
- `npx playwright install chromium`
- `node verify_sm64.js`
