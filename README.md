# n64-emulator

A web-based Nintendo 64 emulator for mobile browsers.

## Current Status: Super Mario 64 Emulation

The boot intro and title screen geometry are now visible — Mario's silhouette,
skin tones, and the SUPER MARIO 64 logo region all render. See
`test-results/sm64-final-selected.png` for a recent capture. Many triangles
are still mis-clipped or under-shaded; that's the next area of work.

### Recent fixes
- [x] HLE Boot: now actually copies ROM[0x1000..0x101000] (1 MB) into RDRAM at
      the entry point and sets the post-IPL3 register state, so the CPU starts
      executing real game code instead of NOPs. Previously the CPU spun forever
      at boot.
- [x] RCP matrix pipeline: `multiplyMatrices` and the vertex transform in
      `handleG_VTX` are now consistent row-major with `readMatrix`, so libultra
      `gSPMatrix` produces the correct MVP. Triangle output went from ~179
      visible pixels to ~8.8k+ after the fix and the boot intro is recognisable.

### Progress:
- [x] CPU: Basic MIPS III/IV instructions (64-bit)
- [x] CPU: FPU (Single & Double precision)
- [x] CPU: Basic CP0 (Interrupts, Timer)
- [x] CPU: Fixed exception handling and PC management bugs
- [x] CPU: Support for COP2/COP3 instructions as NOPs (PAL compatibility)
- [x] CPU: Proper $s1 initialization for CIC-6103 (PAL)
- [x] MMU: KSEG0/KSEG1 translation
- [x] MMU: Hardware register mapping (VI, PI, SI, MI, AI, RI, SP, DPC)
- [x] MMU: PI DMA (Mirroring, 24-bit length, and Anti-Piracy trap mitigation)
- [x] MMU: SI DMA (Controller/PIF with 8MB bounds)
- [x] MMU: PIF HLE (Controller info, EEPROM read/write, JOYBUS bounds, PAL seeds)
- [x] SI: 4kbit EEPROM support for game saves
- [x] RCP: RSP HLE (Decompression task)
- [x] RCP: RSP HLE (Graphics task: Fast3D skeleton, Display List parser)
- [x] RCP: RDP Basic Rasterization (Solid triangles, barycentric colors)
- [x] RCP: Improved RSP/RDP command stubs for SM64 compatibility
- [x] HLE Boot: Load 1 MB of game code from ROM into RDRAM, jump to entry point
- [x] Input: Mobile-first controller UI hooked to MMU
- [x] RCP: Matrix stack and coordinate transformations (Required for 3D)
- [x] RCP: Row-major matrix pipeline (readMatrix / multiplyMatrices / vertex transform aligned)
- [x] RCP: Texture mapping and RDP Tile management
- [x] Audio Interface (AI) implementation
- [x] CPU: COP2/COP3 opcodes handled as NOPs (PAL compatibility)
- [x] MMU: Optimized PI DMA with anti-piracy trap improvements
- [x] RCP: Added try-catch and logging to RSP tasks

### Additional fixes this session
- [x] Removed all-negative-W cull in `drawTriangle` — libultra's row-vector
      projection convention legitimately produces negative W for visible
      vertices, so dropping them was wrong.
- [x] F3D vs F3DEX2 matrix-PUSH bit interpretation:
      F3D's `gSPMatrix` macro XORs in `G_MTX_PUSH=0x04`, so at the RSP-command
      level bit 2 SET means **NOPUSH** for F3D. F3DEX2 uses the bit directly
      (`bit 0 = PUSH`). `handleG_MTX` now branches on `rspState.isF3DEX2`.
- [x] Perspective-correct interpolation now uses `|W|` magnitudes so the
      barycentric-weighted texture/shade interpolation does not flip sign with
      libultra's negative-W output.

### Fixes in this pass
- [x] **Row-vector MVP convention.** The previous transform applied vertices
      as column-vector `M * v_col` even though libultra is row-vector
      (`v_row * M`). With a libultra perspective matrix that has `M[2][3] = -1`,
      column-vector math computed `W ≈ (2nf/(n−f)) · z_eye` (off by ~20×),
      crushing every visible point. `handleG_VTX` now picks the c-th *column*
      of MVP (`output[c] = Σ_r v[r]·mvp[r·4+c]`) and `multiplyMatrices` is
      called as `(mv, p)` so `MVP = MV · P` for row-vector composition.
- [x] **Near-plane clipping in clip space.** Triangles whose vertices
      straddled the eye plane were perspective-divided with a tiny `W`,
      flinging one corner to extreme screen coordinates. Vertices now keep
      their `cx, cy, cz, cw` clip-space coords; `drawTriangle` runs a
      Sutherland–Hodgman clip against the near-W plane before any divide,
      then re-projects clipped vertices to screen space. Works in both
      positive- and negative-W hemispheres.
- [x] **Full RDP color-combiner emulation.** `combineColor` was discarding
      shade entirely and copying texture directly. It now evaluates the
      cycle-1 `(A − B) · C + D` formula with the proper source selectors
      (TEXEL0/SHADE/PRIMITIVE/ENV/1/0 plus the 5-bit C-only `_ALPHA`
      variants), and `rasterizeTriangle` always runs the combiner so
      shaded-only surfaces modulate correctly.
- [x] **Backface culling.** `drawTriangle` now respects `G_CULL_FRONT` /
      `G_CULL_BACK` (Fast3D bits `0x1000`/`0x2000`, F3DEX2 `0x0200`/`0x0400`)
      using the screen-space signed area.
- [x] **`updateUseTexture` classifier.** Was treating `COMBINED` (source 0)
      as a texture source and missing `TEXEL1` and the `_ALPHA` variants.
      Fixed with per-field classifiers; shaded-only triangles no longer
      accidentally consult a stale TMEM.
- [x] **Tests:** added `test/rcp-logic.test.js` — 19 cases covering the
      combiner modes, the row-vector MVP math, near-plane clipping in both
      W hemispheres, `clamp255`, the new `updateUseTexture` classifier, and
      signed-area winding. Suite now runs 25 tests, all passing.

### Fixes in this pass (May 21 evening)
- [x] **Node.js headless harness.** Built `tmp_node_run.js`, a Node-only run
      harness that loads the four module files via `vm.runInContext`,
      single-steps the CPU until N F3D tasks or a time budget elapses, then
      dumps the framebuffer to PNG. Lets us iterate on rcp.js without a
      browser when Playwright can't be installed (no Chromium download
      access in some sandboxes).
- [x] **`handleG_FILLRECT` inclusive bounds.** The old loop used
      `y < floor(y2/4)` / `x < floor(x2/4)`, which dropped the last row and
      column. A full-screen `gDPFillRectangle(0, 0, w-1, h-1)` clear was
      therefore leaving a 1-pixel strip of the depth buffer at 0, which
      meant any triangle whose bounding box touched that strip got
      immediately rejected. Bounds are now `<=` and clamp to the
      framebuffer extent.
- [x] **Fillrect 16-bit dual-pack.** The N64 RDP writes two 16-bit pixels
      per cycle from a 32-bit fillColor (high half to even pixels, low half
      to odd). Now respected — games that pack distinct values into the
      two halves get the right per-pixel result instead of always seeing
      the high half.
- [x] **Off-screen triangle AABB reject in `drawTriangle`.** When all three
      vertices sit on the same off-screen side of the viewport, skip
      Sutherland–Hodgman + fan triangulation entirely. Cuts ~6 % of
      triangles per boot run (clip pipeline was previously running for
      no visible output). Tracked via `drawStats.offscreenTriangles`.
- [x] **Depth-monotone screen Z.** Replaced the bogus `sz = ndcZ *
      vp.scale[2] + vp.trans[2]` viewport map with
      `sz = 1 - 1/(1 + |tw|)`. The old code assumed NDC.z ∈ [-1, 1], but
      libultra's row-vector projection produces tz/tw values like -29..-32
      for visible SM64 boot geometry, so every depth value saturated to 0
      and depth ordering was effectively disabled. The new mapping is
      monotone in |tw|, bounded to [0, 1), and well-defined for negative
      tw (uses `|tw|`).
- [x] **Tests:** added 13 cases covering inclusive-fillrect spans (full
      screen, 1-pixel, OOB clamp), depth monotonicity, depth bounds, sign
      handling, and the off-screen AABB reject for each of the 4 screen
      sides plus a visible-and-straddling control. Suite is now 44 tests,
      all passing.

### Follow-up fixes in this pass
- [x] **Basic `G_LIGHTING`.** When `geometryMode & 0x00020000` is set, vertex
      bytes 12..14 are now treated as signed normals (not RGB), and per-vertex
      shade is computed as `ambient + Σ max(0, N·L_dir) · L_color` over any
      lights the game configured via `G_MOVEMEM` with `G_MV_L0..L7`. The
      ambient slot at index `numLights` is honored. If no lights have been
      sent yet, a default ambient + key light keeps Mario from rendering
      pitch-black during boot.
- [x] **`G_MW_NUMLIGHT` decoded.** Handles both Fast3D's `(n−1)·32` and
      F3DEX2's `n·24` value encodings; clamps to `[0, 8]`.
- [x] **F3DEX2 viewport / light MOVEMEM indices.** `handleG_MOVEMEM` now
      accepts `0x08` (F3DEX2 viewport) and `0x0A` (F3DEX2 single light)
      alongside the Fast3D `0x80` / `0x86..0x94` set.
- [x] **Z-write deferred past alpha-discard.** The Z compare still rejects
      farther pixels early, but the actual depth-buffer write is now held
      until after the color/alpha-compare test passes. The old order
      poisoned the depth buffer with transparent pixels, occluding real
      surfaces behind sprite edges.
- [x] **Tests:** added 6 more cases for default-light shading, custom-light
      shading with N·L clamp, and `G_MW_NUMLIGHT` decoding for both
      microcodes. Suite is now 31 tests, all passing.

### Still to do for a clean title screen
- [ ] Full RDP rasterizer (sub-pixel precision, edge coefficients from the
      G_TRI_FILL command stream rather than barycentric weights, true
      perspective-correct ST with N64's 10.5 fixed-point format)
- [ ] 2-cycle combiner support (currently only cycle 1 is evaluated; SM64
      uses 2-cycle for several materials)
- [ ] Real RDP blender (BL_M1, BL_M2 modes from othermode_lo) for
      transparency and Z-write/Z-cmp control
- [ ] Lighting (G_LIGHTING) — vertex normal × normalized light vector;
      shade is currently the raw RGB packed in the vertex
- [ ] Texture LOD / mipmaps and proper TMEM allocation tracking
- [ ] Audio (aspMain) task — silent SP/AI right now, which the game's
      audio thread eventually blocks on
- [ ] Tighter CP0 timing so frame pacing matches what the title-screen
      logic expects before transitioning to the demo loop
