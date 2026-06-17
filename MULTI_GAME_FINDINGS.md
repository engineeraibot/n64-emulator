# Multi-Game Support — Findings & Roadmap (Task #47)

Goal: extend the SM64-focused HLE emulator to run **any** N64 game, starting with
**Mario Kart 64 (Europe) (Rev A)** and **Ocarina of Time (Europe)**.

This is a large, multi-session effort. SM64 alone took 46 documented tasks. The notes below
record exactly where each game stands so work can resume efficiently without re-deriving.

## What works today (both new ROMs)

- **Boot is already game-agnostic.** `performHleBoot()` reads the entry point from the ROM
  header and auto-detects the CIC chip (MK64 → CIC-NUS-6102, OoT → CIC-NUS-6105), copies the
  first 1 MB of game code to the load address, and sets post-IPL3 register/CP0 state. Both
  ROMs execute 25 M+ instructions with **no panic** and reach their main loops.
- **RSP task dispatch works.** Both games submit RSP tasks that the HLE layer picks up:
  OoT issues ~231 graphics tasks (+ audio) in 25 M steps; MK64 issues graphics + ~1090 audio
  tasks.
- **Microcode is now identified correctly** (this task's main fix — see below).

## Fix landed this task: authoritative microcode identification

The renderer previously had only a binary F3D vs F3DEX2 flag, guessed from display-list bytes.
That is insufficient: there are three relevant families, and MK64 needs the middle one.

| Game | ucode_data string (OSTask+0x18) | Family | Tri index scale | Tri opcodes |
|------|----------------------------------|--------|-----------------|-------------|
| SM64 | `RSP SW Version: 2.0D ...`        | F3D (Fast3D) | ×10 | 0xBF/0xB1 |
| MK64 | `F3DEX        0.95 ...`           | F3DEX 1.x    | ×2  | 0xBF/0xB1/**0xB5** |
| OoT  | `F3DZEX NoN fifo 2.06H ...`       | F3DEX2 (Zelda) | ×2 | 0x05/0x06 |

`rcp.js::detectMicrocodeTriScale()` now reads that version string and sets
`rspState.ucodeName` + `rspState.triIndexScale`. The triangle handlers
(`handleG_TRI1/2`) use `triIndexScale`, and **`G_QUAD` (0xB5)** now draws two triangles
(it was an unhandled no-op; MK64 emits ~4800/frame).

Result: MK64 went from 1424 degenerate (idx÷10) tris to ~11 000 correctly-indexed tris/frame.
SM64 is byte-for-byte unchanged (title md5 identical, all baselines hold).

## Status update (Task #48) — both games now render recognizable frames

## Status update (Task #49) — MK64 reaches in-race gameplay rendering ✅

The remaining "striped menu cells" from Task #48 were the **menu background**, which MK64 draws
as stacked 321-wide RGBA16 horizontal strips loaded via **G_LOADTILE** (NOT LoadBlock).
`handleG_LOADTILE` packed each loaded row contiguously into TMEM (single running `d` pointer)
instead of starting each row on the tile's `line`-word boundary. For these strips line=81 words
(648 bytes) but a 321-texel row is only 642 bytes → every row drifted 3 texels → **diagonal
striping**. The sampler (and GL `_decodeTile`) already address rows by `tt*tile.line*8`, so the
loader must too. Fix in `handleG_LOADTILE`: `d = off + (y-y0)*tile.line*8` per row. Byte-identical
wherever a row exactly fills `line` words (all SM64 textures → title md5 unchanged). This is a
general RDP-correctness fix and helps any game using padded LoadTile strips.

With clean menus, MK64 was driven through the full front-end in-sandbox (A-press auto-advance,
`tmp_mk64drive.js`): **GAME SELECT → 1P/MARIO GP → class (50/100/150cc) → MAP SELECT (renders a
working 3D track preview) → track load → in-race 3D rendering.** The race (Luigi Raceway) shows
the road with lane markings, track barriers and grass correctly in perspective. Remaining:
upper-screen skybox / distant scenery is still glitched (colorful streaks) — the next MK64
frontier (likely skybox texture/vertex handling or billboards). State: **`state_mk64_race`**
(also `state_mk64_d1..d4` checkpoints along the menu path).

### Mario Kart 64 — TITLE + MENUS RENDER ✅
- Root cause of black textures was **G_TEXGEN (environment mapping)**, not the texture path.
  MK64's intro/title/kart models set geometry mode `G_TEXTURE_GEN` (0x40000) (gm=0x62205); the
  RSP must **synthesize per-vertex texcoords from the modelview-transformed normal** instead of
  using the stored (zero) s/t. SM64 never set this bit, so it was unimplemented → every vertex
  sampled texel(0,0) → black/single-colour tris.
- Fix: `handleG_VTX` now computes texgen s/t when `G_TEXTURE_GEN` is set — transform the normal
  by the modelview rotation (`n*MV`), normalize, dot against the look-at axes (default X/Y),
  spherical map `(u*0.5+0.5)*0x8000` (linear variant via `acos`). `rspState.texgenSpan`
  (default 0x8000) is the tunable scale. SM64 byte-identical (TEXGEN bit never set).
- Result: **clean MARIO KART 64 title screen** (logo, karts, sky, "PUSH START BUTTON") and the
  mode-select menu (some UI cell textures still striped — a CI/tile-format detail to chase).
  States: `state_mk64_title`, `state_mk64_menu`. Render via `tmp_mk64cont.js INSTATE=… ADV=…`.

### Ocarina of Time — N64 LOGO RENDERS, scene-load is the next frontier ✅(partial)
- **Two bugs fixed; OoT now draws geometry + sets colorImage (was 0 tris, colorImage=0):**
  1. **G_DL (0xDE) push/branch was INVERTED.** F3DEX2 `G_DL_PUSH=0x00` (call, push return) /
     `G_DL_NOPUSH=0x01` (branch). Old code pushed on branch and *didn't* push on call, so after
     a scene-DL call hit `G_ENDDL` the interpreter returned from the whole frame → 263k NOP
     bytes walked, nothing drawn. Now pushes only when param==0. (F3DEX2-only; SM64 uses 0x06.)
  2. **G_FILLRECT flat-filled in 1-/2-cycle mode.** OoT's title does clear→draw→**full-screen
     G_FILLRECT in 2-cycle mode** (a fade overlay). G_FILLRECT is a flat fill ONLY in FILL(3)/
     COPY(2) cycle modes; in 1/2-cycle it's a combiner/blender rect. Our flat-fill wiped the
     just-drawn scene to black every frame. Now cycle-mode fill rects are skipped (not
     composited yet). SM64/MK64 clear in FILL mode → unaffected.
- Result: **clean "NINTENDO 64" boot-logo frame** renders (`state_oot_n64logo`). OoT responds to
  input (Start press triggers heavy CPU work = scene load) but the full title scene
  (Triforce / Hyrule-field flythrough) hasn't been reached in-sandbox yet.
- Remaining for OoT gameplay: drive the boot through scene load (CPU-heavy Yaz0 decompress is
  slow in the interpreter); composite 1/2-cycle fade/overlay rects properly (fades currently
  skipped); F3DEX2 backface winding is correct (half the tris cull, as expected); verify
  CIC-6105 long-run PIF behavior. S2DEX (2D ucode) likely still needed for some menus.

## General gaps for "any game"
- Audio microcode variants (different ABIs per game).
- Save types (EEPROM / SRAM / FlashRAM) — not yet needed to boot, needed for gameplay.
- Expansion-Pak detection (RDRAM is fixed 8 MB today — OK for both, but report 4/8 MB properly).
- Wider RDP combiner/blender mode coverage and TEXEL1 (second tile) for true 2-cycle.

## Verification (always run after rcp.js/cpu.js changes)
- `for f in test/*.js; do node --test "$f"; done` → 44/44 pass.
- `node tmp_titlerender.js` → title md5 must stay `e958048bf66889f4dbec9d0e22ce6713`.
- `STATE=state_select_file STOPF3D=3 ... tmp_resume_render.js` → nonBlack 73541;
  `state_playable` → 76099; `state_boblevel` → 75500. GL: `tmp_glrender.js` select_file 73542.
- MK64: `INSTATE=state_mk64_title ADV=20 node tmp_mk64cont.js` → title nonBlack ~75k.
- OoT:  `INSTATE=state_oot_title ADV=150 OUT_PNG=… node tmp_ootpeak.js` → "NINTENDO 64" logo,
  peak rendered nb ~7377.
- Backups: `rcp_pre_texgen_backup.js` (pre-#48). New probes (KEEP): `tmp_mk64render/cont/adv.js`,
  `tmp_oot{probe,adv,show,scan,peak,trace,cull}.js`.

## Status update (Task #50) — diagnosis session: localized MK64 skybox, confirmed OoT blocker

No code shipped this task (baseline kept byte-exact: 44/44, title md5 `e958048b…`, select_file
73541, playable 76099, boblevel 75500). Two frontiers were investigated deeply and narrowed:

### MK64 upper-screen "rainbow streaks" — root cause is UPSTREAM of both renderers
- The streaks appear **identically in SW and GL** (`tmp_glrender.js` on `state_mk64_race` shows
  the same smears) → the bad output is produced by the shared DL-interpreter / vertex /
  texcoord stage, NOT the rasterizer or the GL backend.
- The streaking geometry is a **fan of thin textured triangles that all share one distant apex
  vertex** (screen ≈(114,106), clip-w≈1436) radiating to nearer rim vertices (w≈55–90). Texcoords
  are huge (s up to ~4032 in S10.5 → ~2016 texels) sampled across small 64×32 **CLAMP-addressed
  CI8 tiles** (`cm=2` is clamp, not mirror; `maskS=maskT=0`). One such tile decodes to a grey
  **env-map "shine" sphere**; another to a checkered banner — i.e. real distant scenery/sky
  elements, sampled with extreme coords.
- **Hypothesis tested and REJECTED:** that the streaks were perspective-incorrect texcoords from
  the screen-space viewport clip (`lerpVertex` interpolates s/t/w linearly in screen space). A
  perspective-correct `lerpVertex` (gated to varying-w edges) was implemented and tried — it made
  **no visible difference** to the streaks (they survive because the geometry/texcoords feeding
  the clip are themselves the issue) and it perturbed the SM64 title md5, so it was reverted.
  NOTE for next session: SM64 title's 32 viewport-clips are all *near*-constant-w (ratio≈1.00 but
  not bit-exactly equal), so any `lerpVertex` change that isn't gated by an exact-equality (or a
  ratio-threshold ≥~1.1) check will drift the title md5 — keep that in mind.
- **Next MK64 step (recommended):** trace the far-apex fan back through `handleG_VTX` /
  `handleG_TRI*` / `G_QUAD` index decode for F3DEX 1.x (idx×2) — the reused distant apex smells
  like a vertex-cache / strip-index artifact, OR the scenery uses a draw mode (billboard /
  scrolling sky layer / S2DEX-style) we don't yet handle. Probes saved (KEEP): `tmp_mk64sky.js`
  (per-group census of upper-band tris), `tmp_mk64streak.js` (wide-streak tris + vertex dump),
  `tmp_mk64vtx.js` (full vertex dump of streak tris), `tmp_mk64skytex2.js` (`COMB=` dumps a
  combiner-group's decoded tile), `tmp_mk64skip.js` (`SKIPCOMB=`/`UPPERONLY=` isolate groups).

### OoT — confirmed actively booting; the wall is interpreter throughput, not a discrete bug
- From `state_oot_n64logo`, OoT runs **continuous PI DMA** (1000s of cart transfers) and **reads
  the controller every frame** (`controllerDebug.buttonReads` climbs) — boot + input are healthy.
- After the "NINTENDO 64" logo it enters a **CPU-bound scene load** (Yaz0 decompress): the
  f3dex2-task rate **collapses from ~6/s to ~0.3/s** and `maxTris/task` drops to **0** (no
  geometry drawn) while the CPU grinds. It never reaches the Triforce/Hyrule-field title within
  several 30 s sandbox windows. This matches CLAUDE.md's "THE blocker: throughput" — reaching
  OoT's title is gated on the **CPU block-JIT** lever, not a render/boot fix.
- Saved checkpoints: `state_oot_probe1..3` (progressively deeper into the scene-load grind).
  Probe: `tmp_ootdma.js` (DMA + controller-read progression), `tmp_ootstall.js` (PC-page census,
  confirms varied execution = not a spin-loop).


## Status update (Task #51) — MK64 "rainbow streaks" FIXED (F3DEX 1.x G_VTX count off-by-one)

The upper-screen streaks (localized in Task #50 to the shared DL/vertex stage) were caused by
the **F3DEX 1.x G_VTX vertex-count decode**. `rcp.js::handleG_VTX` had only two branches:
F3DEX2, and an "else" that used the **Fast3D** word layout for everything else — including
MK64's F3DEX 1.x ("F3DEX 0.95"). The two layouts differ:

| ucode    | G_VTX low halfword layout                                  | count decode |
|----------|------------------------------------------------------------|--------------|
| F3D (SM64) | bits 0..15 = `n*16` (byte length); v0 in bits 16..19    | `low16>>4` = n |
| F3DEX 1.x  | bits 10..15 = `n`; bits 0..9 = `n*16-1`; v0 bits 16..23 | `low16>>10` = n |

Decoding F3DEX 1.x with the Fast3D `low16>>4` gives `(n*16-1)>>4 = n-1`, so **the last vertex of
every F3DEX1 vertex load was silently dropped**, leaving a stale slot in the 64-entry buffer.

MK64 draws its distant scenery/sky as a triangle fan: per triangle it loads 2 fresh rim verts
into slots 0..2 (a `num4 dest0` load) and references slot 3 as the shared apex. With the bug,
slot 3 was never refreshed — it held a far vertex (clip-w≈1436, screen≈(114,106)) from a much
older load — so ~230 thin triangles all radiated from that one false apex = the rainbow streaks.

**Fix:** add a dedicated F3DEX 1.x branch in `handleG_VTX`, gated on
`rspState.triIndexScale === 2 && !rspState.isF3DEX2` (set authoritatively by
`detectMicrocodeTriScale` from the ucode version string):

```
num  = ((hi & 0xFFFF) >>> 10) & 0x3F;   // n in bits 10..15
dest = (hi >>> 16) & 0xFF;              // v0 in bits 16..23
```

The diagnosis chain that nailed it (probes KEEP):
- `tmp_mk64vtxraw.js` — histogram of raw G_VTX words; revealed `low16>>10 == F3D_num + 1` and
  the `n*16-1` length field, exposing the real bit layout.
- `tmp_mk64idx.js` — per-streak-triangle vertex-buffer **indices** cross-referenced with the
  load that wrote each slot; showed the apex was always slot 3 = a stale old load while the
  current `num3 dest0` load only wrote slots 0..2.
- `tmp_mk64check.js` — confirms the new branch is hit (376/376 F3DEX1 loads, 233 `num==4`).

**Result:** MK64 in-race (`state_mk64_race`) now renders correctly — balloons, the
MARIO/checkered banner, Luigi's-Raceway grandstands + crowd, sky; no streaks. Title and
GAME SELECT menu remain clean. This is a **general F3DEX-1.x correctness fix** (helps any game on
F3DEX/F3DLX/S2DEX/L3DEX 1.x). SM64 (F3D, idx×10) uses the untouched Fast3D branch and is
**byte-identical**: 3/3 test files, title md5 `e958048b…`, select_file 73541 / GL 73542,
playable 76099, boblevel 75500. Backup: `rcp_pre_t51_backup.js`.

**Remaining MK64 frontier:** a thin green near-plane sliver across screen center — a handful of
triangles with negative clip-w / off-screen projected x (≈2208, 2786) that survive the near-plane
clip (they have positive but tiny cw on one vertex and behind-eye cw on others). Candidate next
step: extend `clipTriangleNearPlane` to also trim guard-band-exceeding screen coords, or tighten
the near-plane epsilon for these mixed-sign-w tris.

## Status update (Task #52) — true frustum near-plane clip for F3DEX/F3DEX2; MK64 "green wedge" re-diagnosed

Two things this task: (1) a landed correctness improvement, (2) a corrected diagnosis of the
MK64 green wedge that **rules out** the Task #51 near-plane-clip hypothesis.

### Landed: proper frustum near-plane clip for the modern microcodes
`clipTriangleNearPlane` previously clipped against an **ad-hoc `W = 1` plane** (a heuristic chosen
to reject SM64/goddard's behind-camera geometry). That plane is NOT the real frustum near plane,
so vertices generated by the clipper sit on `W=1` with arbitrary `CX` and perspective-divide to
coordinates like `(-84354, -14086)` — a giant off-screen triangle the viewport clip then clamps
into a thin on-screen sliver.

Fix: for F3DEX 1.x / F3DEX2 (`isF3DEX2 || triIndexScale === 2`), clip in homogeneous clip space
against the **true near plane** `cz + cw >= 0` (libultra row-vector: `NDC_z = cz/cw`, near at
`NDC_z = -1`) plus a `W > eps` plane. New generic helper `clipClipPlane(poly, distFn)` does a
single-plane Sutherland–Hodgman pass; interpolated near-plane vertices satisfy `cz+cw=0` and
project to bounded coords. **SM64 is F3D (`triIndexScale 10`) and keeps the untouched legacy
`W=1` path → byte-identical baseline.** Backup: `rcp_pre_t52_backup.js`.

Verified byte-identical on **every** tested state (the change is latent/forward-looking — it only
affects geometry that actually crosses the near plane in ways the `W=1` hack mishandled, which the
current checkpoints don't visibly exercise): SM64 title md5 `e958048b…`, SM64 playable nb 76099,
OoT boot-logo md5 `36c1f8f1…` (peak nb 7377), MK64 title md5 `db5def1c…`, MK64 race md5
`1262d589…`, 44/44 tests. A general robustness win for "any game" on the modern microcodes.

### Corrected diagnosis: the MK64 "green wedge" is NOT a near-plane clip artifact
The Task #51 note guessed the central green wedge was a mixed-sign-w near-clip sliver. Traced this
task and **disproved**: the mixed-cw grass tris it pointed at clip to **off-screen LEFT**
(`NDC_x ≈ -76` at their true near-plane crossing) and contribute nothing central; the new
near-plane clip leaves the MK64 race **byte-identical** (`1262d589…`), so the wedge is unrelated
to clipping.

The wedge's actual source (pixel-traced via `tmp_mk64pix.js` on the displayed buffer): a
**screen-space alpha-blended fan**, combiner **`0xff99ff / 0xff327f3f`**, I4 texture (`fmt 4/0`),
`omLo 0x504240`, geometry mode `0x802205` (no TEXTURE_GEN). Apex fixed at screen `(130,136)` with
vertex colour **`(0,255,0) a153`** (green, ~60% alpha); rim vertices white, **all texcoords
`s=t=0`** → the I4 sampler only ever reads texel `(0,0)`. The fan persists in the same screen
position as the camera moves (not a one-frame item glow) and renders as a hard green cone over the
upper screen. Likely a light-shaft / glare / item effect that should be a soft radial gradient.
Two candidate root causes to chase next session:
  - the per-vertex `s/t` should vary across the fan (so the I4 texture fades the cone) but arrive
    as 0 — check the vertex source / whether MK64 drives these texcoords via a path we drop; **or**
  - the combiner/blender (`omLo 0x504240`, alpha `a153`) should make the cone far more
    transparent than we composite — verify the 2-cycle blender applies the vertex/primitive alpha.
Do NOT "fix" blind without a reference frame — the combiner/blend is shared, regression-prone.
Probes (KEEP): `tmp_mk64pix.js` (per-pixel writer trace — THE tool that nailed it),
`tmp_mk64wedge2.js` (region census), `tmp_mk64clip.js` (near-clip output trace),
`tmp_mk64green.js`/`tmp_mk64sliver.js` (vertex/cw dumps).

### Sandbox note (bit me this task)
The FUSE mount served a **truncated tail** of `rcp.js` (cut mid-`handleG_MOVEWORD`) after the
Windows-side `Edit`, so bash `node` saw a 2951-line file and failed `--check` with "Unexpected end
of input" even though the Windows file was complete. Recovery (per CLAUDE.md rule #3): spliced the
mount's correct edited HEAD onto the **complete tail from `rcp_pre_t52_backup.js`** at the unique
`    lerpVertex(a, b, t) {` anchor (which sits after the edit, before the truncation). Verified
both sides consistent afterward (`node --check`, `Grep` Windows-side).

## Status update (Task #53) — MK64 "green wedge" FIXED + OoT logo backdrop FIXED (I-format alpha=intensity)

The Task #52 wedge diagnosis pointed the way: the green fan is combiner `0xff99ff/0xff327f3f`,
1-cycle, with **color = SHADE** (the texture does NOT drive RGB — apex green, rim white) and
**alpha = `TEXEL0_ALPHA * SHADE_ALPHA`**. The tile is an **I4 (intensity) radial lens-flare**
texture (two bright rings — dumped via `tmp_mk64decode.js`). So the flare's *shape* lives entirely
in `TEXEL0_ALPHA`.

Root cause: our texture sampler returned **`a = 255` for the I (intensity) format** (`rcp.js`
`sampleTexture` fmt 4, and GL `gl-renderer.js` `_decodeTile` fmt 4). On real N64 the **I format
sets alpha = intensity** (it behaves like IA with A=I). With `a=255` the flare's alpha mask was
gone → the combiner alpha collapsed to a flat `SHADE_ALPHA` → a solid green cone over the screen.

Fix (one line each, SW + GL): I-format texel returns `a = v` (intensity) instead of `255`.
- **MK64 race:** the green cone is gone; the flare is now a faint alpha-masked ray bundle and the
  **"MARIO KART" start/finish banner it was burying is visible** (SW + GL).
- **OoT boot logo (windfall):** the pre-fix logo had a **wrong solid blue box** behind
  "NINTENDO 64" — that box was an opaque I-format backdrop. With alpha=intensity it's correctly
  masked to the text/cube on black, matching the real boot logo. (Peak rendered nb 7377 → 4123 =
  the spurious opaque box pixels removed; new OoT logo md5 `4451f892…`.)

**SM64 fully preserved** (SM64's fmt-4 textures are used only where the combiner/blender ignores
TEXEL0 alpha): title md5 `e958048b…` IDENTICAL; SW playable / boblevel **md5-identical** to the
pre-fix backup (A/B verified); select_file 73541 / playable 76099 / boblevel 75500 / bobpaint
74625; GL select 73542 / bobpaint 75198 / boblevel 75569 all IDENTICAL; MK64 title md5 `db5def1c…`
IDENTICAL; 44/44 tests. General "any game" correctness win (alpha-masked I sprites/glows/fonts).
Backup `rcp_pre_t53_backup.js`. Decode probe (KEEP): `tmp_mk64decode.js` (combiner+blender+tile+
I4 texture ASCII dump — THE tool that revealed the flare).

This closes the MK64 in-race rendering frontier. **MK64 (Europe) now renders title → menus →
in-race gameplay cleanly.** Remaining MK64 polish is minor (faint flare ray tuning). The standing
multi-game blocker is now OoT's CPU-bound scene-load (interpreter throughput / CPU block-JIT).
