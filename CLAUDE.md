# N64 Emulator — Session Resume Notes

## Goal
JavaScript N64 emulator that runs **Super Mario 64 (Europe) (En,Fr,De).n64** properly in the browser.
**Progress: ~90%.** Full per-task history (Tasks #1–#38) is archived in `HISTORY.md` — consult it
before re-deriving any old diagnosis. **The game is now fully playable in-sandbox**: file-select →
intro cutscene → Mario controllable on castle grounds (`state_playable`). Remaining: throughput
for real-time browser play, plus in-game verification of fog/castle-interior/level scenes.

## Status

### Working (do not regress)
- HLE boot, full OS: threads, CP0 Count/Compare timer, TLB, 64-bit GPR correctness (`gprHi` high words).
- F3DEX2 + Fast3D display lists; software RDP: lighting, depth, near-plane clip,
  clamp/mirror/wrap addressing, 1-cycle AND 2-cycle combiner+blender (fog-capable),
  textures RGBA16/RGBA32/CI4/CI8+TLUT/IA4/IA8/IA16/I4/I8.
- Full G_LOADBLOCK texture loads + COPY-mode texrects (Task #36 — before this, every
  block-loaded texture was 75% empty and title texrects rendered solid white).
- **Title + wallpaper/START scenes visually verified** (the verification baseline, see below).
- VI double-buffer deterministic frame capture (`vi-vblank` snapshot = finished displayed frame).
- Controller end-to-end (osContInit → osContStartReadData → game structs; `mmu.updateController()`).
- Complete HLE audio chain: command-list interpreter (LOADBUFF/RESAMPLE/MIXER/INTERLEAVE/ADPCM/
  ENVMIXER/SETVOL), AI DMA → WebAudio sink in `script.js`.
- Throughput ~2.0–2.7M steps/s OS/menus; 0.44M goddard; **0.72M in-game** (Task #39, +14%).
- **Menus + in-game verified (Tasks #37–#38)**: EU language/options screen, file-select,
  Peach-letter cutscene, Lakitu fly-in, castle exterior, Mario spawn, dialog boxes, HUD,
  stick-driven running. Texrects always sample TMEM (G_TEXTURE enable is triangle-only);
  MIRROR addressing actually mirrors (pre-mask bug); Fast3D NUML decode fixed (was: every
  lit vertex used the white fallback light → gray Mario/terrain).
- **Menu navigation in-sandbox**: `tmp_navigate.js` (`IN=/OUT=/SEQ='[[steps,buttons,x,y],...]'`)
  — START=0x1000, A=0x8000, B=0x4000; stick range ±80. Edge-detection means PRESSES need a
  release phase (holding START from boot never fires `down & ~prev`).

### THE blocker: throughput (for real-time browser play)
Everything (input/OS/timer/render/audio/menus/gameplay) is proven correct end-to-end in-sandbox.
- **Task #40 DONE: WebGL renderer** (`gl-renderer.js`). In-game CPU-side throughput with GL
  capture: **4.2M steps/s (~11 fps)** vs 0.74M (2 fps) SW — rasterization moved to the GPU.
  Browser uses GL by default (`?gl=0` = SW path). Visually verified equal to SW on
  SELECT FILE / state_playable / title+START via the FakeGL harness (Verification step 6).
- **Task #39 measured the in-game split**: rasterizer = 81% of wall time (CPU+OS+DL alone runs
  3.8M steps/s). JS micro-opt of the per-pixel pipeline is SATURATED.
- Remaining levers for full speed (PAL 25 fps ⇒ ~9.6M steps/s; ~385k steps/frame in-game):
  1. **CPU block-JIT** — now THE lever (was bounded at +12% while the SW rasterizer dominated;
     with GL the interpreter is ~95% of wall time);
  2. DL-interpreter / vertex-transform micro-opt (small);
  3. real-browser GL driver overhead is NOT yet measured — verify fps in Chrome first.
- **GL renderer architecture (Task #40)**: rcp.js taps (`if (this.glr)`) in drawTriangle (post
  near-clip/cull, pre viewport-clip), handleG_TEXRECT (post coord decode), handleG_FILLRECT
  (post bounds; depth-image fills → glClear(DEPTH)); `commitVideoTargetCollection` flushes.
  gl-renderer.js batches by RDP state, runs the 1/2-cycle combiner generically in one fragment
  shader (TEXEL1≡TEXEL0 like SW; non-memory blender cycles in-shader, the one memory cycle =
  GL fixed blend), decodes TMEM tiles to RGBA8 (content-hash cache), one FBO per
  (colorImage,width) with lazily-attached SHARED depth renderbuffers. present() picks the FBO
  within 8 lines of VI_ORIGIN (tight window — SM64's buffers are exactly one frame apart, a
  frame-sized window matches the stale neighbor). NOT byte-exact vs SW (GPU floats) — verify
  GL changes visually. NB: title ★START BLINKS (some frames legitimately draw no texrects).
- **Do NOT retry**: per-pixel allocation removal / shared scratch objects (Task #24, 0.66–0.82×);
  inlining sampleTexture's RGBA16 path into the raster loop (Task #39, -3%); DataView→Uint8Array
  gave only +1% (V8 already inlines DataView).

### Open after throughput
Castle interior / level scenes; verify on real in-game states: 2-cycle/fog,
ADPCM order-2 prediction, ENVMIXER ramps.

### Known intentional limitations
- TEXEL1 aliases TEXEL0 (no second tile sample; fine for SM64 fog — fix: sample `tile+1` in 2-cycle).
- SLT/SLTU/SLTI/SLTIU compare low 32 bits only (perf; fine for sign-extended operands).
- A_POLEF is a no-op; RESAMPLE is linear interp (not 4-tap gaussian).
- TMEM is **flat row-major** (no hardware odd-line interleave / hi-lo bank split) — loader
  (LOADBLOCK/LOADTILE/LOADTLUT) and sampler are consistent; keep them that way.
- Intro timer: f3d stays 0 until ~40M steps from boot (real ~5s delay) — not a hang.

## Verification baseline (run after EVERY change)
1. Tests: `for f in test/*.js; do node --test "$f"; done` → **3+38+3 = 44/44**.
   (`npm test` with isolation=none can hang in this sandbox — environment artifact.)
2. Title: `node tmp_titlerender.js` (~40 s) → f3d 96, origin **0x3b5000**, **nonBlack=75541**,
   `test-results/sm64-title-fresh.png` md5 **79b3d46383efdda6bcf2b9cb9ab3862f** (zoomed-in
   colourful MARIO letters with woodgrain sides — the real intro starts zoomed, then pulls
   back). For renderer changes, prove md5-identical by re-rendering with the backup rcp.
3. Wallpaper scene: `STATE=state_advfix1 STOPF3D=20 OUT_PNG=... node tmp_resume_render.js` →
   nonBlack=**76160** (tiled dark-blue "SUPER MARIO 64" wallpaper). Also
   `STATE=state_title_full STOPF3D=20` → nonBlack=**76157**, same wallpaper + colourful
   ★START text (bright-pixel bbox x20..79 y204..218). NB: the pre-#36 claim that this scene's
   "horizontal banding is genuine content" was WRONG — the bands were the LOADBLOCK 25%-load
   bug (Task #36).
4. Byte-exact RCP check: `tmp_verify33.js` pattern (lockstep old-vs-new RDRAM CRC from a state).
4b. In-game scenes (Task #37–38): `STATE=state_select_file STOPF3D=3` → SELECT FILE screen with
   readable text (MARIO A–D, SCORE/COPY/ERASE/OPTION); `STATE=state_playable STOPF3D=3` →
   Mario in color (red cap/shirt, BLUE overalls — if gray/white, the numLights decode broke)
   in front of the castle. Render via `tmp_resume_render.js`.
5. `node --check cpu.js rcp.js` immediately after any edit.
6. GL renderer (Task #40): `STATE=state_select_file STOPF3D=3 OUT_PNG=... node tmp_glrender.js`
   renders through the REAL N64GLRenderer on the FakeGL stub (`tmp_glsim.js` — JS twin of the
   shaders + the WebGL1 subset used). Compare visually vs the SW render of the same state
   (GL nonBlack: select-file **73541** / playable **76104** / title_full **75922**). ★START
   blinks — `STATE=state_title_full STOPF3D=18` shows it, 20 doesn't. Stop only at f3d task
   boundaries (mid-frame stops tear GL targets). Perf: `GL=1 node tmp_glbench.js` (no-op
   drawArrays) → **4.2M steps/s** in-game (SW: 0.74M).

## Reusable tooling (don't rebuild)
- `tmp_boot.js` — `buildMachine()` (fresh emulator in a vm sandbox; console muted = ~2.5M steps/s).
- `tmp_state.js` — `saveState/loadState` (RDRAM + CPU/MMU/RCP, byte-exact resume).
- Checkpoints: `state_title_fix` (title, controller bits set — START experiments),
  `state_title_full`, `state_t24b` (deep title, perf bench), `state_advfix1` (menu/raster bench),
  `state_f3d96_fix`. **New (Task #37–38):** `state_fileselect` (EU options screen),
  `state_select_file` (SELECT FILE screen, hand near ERASE), `state_game1..13` (intro cutscene
  chain), `state_playable` (**Mario controllable at castle grounds spawn — THE gameplay state**),
  `state_run3` (Mario mid-run on grass). Format: `<name>.rdram` + `<name>.json`.
- `tmp_advance.js` (`IN=/OUT=` chain runs), `tmp_resume_render.js` (`STATE=/STOPF3D=/OUT_PNG=`),
  `tmp_bench.js` (`STATE=/N=` throughput A/B via swapping a `*_backup.js`), `tmp_dis.js`/`tmp_disc.js`
  (disasm from state / live), `tmp_cyc35.js` (cycle-type census).
- **GL tooling (Task #40, KEEP):** `tmp_glsim.js` (FakeGL WebGL1 stub + shader twin),
  `tmp_glrender.js` (`STATE=/STOPF3D=/OUT_PNG=` GL render of a state via FakeGL),
  `tmp_glbench.js` (`STATE=/N=/GL=1` capture-overhead throughput),
  `tmp_domsmoke.js` (`GL=0/1` — runs index.html's REAL browser load path under jsdom +
  FakeGL; catches browser-only crashes like the Task #40 black-screen resize() bug.
  jsdom lives in /tmp/gltest; npm-registry installs work, binary downloads are blocked).
- Unit/regression tests to KEEP and re-run when touching related code:
  `tmp_t24daddu.js`, `tmp_t25_gprhi.js` (CPU 64-bit), `tmp_audunit.js`, `tmp_adpcm_unit.js`,
  `tmp_envmix_unit.js` (audio DSP), `tmp_tlut_unit.js`, `tmp_t35_unit.js` (RDP modes/textures).
- Graphics audit probes (Task #36, keep): `tmp_texaudit.js` (`STATE=/STOPF3D=` — dumps every
  distinct tile used in a frame as PNG to test-results/texaudit-*.png; THE tool that caught the
  LOADBLOCK bug), `tmp_triaudit.js` (per-triangle combine/tile/shade/texel census).
- Other `tmp_*.js` are one-off probes — safe to delete; recreate from HISTORY.md recipes.

## ⚠️ Sandbox FUSE gotcha (bites every few sessions)
The bash mount can serve a **stale/truncated** copy of large hot files (`cpu.js`, `rcp.js`)
after Windows-side `Edit`s — and a naive bash `read→write` round-trip then **corrupts the real
file**. Rules:
1. Edit hot files **bash-side with python3** (read → string-replace with asserted unique
   anchors → write), then `node --check` immediately.
2. Verify the Windows side afterwards with the `Grep` tool.
3. If a file looks truncated: do NOT round-trip it. Splice the good head onto the unchanged
   tail from the newest `*_backup.js` (find a unique anchor line present in both).

## Conventions
- Before any risky change to `cpu.js`/`rcp.js`, copy to `<file>_pre_<task>_backup.js`.
  **Never delete `*_backup.js`** (they're also the A/B baseline for `tmp_bench.js`).
- CPU 64-bit model: `gpr` = low 32 (Int32Array), `gprHi` = high 32; every 32-bit-result op
  maintains `gprHi` (sign-extend/zero/copy — see HISTORY.md Task #25). 64-bit consumers:
  `ld/sd`, `_reg64()/_setReg64()`, doubleword ops, COP1 moves. `hi/lo` likewise have `hiH/loH`.
- FPU FR=0: every 32-bit FPR access must go through `getFprAddr32()` (odd regs live in the
  upper half of the even pair).
- Renderer perf wins must be **byte-identical** (prove via lockstep RDRAM CRC + title md5).
- Snapshot selection: `bestRichSnap` = richest drawn frame; deterministic display path =
  `rcp.displayedFrameSnapshot` captured at VBlank (`vi-vblank`). VI_ORIGIN = draw origin + 0x280.
- Debug entry points: thread dispatch `__osDispatchThread` @0x802f40b0; timer
  `serviceCompareTimer()` in cpu.js; SP task start via `handleSpWrite` CLR_HALT; joybus =
  64-byte `mmu.pifRam`, `mmu.controllerDebug` counters; goddard fatal printer 0x8018c2c8.

## How to run
```bash
# tests
for f in test/*.js; do node --test "$f"; done
# headless title render (~40s)
node tmp_titlerender.js
# browser: open index.html, load the .n64 via UI
```
ROMs in repo root: `Super Mario 64 (Europe) (En,Fr,De).n64`, `squaresdemo.n64` (simple test).

## Repository layout
`cpu.js` (MIPS R4300i interpreter) · `rcp.js` (RSP DL interpreter + RDP software renderer +
HLE audio) · `mmu.js` (memory map, TLB, SI/PI/VI/AI DMA, joybus) · `memory.js` (ROM loader) ·
`script.js` (browser scheduler + WebAudio sink) · `video-utils.js` · `monitor.js` ·
`index.html`/`style.css` · `test/` (node test suite) · `test-results/` (PNG snapshots) ·
`*_backup.js` (keep) · `state_*` (checkpoints) · `tmp_*.js` (probes) · `HISTORY.md` (full
Task #1–#36 session log).

## Task log (details in HISTORY.md)
| # | What |
|---|------|
| 1–8 | Segment decode, depth map, F3DEX2 0xDB, TEXRECT offsets, snapshot pick, culling winding, vertex lighting |
| 9–10 | BigInt→Number CPU (+ branch-likely, LD/SD endianness, gprHi); CP0 timer edge-fire → OS revived |
| 11 | TLB implemented (osMapTLB) — goddard boot panic fixed |
| 12–13 | Goddard panic root-caused → broken 64-bit doubleword shifts fixed ("N%d"→"N0" bug) |
| 14 | Save-state tooling; post-title "freeze" = throughput, not hang |
| 15 | FPU FR=0 odd-reg fix; near-plane clip culls behind-camera (W≤0) |
| 16–17 | Menu bands diagnosed; LoadBlock TMEM odd-line swizzle removed |
| 18 | 1-cycle RDP blender (ALPHA_CVG_SEL coverage) |
| 19–20 | Controller blocker → SWR/SDR opTable swap fix; input works end-to-end |
| 21 | Texture clamp/mirror (cmS/cmT) addressing |
| 22 | +52% CPU (idle-check gating); START-gate = mid-intro, not input |
| 23 | MFC1/DMFC1 gprHi fix |
| 24 | START propagation proven; DADD family 64-bit fix; allocation-removal = regression (don't retry) |
| 25 | Comprehensive gprHi maintenance (whole bug class closed) |
| 26–27 | Rasterizer span clipping +23%; per-pixel combiner/blender alloc removal +14% |
| 28 | VI-origin/VBlank deterministic displayed frame |
| 29–31 | HLE audio: command-list interpreter + AI sink; VADPCM decode; ENVMIXER(exp)+SETVOL |
| 32–33 | Triangle-invariant hoisting +28–30%; per-triangle mux decode + TEX*SHADE fast path |
| 34 | G_LOADTLUT + CI4/CI8 + IA16/IA4 |
| 35 | SETOTHERMODE masked RMW + 2-cycle combiner/blender + RGBA32 |
| 36 | G_LOADBLOCK lrs decode (was loading 25% of every texture!) + COPY-mode texrect bypass — title/menu graphics finally correct; new baselines |
| 37 | START edge-detect toggle → file-select reached; texrects sample TMEM regardless of G_TEXTURE enable (menu text was solid white); sampleTexture pre-mask stripped the mirror bit (MIRROR degraded to WRAP — font glyphs rendered 180°); EU options + SELECT FILE verified |
| 38 | Fast3D G_MW_NUMLIGHT decode `((raw&0x7FFFFFFF)>>5)-1` (raw 0x80000040 = 1 light; old decode → numLights=8 → lights[8] undefined → EVERY lit vertex used white fallback). Mario/Peach/terrain colors fixed. Game advanced to playable: intro cutscene, spawn, dialogs, running all verified |
| 39 | In-game throughput +14% byte-identical (LOADBLOCK bulk copy; inlined barycentrics; scalar shade; Uint8Array z/fb; unified vertex shapes). Measured rasterizer=81% of in-game wall time; JS micro-opt saturated; forward plan = WebGL renderer (browser) > span rewrite > CPU JIT |
| 40 | WebGL renderer (gl-renderer.js): rcp.js GL taps, state-batched über-shader (generic combiner + in-shader/fixed-function blender split), TMEM→RGBA8 texture cache, FBO per color image + shared depth RBs, VI-origin present. FakeGL twin (tmp_glsim.js) verifies in-sandbox: select/playable/title visually = SW. In-game 0.74→4.2M steps/s (2→11 fps). Browser defaults to GL (?gl=0=SW), MessageChannel scheduler, keyboard input |
