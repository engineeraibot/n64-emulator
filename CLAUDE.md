# N64 Emulator — Session Resume Notes

## Goal
JavaScript N64 emulator. Primary target **Super Mario 64 (Europe)** runs properly (~90%); the
expanded goal (Task #47+) is to **run any commercial N64 game**, starting with **Mario Kart 64
(Europe) (Rev A)** and **Ocarina of Time (Europe)** (both ROMs in repo root). Full per-task
history is archived in `HISTORY.md` — consult it before re-deriving any old diagnosis.
**SM64 is fully playable in-sandbox**: file-select → intro cutscene → Mario controllable on castle
grounds (`state_playable`).

## ✅ Task #60 DONE (negative result) — compile-to-JS block JIT built + proven byte-identical, but SLOWER; throughput is V8-bound
The compile-to-JS basic-block JIT that #59 predicted is **built, gated behind `cpu.useJit`
(default OFF), and PROVEN byte-identical** — but it runs **2–4.4× SLOWER** than the interpreter,
so it stays off. This settles the throughput question: **JS-interpreted N64 is at V8's ceiling; no
call-based JIT can beat it.** Read this before re-attempting ANY CPU-speed work:
  - **What was built (`cpu.js`, all gated behind `this.useJit`, interpreter `step()` path UNTOUCHED
    + verified literally byte-identical to `cpu_pre_t60_backup.js`):** `stepJit()` (runs one block
    per call; falls back to `step()` for control-flow / non-RDRAM PC); `compileBlock()` (`new
    Function`-emits one JS fn per straight-line basic block, ending before the first
    branch/jump/COP0-ERET/COP1-branch); `_jitClassify()` (per-opcode block-or-stop + leaf-handler
    resolution); `validateBlock()` (SMC self-check: cached words == live RDRAM on entry, recompile
    on mismatch); `_stepTail()` (byte-identical copy of step()'s fetch/execute tail, used when an
    interrupt/timer diverts PC mid-block). Each compiled slot inlines the FULL per-instruction
    bookkeeping (instructionCount / Count-every-2 / checkInternalEvents-every-0x7F / MI-mirror /
    interrupt-check) + a `pc!==expected` divergence bail, then calls the leaf handler **directly via
    a closed-over reference** (monomorphic per call-site, NOT an `opTable[opcode]` indirect lookup).
    MAX 32 instrs/block. Known accepted limit: SMC that rewrites a not-yet-executed instruction
    *within the currently-executing block* isn't caught (entry-validation only) — never observed in
    the verified games.
  - **PROVEN byte-identical (don't re-verify from scratch):** `tmp_t60_verify.js` (interp-A vs
    jit-B built from the SAME cpu.js, co-advanced by instructionCount, compares pc at every
    alignment point + final RDRAM CRC) → **IDENTICAL** RDRAM CRC + final pc + instrCount on SM64
    menu (state_advfix1), SM64 playable, OoT scene, MK64 race, MK64 title. Plus **44/44** tests,
    SM64 title md5 **e958048b…**, and `tmp_t59_verify.js CPUFILE_A=cpu_pre_t60_backup.js` interp
    lockstep IDENTICAL (the interpreter path is unchanged). Backup `cpu_pre_t60_backup.js`.
  - **THE result — JIT is SLOWER, the lever is dead:** `tmp_t60_time.js` reports REAL-instruction
    rate (subtracts idle fast-forward skips, which dominate most checkpoints — 80–95% — and
    otherwise inflate any instructionCount-based rate to a meaningless 15–60M/s). Interp → JIT
    real-rate: OoT scene **5.9 → 1.3M/s (4.4× slower)**, SM64 menu **2.4 → 1.1M/s (2.2×)**, MK64
    race **1.3 → 0.7M/s (1.9×)**. Disabling SMC validation entirely (`tmp_t60_iso.js SKIPVAL=1`)
    changed NOTHING (1.23 vs 1.14M/s) → **validation is NOT the cost.** The slowdown is intrinsic:
    the big `new Function` block (32 slots × inline bookkeeping + divergence check + a NON-inlined
    handler call) optimizes WORSE under V8 than the tight monomorphic `step()` loop, whose
    `opTable[opcode]` indirect call V8's inline cache already makes cheap. This is exactly #59's
    "threaded code can't win" prediction — and it holds even for monomorphic direct calls and even
    with zero SMC overhead. Probes KEEP: `tmp_t60_verify.js`, `tmp_t60_time.js`, `tmp_t60_iso.js`.
  - **The ONE untested lever (predicted to also lose): TRUE source-body inlining** — emit each hot
    handler's *body* as inline JS statements (real ALU expressions on gpr/gprHi/cp0, no call at
    all). It's the only thing left that removes the call cost, but #60's evidence predicts it loses
    too (per-slot bookkeeping + divergence check + the size of a body-inlined 32-slot generated
    function will likely optimize worse than the interpreter's hot loop; V8 de-opts huge generated
    fns). If a future session insists on trying: REUSE the #60 scaffold (block decoder +
    `_jitClassify` + `stepJit`/`validateBlock`/`_stepTail`), swap ONLY the codegen to emit bodies
    for the hot ALU/immediate set (SLL/SRL/SRA/SxLV/ADDU/SUBU/AND/OR/XOR/NOR/SLT[U]/ADDIU/SLTI[U]/
    ANDI/ORI/XORI/LUI; call-through the rest), and **KILL it the moment a body-inlined block fails
    to beat interp real-rate on OoT scene** — do not sink another session in. **Honest standing
    call: the browser already runs SM64/MK64 acceptably via the GL renderer; CPU throughput is
    V8-bound and not worth more JIT effort.**

## ▶ NEXT TASK (Task #61) — pivot to game coverage (throughput is settled): OoT title/intro capture + F3DEX2 texgen-lookat
Throughput is now empirically bound (Task #60), so the productive frontier is game correctness/
coverage, not speed. Two concrete items, the first primary:
  - **(Primary) Drive OoT to a real title/intro frame — PARTIALLY DONE / re-scoped (carried from #59).**
    #59 drove OoT headlessly from `state_oot_n64logo` (instr 419M) through the full CPU-bound load
    to the rendered **opening interior scene** (Link's house, nb **65673** = exactly
    `state_oot_scene`), confirming the whole logo→scene path end-to-end from a clean boot. **But the
    classic Triforce-over-Hyrule-field title was NOT isolated**: the boot path goes logo → long
    black Yaz0 load (hot loops `0x80034628` bzero / `0x800d6178` CACHE / `0x800b71xx` scene-proc,
    8714 distinct sampled PCs = productive load, not a spin) → straight into the interior scene; the
    first geometry frame is already nb 65673 (interior), so either the title auto-advances to the
    attract/intro or it needs the **controller connected** to hold on a "Press Start" frame. **Fresh
    checkpoints saved: `state_oot_drive4`** (deep into the black load, ~1.0B instr past the logo, just
    before geometry — the best resume point) **and `state_oot_drive5`** (interior scene rendered from
    a clean logo boot). `state_oot_title` is **STILL MISLABELED** — it is a byte-copy of the logo
    (identical instr 419,513,030, renders nb 3306). To actually capture the title next time: connect
    the controller (joybus) before/through the drive and render the FIRST few geometry frames out of
    `state_oot_drive4` looking for a Hyrule-field/Triforce frame distinct from the interior; if none
    exists, accept that this build advances logo→intro and retitle the goal "capture the OoT intro
    cutscene / Deku Tree". Probe: `tmp_t55_chain.js` (`INSTATE=/OUTSTATE=/BUDGET=ms`, ~5M steps/s,
    ~190M steps per 38s call), `tmp_t55_render2.js` (`INSTATE=/ADV=/OUT_PNG=`), `tmp_t59_pcsample.js`
    (top-PC histogram to tell load-vs-spin).
  - **(Optional polish) F3DEX2 lookat for texgen** (unchanged from #58): `rspState.lookat[0/1]`
    (LOOKATX/Y) is captured but `handleG_VTX` texgen still dots the normal against world X/Y. Wire
    `rspState.lookat` into the texgen dot for OoT's shiny/env-mapped surfaces.

**Verified-correct render state to NOT regress (Task #58):** OoT scene SW nb **65673** (was 65700
pre-lights-fix — the fix is a real, correct change, see below) / GL nb **73688** (was 73791); OoT
logo fades in SW (nb 3306) AND GL (nb ~3300 mid-fade at ADV=8, →0 fully-faded-out at ADV≥30 — the
boot logo legitimately fades to black). Backups `rcp_pre_t58_backup.js`, `gl-renderer_pre_t58_backup.js`.
New probes (KEEP): `tmp_t58_lights.js` (G_MV_LIGHT decode + lights-array + computeLitShade dump),
`tmp_t58_shadeuse.js` (does the combiner surface SHADE colour?), `tmp_t58_fadetrace.js` (OoT
1/2-cycle fillrect combiner/blender/base-colour census), `tmp_t58_mk64fill.js` /`tmp_t58_mk64ab.js`
(MK64 fillrect census + composite-vs-skip A/B render), `tmp_t58_gldump.js` (per-target GL nb).
THE byte-identical guard for non-F3DEX2 games is still `tmp_t57_nohit.js` (`ROMNAME=/INSTATE=/ADV=`
→ compositeHits 0 + bestNb).

**Verified-correct render state to NOT regress (Task #58):** OoT scene SW nb **65673** (was 65700
pre-lights-fix — the fix is a real, correct change, see below) / GL nb **73688** (was 73791); OoT
logo fades in SW (nb 3306) AND GL (nb ~3300 mid-fade at ADV=8, →0 fully-faded-out at ADV≥30 — the
boot logo legitimately fades to black). Backups `rcp_pre_t58_backup.js`, `gl-renderer_pre_t58_backup.js`.
New probes (KEEP): `tmp_t58_lights.js` (G_MV_LIGHT decode + lights-array + computeLitShade dump),
`tmp_t58_shadeuse.js` (does the combiner surface SHADE colour?), `tmp_t58_fadetrace.js` (OoT
1/2-cycle fillrect combiner/blender/base-colour census), `tmp_t58_mk64fill.js` /`tmp_t58_mk64ab.js`
(MK64 fillrect census + composite-vs-skip A/B render), `tmp_t58_gldump.js` (per-target GL nb).
THE byte-identical guard for non-F3DEX2 games is still `tmp_t57_nohit.js` (`ROMNAME=/INSTATE=/ADV=`
→ compositeHits 0 + bestNb).

**CPU throughput is SETTLED — do NOT re-attempt a CPU JIT (Task #60 closed this).** PAL 25 fps would
need ~9.6M steps/s in-game; we're at ~1.8M menu / ~0.7M in-game-SW / **~5.0–5.9M pure-CPU**. The
compile-to-JS basic-block JIT was built and MEASURED **2–4.4× SLOWER** than the interpreter (Task
#60 above), validation cost ruled out — the interpreter is at V8's inline-cache/inlining ceiling and
no call-based block JIT can beat it. Profiled OoT scene-load hot loops (Task #55/#59,
`tmp_t55_diag.js`/`tmp_t59_pcsample.js`): `bzero` byte-memset (0x80034628), `CACHE` line loops
(0x800d6178), scene-processing (0x800b71xx), boot-region loop (0x80001270); PI DMA very active
(healthy forward progress, no spin). The only untested lever (true source-body inlining) is
predicted to also lose — see Task #60 for the kill-criteria if anyone insists. Treat the browser GL
renderer as the shipping path for real-time speed; spend effort on game coverage, not CPU speed.

Scope carefully before touching `cpu.js`/`rcp.js`; keep SM64 baselines byte-identical (lockstep
RDRAM CRC + title md5) and prove F3DEX2 changes via `isF3DEX2` gating + MK64 A/B render md5.
Checkpoints: **`state_oot_scene`** (entry — step ~28 f3dex2 tasks to render the room),
`state_oot_scene_deep` (geometry active), `state_oot_n64logo`, `state_oot_probe1..3`. Probes:
`tmp_t55_render2.js` (per-colorImage render+nb), `tmp_t55_tri/mtx/stage/cull.js` (vertex/matrix/
reject-stage tracers), `tmp_t55_chain.js` (long headless step+save), `tmp_ootprof.js`.

### Multi-game status (Task #47 — in progress)
Both new ROMs **boot cleanly** through the existing HLE boot (CIC auto-detected: MK64→6102,
OoT→6105; entry point from header; code executes for 25M+ steps with no panic) and **dispatch RSP
tasks** (OoT runs 231 gfx tasks, MK64 runs gfx+audio).
**Current multi-game state (after Task #58):** **MK64 (EU) renders title → menus → in-race
gameplay cleanly** (SW + GL); the in-race frontier is closed. **OoT (EU) renders its "NINTENDO 64"
boot logo (fading in/out SW+GL) AND its first in-game 3D scene WITH TEXTURES, CORRECT LIGHTS, and
DEPTH** (textured + lit interior room, `state_oot_scene`, SW nonBlack **65673** / GL **73688**) —
the render blocker is broken; the scene is textured, depth-ordered, and lit. OoT was never one bug:
it needed (a) enough interpreter throughput to finish the Yaz0 scene-load (it does, given ~800M+
steps headless), (b) **three F3DEX2 render fixes** in Task #55 (G_MTX flag decode, negative-W
hemisphere, G_GEOMETRYMODE clear-mask), (c) **two undispatched F3DEX2 commands** in Task #56
(G_TEXTURE 0xD7 → textures; G_MOVEMEM 0xDC → viewport), and (d) Task #57/#58 cleanup: depth already
worked (viewport-z spread), 1/2-cycle fade overlays composite (SW #57 + GL #58), and the **F3DEX2
light-slot decode off-by-one** was fixed (#58 — units 0/1 are LOOKATX/Y, lights start at unit 2;
the old `slot=ofs/24−1` injected a bogus green up-light + wrong ambient). The only OoT work left is
driving to the Triforce/field title (throughput-gated → CPU block-JIT) and optional texgen-lookat
polish.
Microcode is now identified **authoritatively from the ucode_data version string** (OSTask+0x18),
not guessed from DL bytes — `detectMicrocodeTriScale()` in rcp.js sets `rspState.ucodeName` +
`triIndexScale`:
  - SM64 "RSP SW Version 2.0D" → F3D, idx×10 (unchanged).
  - MK64 "F3DEX 0.95" → F3DEX 1.x, idx×**2** (was wrongly ×10 → degenerate tris). `G_QUAD`
    (0xB5) now dispatches to handleG_TRI2 (was a no-op; MK64 emits ~4800/frame). MK64 now
    rasterizes ~11k correctly-indexed tris/frame.
  - OoT "F3DZEX fifo 2.06H" → F3DEX2 gen, idx×2 (matches prior opcode-scan flag).
**Task #48 — both games now render recognizable frames** (see `MULTI_GAME_FINDINGS.md`):
  - **MK64: clean title screen + mode-select menu.** Root cause of black was **G_TEXGEN**
    (env-mapping), not the texture path: MK64 sets G_TEXTURE_GEN (0x40000) so vertices store
    s=t=0 and the RSP must synthesize texcoords from the modelview-transformed normal.
    `handleG_VTX` now does this (`rspState.texgenSpan` tunable). States `state_mk64_title`/`_menu`.
    (Remaining: some menu-cell UI textures still striped.)
  - **OoT: "NINTENDO 64" boot logo renders.** Two fixes: (a) **F3DEX2 G_DL (0xDE) push/branch was
    inverted** (PUSH=0x00 call / NOPUSH=0x01 branch) → scene-DL ENDDL returned from the whole
    frame, 0 tris; (b) **G_FILLRECT only flat-fills in FILL/COPY cycle modes** — OoT's 2-cycle
    fade-overlay fillrect was wiping each frame black. Now OoT draws geometry + sets colorImage.
    State `state_oot_n64logo`. (Remaining: drive scene-load boot for the Triforce/field title;
    composite 1/2-cycle fade overlays; possibly S2DEX for some menus.)
**Task #49 — MK64 reaches in-race gameplay rendering.** Root cause of striped menus was
  `handleG_LOADTILE` packing rows CONTIGUOUSLY into TMEM instead of at the tile's `line`-word
  stride. MK64 draws its menu background in 321-wide RGBA16 strips with `line`=81 words (324
  texels): 642 data bytes per 648-byte row, so contiguous packing drifted every row by 3 texels
  → diagonal striping. Fix writes each row at `off + (y-y0)*tile.line*8`, matching the sampler's
  `tt*tile.line*8` row stride (and GL `_decodeTile`, which reads the same way). Byte-identical
  wherever row bytes == line*8 (SM64: title md5 IDENTICAL, all baselines unchanged). General
  RDP-correctness fix → helps any game. Result: **MK64 navigates GAME SELECT → mode → class →
  MAP SELECT (with working 3D track preview) → loads a track → renders the race in 3D** (road,
  barriers, grass correct; upper-screen skybox/distant scenery still glitched — next frontier).
  New states: `state_mk64_d1..d4`, **`state_mk64_race`** (in-race, Luigi Raceway). Backup
  `rcp_pre_loadtile_backup.js`. Drive probe `tmp_mk64drive.js` (`INSTATE=/ADV=/PERIOD=/OUTSTATE=`).
**Task #51 — MK64 upper-screen "rainbow streaks" FIXED (root cause: F3DEX 1.x G_VTX count
  decode off by one).** `handleG_VTX`'s "else" branch decoded BOTH F3D (SM64) and F3DEX 1.x
  (MK64) with the Fast3D layout (`num=(low16>>4)&0x3F`). F3DEX 1.x uses a DIFFERENT G_VTX word:
  count `n` in bits 10..15 of the low halfword, `v0`/dest in bits 16..23, DMA byte length
  `n*16-1` in bits 0..9. Decoding `low16>>4` of `n*16-1` yields **n-1**, so the **last vertex of
  every F3DEX1 load was never written** -> a stale buffer slot. MK64's distant scenery is a
  triangle fan that loads 2 fresh rim verts (slots 0..2) per tri and reuses the 4th slot as a
  shared apex - that 4th slot was stale (a far vertex w~1436 from an old load), so ~230 thin tris
  radiated from one false apex = the streaks. Fix: new F3DEX 1.x branch gated on
  `triIndexScale===2 && !isF3DEX2`: `num=((hi&0xFFFF)>>>10)&0x3F`, `dest=(hi>>16)&0xFF`.
  **MK64 in-race now renders correctly** (balloons, MARIO/checkered banner, Luigi's-Raceway
  grandstands+crowd, sky; no streaks); title + GAME SELECT menu still clean. General F3DEX-1.x
  fix (helps any F3DEX/F3DLX/S2DEX/L3DEX 1.x game). SM64 (F3D, idx*10) uses the untouched Fast3D
  branch -> **byte-IDENTICAL** (title md5 e958048b..., select_file 73541/GL 73542, playable 76099,
  boblevel 75500, 3/3 test files). Backup `rcp_pre_t51_backup.js`. Probes (KEEP):
  `tmp_mk64idx.js` (per-tri vtx index + load-seq cross-ref - caught the stale slot),
  `tmp_mk64vtxraw.js` (raw G_VTX word histogram - decoded the bit layout), `tmp_mk64check.js`.
  Remaining MK64 frontier: a thin green near-plane sliver across center (a few tris with negative
  clip-w / off-screen x~2208 surviving the near-plane clip).
**Task #52 — true frustum near-plane clip for F3DEX/F3DEX2; MK64 "green wedge" re-diagnosed.**
  `clipTriangleNearPlane` clipped against an ad-hoc **W=1 plane** (heuristic for SM64/goddard
  behind-camera geometry), NOT the real near plane — so clipper-generated verts sit on W=1 with
  large CX and project to e.g. (-84354,-14086), which the viewport clip clamps into slivers. Fix:
  for the modern microcodes (`isF3DEX2 || triIndexScale===2`) clip in clip space against the
  **true near plane `cz+cw>=0`** (libultra `NDC_z=cz/cw`, near at -1) plus `W>eps`, via new generic
  `clipClipPlane(poly, distFn)` (single-plane Sutherland–Hodgman). **SM64 stays on the untouched
  legacy W=1 path (F3D, idx*10) → byte-IDENTICAL.** Verified byte-identical on EVERY tested state
  (latent/forward-looking — current checkpoints don't visibly cross the near plane the bad way):
  SM64 title md5 e958048b…, playable 76099, OoT logo md5 36c1f8f1… (peak nb 7377), MK64 title md5
  db5def1c…, MK64 race md5 1262d589…, 44/44. General robustness win for "any game" on F3DEX/F3DEX2.
  Backup `rcp_pre_t52_backup.js`.
  **Re-diagnosis (disproves #51's guess):** the central green wedge is NOT a near-clip sliver — the
  mixed-cw grass tris #51 blamed clip OFF-SCREEN LEFT and the new near-clip leaves MK64 race
  byte-identical. Pixel-traced (`tmp_mk64pix.js`) the wedge to a screen-space alpha-blended fan:
  combiner **0xff99ff/0xff327f3f**, I4 tex (fmt4/0), omLo 0x504240, gm 0x802205 (no TEXGEN), apex
  fixed at screen (130,136) colour **(0,255,0) a153**, rim white, **all s=t=0** → samples only
  texel(0,0) → flat green cone (persists as camera moves). Next: either the per-vertex s/t should
  vary across the fan (I4 gradient) but arrive 0, or the alpha blend (a153) should make it far more
  transparent. Do NOT fix blind (shared combiner/blend, regression-prone). Probes (KEEP):
  `tmp_mk64pix.js` (per-pixel writer trace), `tmp_mk64wedge2.js`, `tmp_mk64clip.js`,
  `tmp_mk64green.js`, `tmp_mk64sliver.js`.
**Task #53 — MK64 "green wedge" FIXED + OoT logo backdrop FIXED (I-format alpha=intensity).**
  The green fan's combiner (`0xff99ff/0xff327f3f`, 1-cycle) is **color=SHADE** (apex green/rim
  white) and **alpha=`TEXEL0_ALPHA*SHADE_ALPHA`**; the tile is an **I4 radial lens-flare**, so the
  flare shape lives in TEXEL0_ALPHA. Bug: the sampler returned **`a=255` for the I (intensity)
  format** (`rcp.js sampleTexture` fmt4 AND GL `gl-renderer.js _decodeTile` fmt4) — but N64 I
  format sets **alpha = intensity** (IA with A=I). With a=255 the flare mask vanished → flat green
  cone. Fix (1 line each, SW+GL): I texel `a=v`. **MK64 race:** cone gone, flare faint, the
  buried **"MARIO KART" start banner now shows** (SW+GL). **OoT logo windfall:** the wrong opaque
  **blue box** behind "NINTENDO 64" was an I backdrop — now correctly masked to text on black
  (peak nb 7377→4123, new md5 `4451f892…`). SM64 PRESERVED (fmt4 only used where combiner ignores
  TEXEL0 alpha): title md5 e958048b…, SW playable/boblevel md5-IDENTICAL (A/B), GL select 73542 /
  bobpaint 75198 / boblevel 75569 IDENTICAL, MK64 title md5 db5def1c…, 44/44. Backup
  `rcp_pre_t53_backup.js`. Decode probe (KEEP): `tmp_mk64decode.js` (combiner+blender+tile+I4 dump).
  **MK64 (Europe) now renders title → menus → in-race gameplay cleanly** — closes the MK64
  in-race frontier. Next multi-game blocker: OoT's CPU-bound scene-load (interpreter throughput).
Helper probes (KEEP): `tmp_mk64render/cont/adv/drive.js`, `tmp_oot{probe,adv,show,peak,trace}.js`,
  `tmp_mk64{tex,lb,lb2}.js` (texrect/LOADTILE/LOADBLOCK param tracers).
Backups: `rcp_pre_t58_backup.js` + `gl-renderer_pre_t58_backup.js` (pre-#58),
  `rcp_pre_t57_backup.js` (pre-#57), `rcp_pre_t56_backup.js` (pre-#56), `rcp_pre_t55_backup.js` (pre-#55),
  `rcp_pre_t52_backup.js` (pre-#52), `rcp_pre_loadtile_backup.js` (pre-#49),
  `rcp_pre_texgen_backup.js` (pre-#48), `rcp_pre_multiucode_backup.js`.

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
- **Crackle-free, pitch-correct browser audio (Tasks #41–42)**: pull-model sink in `script.js` —
  AudioWorklet ring buffer (audio thread, immune to the saturated main thread); playback speed =
  windowed production-rate feedforward hard-capped at 1.0x (NOT an integral controller — that
  wound up on bursty arrivals → chipmunk), fill≥target plays at exactly 1.0; fade-out/in declick
  on underrun; ScriptProcessor fallback; unlocks on keydown too (was pointerdown-only → keyboard
  players got silence). **Audio-master sync**: `cpu.hostThrottle` hook in `cpu.run()` pauses
  stepping while the sink has >~160ms banked (worklet posts fill reports) — the unpaced loop ran
  emulated time at 4-5x real time in menus (idle-skip) = THE chipmunk root cause. Do NOT replace
  this with a counts/sec wall-clock throttle: the emulator's approximated DMA/timer durations are
  inconsistent with the audio-chain count rate (~94.3M counts/emulated-s) and a global throttle
  stalls boot for minutes. Also fixed `emitAudioBuffer` reading AI_CONTROL as the DAC rate —
  AI_DACRATE is `aiRegisters[4]` (SM64 EU: 1551 → 31367Hz). Engine unit test:
  `tmp_audsink_unit.js` (KEEP — measures output pitch via zero crossings at 100%/40%/15%/3x/
  bursty production + the closed throttle loop; asserts pitch ≤1.0x and zero gaps).
  `tmp_aiprobe2.js` (KEEP) measures production rate/dacRate from a state.
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
- **Task #54 DONE: persistent live RDRAM fetch view (+66% pure-CPU throughput, byte-identical).**
  `invalidateCache()` fired on EVERY RDRAM store (~1/7 steps), nulling the fetch DataView so
  `readInstructionWord` reallocated `new DataView(rdram, page<<12, 4096)` on the next fetch. But
  the fetch view is a LIVE window over the rdram buffer (allocated once, never reassigned, written
  in place) — stores/DMA/SMC are already visible without rebuilding it. Now fetch reads ONE cached
  `mmu.memory.rdramView` (`this.rdramView`); the per-store invalidation churn is gone. OoT
  scene-load 2.95→~4.9M steps/s; SM64 menu 1.72→~1.85M; in-game ~flat (rasterizer-bound). The
  `invalidateCache()` callers are now vestigial (fetch no longer reads `fetchPage`/`fetchView`).
- Remaining levers for full speed (PAL 25 fps ⇒ ~9.6M steps/s; ~385k steps/frame in-game):
  1. **CPU JIT — CLOSED (Task #60).** The compile-to-JS block JIT was built, proven byte-identical,
     and MEASURED 2–4.4× SLOWER (validation cost ruled out). The interpreter is at V8's ceiling; no
     call-based block JIT beats it. Only untested lever = true source-body inlining, predicted to
     also lose (see Task #60 at top). Do not re-open without the #60 kill-criteria.
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
Verify on real in-game states: ADPCM order-2 prediction, ENVMIXER ramps. Castle interior
(lobby + BoB painting room) verified in Task #43 — paintings render (G_MTX MUL-order fix),
`state_bobpaint` baseline. Course scenes + 2-cycle/fog verified in Task #44 — vertex fog
implemented (G_MW_FOG + G_FOG shade alpha), `state_boblevel` baseline (BoB spawn).

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
2. Title: `node tmp_titlerender.js` (~40 s) → f3d 96, origin **0x3da800**, **nonBlack=40441**,
   `test-results/sm64-title-fresh.png` md5 **e958048bf66889f4dbec9d0e22ce6713** (full
   "SUPER MARIO 64" logo at true scale on black). NB: the pre-#43 baseline (zoomed-in MARIO
   letters, md5 79b3d46…, nonBlack 75541) was the G_MTX MUL-order bug; "the real intro starts
   zoomed" was a rationalization. For renderer perf changes, prove md5-identical by
   re-rendering with the backup rcp.
3. Wallpaper scene: `STATE=state_advfix1 STOPF3D=20 OUT_PNG=... node tmp_resume_render.js` →
   nonBlack=**74284** (tiled dark-blue "SUPER MARIO 64" wallpaper + winking goddard MARIO
   HEAD — the head was rendered off-screen before Task #43). Also
   `STATE=state_title_full STOPF3D=20` → nonBlack=**74033**, same + colourful
   ★START text (bright-pixel bbox x20..79 y204..218). NB: the pre-#36 claim that this scene's
   "horizontal banding is genuine content" was WRONG — the bands were the LOADBLOCK 25%-load
   bug (Task #36).
4. Byte-exact RCP check: `tmp_verify33.js` pattern (lockstep old-vs-new RDRAM CRC from a state).
4b. In-game scenes (Task #37–38): `STATE=state_select_file STOPF3D=3` → SELECT FILE screen with
   readable text (MARIO A–D, SCORE/COPY/ERASE/OPTION), nonBlack=**73541**;
   `STATE=state_playable STOPF3D=3` → Mario in color (red cap/shirt, BLUE overalls — if
   gray/white, the numLights decode broke) in front of the castle, nonBlack=**76099**.
   Render via `tmp_resume_render.js`.
4c. Castle interior painting (Task #43): `STATE=state_bobpaint STOPF3D=3` → Bob-omb
   Battlefield painting (Bob-ombs in a gold frame) on the wall above the checkered platform,
   Mario at its left. If a big BLACK square: the G_MTX MUL order / Fast3D push-bit decode
   regressed. SW nonBlack=**74625**; GL via tmp_glrender.js nonBlack=**74867**.
4d. In-course fog (Task #44): `STATE=state_boblevel STOPF3D=3` → BoB spawn with intro dialog:
   green grass, dirt path, boulder mound, red cliffs. If terrain is FLAT GREY: vertex fog
   (G_MW_FOG moveword / G_FOG shade-alpha in handleG_VTX) regressed. SW nonBlack=**75500**;
   GL nonBlack=**75541**.
4e. OoT first scene (Task #56/#58): `INSTATE=state_oot_scene ADV=250 OUT_PNG=... node tmp_t55_render2.js`
   → **textured + lit** interior room (wood walls + warm patterned floor + a textured character),
   best colorImage nonBlack=**65673** (Task #58 lights-fix value; was 65700 with the bogus green
   light, 66659 flat-shade in #55, 0 before #55). All tris must be `useTexture=true` and
   `rspState.viewport` non-null (`tmp_t56_diag.js` reports both). GL:
   `INSTATE=state_oot_scene ADV=120 OUT_PNG=... node tmp_t56_gl.js` → textured+lit scene,
   ≥17 texUploads, nonBlack **73688** (was 73791 pre-lights-fix). If FLAT-shaded/off-screen: a
   regression in F3DEX2 G_TEXTURE (0xD7) / G_MOVEMEM (0xDC) dispatch or the #55 trio (G_MTX flag /
   negative-W / G_GEOMETRYMODE). If surfaces facing away from the lights go GREEN-tinted or warm
   instead of dim grey: the #58 light-slot decode (`unit-2`, units 0/1 = LOOKATX/Y) regressed —
   re-check with `tmp_t58_lights.js` (expect lights slot0=170,160,255 / slot1=195,150,70 /
   slot2(ambient)=10,10,10). For any F3DEX2 change also re-run MK64 race A/B (`tmp_t55_mk64.js`
   INSTATE=state_mk64_race vs `rcp_pre_t58_backup.js` → md5 IDENTICAL **91f4b8d1…**) and the OoT
   logo (below).
4f. OoT logo fade (Task #57 SW / #58 GL): `INSTATE=state_oot_n64logo ADV=60 OUT_PNG=... node tmp_t55_render2.js`
   → "NINTENDO 64" logo + textured 3D N, **fading** over black borders, SW best nb **3306**. GL
   (`tmp_t56_gl.js` / `tmp_t58_gldump.js`): at ADV=8 the dimmed logo shows (nb ~3300, matching SW);
   at ADV≥30 the final FBO is the fully-faded-out black frame (nb 0) — the boot logo legitimately
   fades to black, so check an EARLY ADV for GL, not the end frame. GL composites the fade via a
   non-textured kind-2 quad through the batched combiner+blender (`glr.compositeFillRect`,
   F3DEX2-gated). If the GL logo NEVER fades (full-bright): `handleG_FILLRECT`'s `this.glr` branch
   regressed. **Byte-identical guard for the gate**: `tmp_t57_nohit.js` must report
   **compositeHits 0** for SM64 (`ROMNAME='Super Mario 64 …' INSTATE=state_select_file`/`state_playable`)
   AND MK64 (`ROMNAME='Mario Kart 64 …' INSTATE=state_mk64_race`/`state_mk64_title`); MK64 race A/B
   md5 must match `rcp_pre_t58_backup.js` (`tmp_t55_mk64.js`, **91f4b8d1…**). SM64 title md5
   **e958048b…**, GL select_file **73542**.
5. `node --check cpu.js rcp.js` immediately after any edit.
6. GL renderer (Task #40): `STATE=state_select_file STOPF3D=3 OUT_PNG=... node tmp_glrender.js`
   renders through the REAL N64GLRenderer on the FakeGL stub (`tmp_glsim.js` — JS twin of the
   shaders + the WebGL1 subset used). Compare visually vs the SW render of the same state
   (GL nonBlack post-#45: select-file **73542** / bobpaint **75198** / boblevel **75569** /
   title_full@18 **74189** — GL now applies 3-point bilinear filtering, Task #45, so GL
   nonBlack values differ slightly from SW; compare visually). ★START
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
  `state_run3` (Mario mid-run on grass). **New (Task #43):** `state_lobbyE` (just inside the
  castle lobby, Bowser dialog up), `state_nvD` (lobby floor, free), `state_bobpaint` (**on the
  BoB painting-room platform facing the painting — THE interior/painting state**).
  **New (Task #44):** `state_warp5` (BoB star-select screen), `state_boblevel` (**Mario at BoB
  spawn, intro dialog up — THE in-course/fog state**). To enter a painting in-sandbox: teleport
  BEHIND its plane (bob: X=-5300 Y=430 Z=-154 from state_bobpaint) — jumping at it gets
  wall-ejected. Format: `<name>.rdram` + `<name>.json`.
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
- **Navigation/probe tooling (Task #43, KEEP):** `tmp_teleport.js` (`IN=/OUT=/X=/Y=/Z=/YAW=/N=`
  — pokes gMarioState->pos/vel + gMarioObject gfx.pos/oPos; the ONLY reliable way to move Mario
  long distances in-sandbox — walking fights sticky collision corners), `tmp_walkto.js`
  (`IN=/OUT=/TX=/TZ=` feedback-steered walking), `tmp_pushdoor.js` (walk+stall→A-press doors),
  `tmp_nav2.js` (tmp_navigate + per-phase position telemetry), `tmp_floorprobe.js` (grid floor
  heights — beware mid-fall false floors), `tmp_objlist3.js` (object pool dump),
  `tmp_paintprobe.js`/`tmp_mtxprobe.js` (DL tile/draw/matrix tracers).
  **EU RAM addresses:** gMarioState->pos 0x8030946c (yaw 0x80309456, vel 0x80309478);
  gMarioObject 0x80313f38 (gfx.pos +0x20, yaw +0x1C, oPos +0xA0); object pool stride 0x260,
  activeFlags +0x74, behavior +0x20C. Painting positions (decomp): bob (-5222,410,-154) yaw90,
  ccm (-2611,-307,-4352), wf (-51,-205,-4506), jrb (4301,410,-538) yaw270 — painting rooms are
  detached geometry connected by warp doors; do NOT try to walk there.
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
`*_backup.js` (keep) · `state_*` (checkpoints) · `tmp_*.js` (probes) · `HISTORY.md` (full Task #1–#36 session log).

## Task log (details in HISTORY.md)
| # | What |
|---|------|
| 1–8 | Segment decode, depth map, F3DEX2 0xDB, TEXRECT offsets, snapshot pick, culling winding, vertex lighting |
| 9–10 | BigInt→Number CPU (+ branch-likely, LD/SD endianness, gprHi); CP0 timer edge-fire → OS revived |
| 11 | TLB implemented (osMapTLB) — goddard boot panic fixed |
| 12–13 | Goddard panic root-caused → broken 64-bit doubleword shifts fixed |
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
| 36 | G_LOADBLOCK lrs decode (was loading 25% of every texture!) + COPY-mode texrect bypass |
| 37 | START edge-detect → file-select; texrects always sample TMEM; mirror pre-mask fix |
| 38 | Fast3D G_MW_NUMLIGHT decode fix → Mario/terrain colours; game advanced to playable |
| 39 | In-game throughput +14% byte-identical; measured rasterizer=81% → plan WebGL renderer |
| 40 | WebGL renderer (gl-renderer.js): state-batched über-shader, TMEM→RGBA8 cache, FBO per color image, VI-origin present. In-game 0.74→4.2M steps/s |
| 41 | Audio crackle fix: AudioWorklet ring-buffer pull sink, declick fades, keydown unlock |
| 42 | Audio chipmunk fix: audio-master cpu.hostThrottle sync, feedforward cap 1.0x, AI_DACRATE index fix |
| 43 | Castle paintings black → G_MTX MUL premultiply + Fast3D push-bit un-invert; goddard head restored |
| 44 | Course terrain flat grey → vertex fog (G_MW_FOG + G_FOG shade alpha); state_boblevel |
| 45 | N64 3-point bilinear filtering in GL shader (G_TF_BILERP); SW still point-samples |
| 46 | VI vblank wall-clock pacer in script.js (cpu.hostThrottle = audioThrottle || viPacer); covers pre-audio-unlock/muted-tab fast-forward |
| 47 | Multi-game boot: MK64+OoT boot/CIC-detect/dispatch; authoritative ucode ID (F3D x10 / F3DEX x2 / F3DEX2 x2); G_QUAD→TRI2 |
| 48 | MK64 + OoT render recognizable frames: G_TEXGEN (MK64 title/menu), F3DEX2 G_DL push/branch un-invert + G_FILLRECT cycle-gate (OoT N64 logo) |
| 49 | MK64 in-race: G_LOADTILE row stride = tile.line (was contiguous → diagonal striping); state_mk64_race |
| 50 | Diagnosis session (no code): MK64 streaks upstream of SW/GL; OoT Yaz0 scene-load is throughput-bound |
| 51 | MK64 "rainbow streak" skybox FIXED: F3DEX 1.x G_VTX count decode (was Fast3D layout → dropped last vertex) |
| 52 | True frustum near-plane clip for F3DEX/F3DEX2 (clip-space cz+cw≥0); SM64 keeps legacy W=1 path, byte-identical |
| 53 | MK64 "green wedge" + OoT logo backdrop FIXED: I-format alpha=intensity (was a=255) in SW+GL samplers |
| 54 | +66% interpreter throughput (byte-identical): persistent live RDRAM fetch view (killed per-store DataView realloc) |
| 55 | OoT renders first 3D scene (flat-shaded): 810M-step Yaz0 load + three F3DEX2 fixes (G_MTX flag, negative-W hemisphere, G_GEOMETRYMODE clear-mask), all isF3DEX2-gated |
| 56 | OoT scene textured + viewport: two undispatched F3DEX2 cmds (G_TEXTURE 0xD7, G_MOVEMEM 0xDC); SM64/MK64 byte-identical |
| 57 | OoT fade-overlay compositing (SW) + depth verified: 1/2-cycle G_FILLRECT composites via combiner+blender (_compositeOverlayFillRect), isF3DEX2-gated; depth needed no code |
| 59 | CPU throughput investigation (settles the "block-JIT" lever) + OoT logo→scene drive. SHIPPED byte-identical: collapsed the opTable→opSPECIAL/opREGIMM double dispatch into one inline lookup in `decodeAndExecute` (44/44 tests, SM64 title md5 e958048b…, 5-state lockstep RDRAM CRC identical: SM64 menu/playable, OoT scene, MK64 race/title). MEASURED & REVERTED/REJECTED: bookkeeping-strip to 1/128 steps = no gain (`tmp_cpu_nobk.js`); RDRAM memory fast-path inlined into mmu.read32/write32 = no gain, REVERTED (V8 already inlines translateAddress+memory.read32); dispatch-collapse steady-state gain itself within sandbox noise (~0–3%). **Finding: interpreter is at V8's inlining/inline-cache ceiling (~5.0–5.5M pure-CPU steps/s); only a TRUE compile-to-JS basic-block JIT (no per-instruction indirect dispatch) can beat it — "threaded code" can't.** Lever 1: drove OoT headless from state_oot_n64logo through the CPU-bound Yaz0 load to the rendered opening interior scene (nb 65673 = state_oot_scene) — confirms logo→scene end-to-end; the Triforce/Hyrule-field title was NOT isolated (path goes logo→load→interior; needs controller-connected idle capture). New checkpoints state_oot_drive4 (deep load) / state_oot_drive5 (interior from clean boot); state_oot_title confirmed mislabeled (= logo copy). Backups cpu_pre_t59_backup.js, mmu_pre_t59_backup.js. Probes tmp_t59_verify.js (lockstep+timing A/B), tmp_t59_pcsample.js (top-PC load-vs-spin), tmp_t59_time.js |
| 60 | CPU JIT CLOSED (negative result). Built the compile-to-JS basic-block JIT #59 predicted: `stepJit`/`compileBlock`/`_jitClassify`/`validateBlock`/`_stepTail` in cpu.js, gated behind `cpu.useJit` (default OFF, interpreter path untouched + verified byte-identical to cpu_pre_t60_backup.js). One `new Function` per straight-line block (ends before branch/jump/COP0/COP1-branch), full per-instruction bookkeeping inlined per slot + pc-divergence bail, leaf handler called via monomorphic closed-over ref (no opTable indirection), SMC entry-validation, MAX 32 instr/block. PROVEN byte-identical: tmp_t60_verify.js (interp vs jit, same cpu.js) → IDENTICAL RDRAM CRC + pc + instrCount on SM64 menu/playable, OoT scene, MK64 race/title; 44/44 tests; SM64 title md5 e958048b…. MEASURED 2–4.4× SLOWER (tmp_t60_time.js real-rate, idle-FF subtracted): OoT scene 5.9→1.3M/s, SM64 menu 2.4→1.1M/s, MK64 race 1.3→0.7M/s. Disabling SMC validation (tmp_t60_iso.js SKIPVAL=1) = no change → validation NOT the cost; the big generated block optimizes worse under V8 than the tight step() loop whose indirect dispatch the inline cache already makes cheap. CONFIRMS #59: interpreter at V8 ceiling, call-based JIT can't win. Only untested lever (true source-body inlining) predicted to also lose. Backup cpu_pre_t60_backup.js. Probes tmp_t60_verify/time/iso.js. → Next frontier = game coverage, not speed. |
| 58 | OoT lights off-by-one FIXED + GL fade compositing + MK64 fillrect decision. (a) F3DEX2 G_MV_LIGHT slot decode: units 0/1 of the DMEM light buffer are LOOKATX/LOOKATY (gbi2 G_MVO_*), lights start at unit 2 → slot=unit-2 (was ofs/24-1, which injected LOOKATY's rgb 0,128,0 as a bogus GREEN up-light in slot 0 and shifted L0/L1/ambient up one). OoT entry room now correctly lit (bluish L0 170,160,255 / warm L1 195,150,70 / dim ambient 10,10,10); 854 px changed, scene SW nb 65700→65673 / GL 73791→73688. lookat[0/1] now captured for future texgen. (b) GL fade compositing: new glr.compositeFillRect draws the 1/2-cycle fade as a non-textured kind-2 quad through the batched combiner+blender (matches SW); OoT "NINTENDO 64" logo now fades in GL (ADV=8 nb ~3300 = SW, ADV≥30 fully faded to black). (c) MK64 fillrect: A/B render (tmp_t58_mk64ab.js) shows compositing its full-screen OPAQUE-WHITE-combiner fillrect gives 0 visible benefit (race+title nb identical, geometry overdraws it) but is a byte-identical regression risk → KEEP the isF3DEX2 gate. All F3DEX2-gated → SM64/MK64 byte-IDENTICAL: 3/3 test files, SM64 title md5 e958048b…, GL select 73542, SM64/MK64 compositeHits 0, MK64 race A/B md5 91f4b8d1… (vs rcp_pre_t58_backup.js). Backups rcp_pre_t58_backup.js + gl-renderer_pre_t58_backup.js. Probes tmp_t58_lights/shadeuse/fadetrace/mk64fill/mk64ab/gldump.js |
