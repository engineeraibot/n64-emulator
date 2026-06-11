# N64 Emulator — Session Resume Notes

## Project Goal
Build a JavaScript N64 emulator capable of running **Super Mario 64 (Europe) (En,Fr,De).n64** properly in the browser.

## Repository Layout
All source files are at the root of `n64-emulator-main/`:
- `cpu.js` — MIPS R4300i CPU interpreter (primary, currently active)
- `rcp.js` — Reality Co-Processor: RSP display-list interpreter + RDP software renderer
- `mmu.js` — Memory map, TLB, RDRAM
- `memory.js` — ROM loader + memory primitives
- `script.js` — Browser entry-point / scheduler
- `index.html` + `style.css` — Browser UI
- `video-utils.js` — Framebuffer/VI output helpers
- `monitor.js` — Debug overlay
- `test/` — Node.js test suite (`npm test`)
- `test-results/` — PNG/BMP snapshots from headless runs
- `cpu_bigint_backup.js` — Backup of cpu.js before BigInt→Number conversion (DO NOT overwrite)
- `cpu_converted.js` — Reference/scratch copy from earlier conversion attempt
- `cpu_orig.js` — Original unmodified CPU
- `rcp_orig.js` — Original unmodified RCP

## What Has Been Fixed (completed tasks)
All of these bugs are **already fixed** in the current `cpu.js` / `rcp.js`:

1. **G_MOVEWORD segment index decode** — critical rendering bug; segments were being set at wrong indices, breaking all texture/geometry addressing.
2. **Depth buffer mapping in projectClipToScreen** — clip-space Z was not mapping to the correct N64 depth range.
3. **G_SETSEGMENT 0xDB handler for F3DEX2** — the F3DEX2 variant of G_MOVEWORD (opcode 0xDB) was not dispatching to the segment handler; also audited G_TEXRECT.
4. **G_TEXRECT s0/t0/dsdx/dtdy wrong offsets in RSP DL path** — texture-rectangle UV and scale fields were being read from wrong byte offsets.
5. **Framebuffer capture** — headless snapshot logic now prefers `bestRichSnap` (most drawn pixels) over the deterministic last-frame, avoiding capturing garbage frames.
6. **Backface culling winding** — front/back face winding was inverted, causing most geometry to render black (culled).
7. **Vertex lighting near-black** — ambient + N·L lighting was computing near-zero values; fixed diffuse accumulation and ambient fallback.
8. **BigInt→Number conversion regressions (Task #9 follow-up)** — the 64-bit→32-bit GPR conversion introduced three bugs that broke boot. All fixed:
   - **Branch-likely target precedence** — `opBEQL/opBNEL/opBLEZL/opBGTZL` and the COP1 float branch computed `(pc + 4) | 0 + (imm << 2)`, which JS parses as `(pc+4) | (imm<<2)` (bitwise OR, not addition) because `+` binds tighter than `|`. Fixed to `((pc + 4) + (imm << 2)) | 0`.
   - **LD/SD doubleword endianness** — `opLD` loaded the high word and `opSD` wrote value/sign backwards. The OS exception preamble writes the saved thread SR with a 32-bit `sw` (into the high word of an 8-byte slot at ctx+0x118) and then copies the context with `ld`/`sd`; truncating to 32 bits destroyed the SR, so dispatched threads ran with Status=0 (interrupts disabled) and the scheduler froze in the idle loop. **Fix:** added a parallel `this.gprHi` (Int32Array(32)) holding the upper 32 bits of each GPR; `opLD` splits the doubleword into `gprHi:gpr`, `opSD` writes both halves, and `opLDL/LDR/SDL/SDR` reconstruct/split the full 64-bit value via `_reg64`/`_setReg64`. This makes verbatim `ld`→`sd` context copies byte-exact while every other op still uses the low 32 bits in `this.gpr`. This was the key fix that revived the OS.

## Current state (after the Task #10 fix — title screen RENDERS)
SM64 now boots through the OS **and renders graphics** in the node harness. `npm test`
passes 44/44. The headless run (`node tmp_node_run.js 40000000`) draws the SM64 title
logo: ~79.8k textured + ~15.1k untextured triangles, `f3dTaskCount`=96, taskTypeHistogram
`{"1":96 (gfx), "2":787 (audio)}`. Output: `test-results/sm64-node.png` (the iconic 3D
"MARIO 64" letters). Audio still runs ~1:1 with VI.

### What fixed Task #10 (the starved game-loop thread / black screen)
Root cause was the **CP0 Count/Compare timer never firing**, a fallout of the Task #9
BigInt→Number conversion. Chain of reasoning:
- The game-loop thread (`0x80308d40`) ran a few frames then blocked **forever** in
  `osRecvMesg` (`0x802ef780`) on queue `0x80335be8` — the message queue of an
  `osSetTimer` wait. Only ~42 dispatches vs thousands of VI interrupts.
- That timer message is delivered by the OS timer manager, driven by the **CP0 COUNTER
  interrupt** (IP7 / CAUSE 0x8000), which fires when `Count == Compare`.
- The OS programs `Compare = osGetCount() + interval` (`__osSetTimerIntr` @0x802f4e04).
  Observed: it set `Compare=0x43f2d8` while `Count` was already `0x43f2e0` (8 ahead) —
  because Count advances during the OS's own setup code. With the old **exact-equality**
  test (`Count === Compare`), the interrupt would only fire after a full 2^32 wrap, i.e.
  effectively never → timer dead → game-loop thread starved → no gfx task → black screen.

Three fixes in `cpu.js` (all preserve the Number/`Int32Array` representation):
1. **CP0 timer = edge-crossing, one-shot.** Added `serviceCompareTimer()`: fires IP7 when
   Count has reached **or just passed** Compare (signed delta, forward window 0x10000000),
   not on exact equality. Armed by `mtc0 Compare`; an `_lastFiredCompare` guard means the
   IP7 handler's clear-by-rewrite (`mfc0 $11; mtc0 $11` @0x802f3b40, same value) does NOT
   re-arm — this prevents an interrupt storm. The timer manager's next (different) Compare
   re-arms normally. Used in both `step()` and `tryFastForwardIdleLoop()`.
2. **64-bit HI/LO.** Added high words `this.hiH`/`this.loH`; `MFHI/MFLO/MTHI/MTLO`
   (0x10–0x13) now move the full 64-bit HI/LO (restoring `gprHi`). 32-bit `MULT/MULTU/
   DIV/DIVU` sign-extend their result into the high words.
3. **Doubleword ops operate on full 64-bit operands.** `DMULT/DMULTU/DDIV/DDIVU`
   (0x1C–0x1F) were reading only the low 32 bits (`this.gpr`), ignoring the high half
   loaded by `ld` (`this.gprHi`). Rewrote them with `_reg64()` + new `_setLO/_setHI`
   helpers so the OS's 64-bit time math is correct. (This was wrong before, though the
   timer-fire fix is what actually unblocked the boot.)

## Task #11: TLB implemented — goddard (Mario head) no longer panics on boot — COMPLETE

**Root cause of the post-title freeze (found this session):** after the title intro
(exactly when `f3dTaskCount` reaches 96, ~25M steps) the game-loop thread (`0x80308d40`,
id=5, pri=10) was calling a fatal `exit(-1)` handler at `0x8019ab3c` (prints "exit\n" then
`beq zero,zero,self` infinite-loop at `0x8019ab54`) → all threads idle, no more gfx tasks,
black/frozen screen. The caller was goddard's `proc_dynlist` (`0x80182b50`), which panicked
**"proc_dynlist() not a valid dyn list"**. That check (`0x80182b70`) is
`xori t7, dynlist[0], 0xd1d4` — the dynlist's first word must equal the magic `0xD1D4`.

**Why it failed:** goddard (the libgoddard Mario-head renderer used on the title/file-select
screen) calls `osMapTLB` to map **virtual `0x04000000`+ in 64K pages (PageMask `0x1e000`,
128K per TLB entry) onto physical RDRAM**, then reads its dynlist data through those mapped
addresses (e.g. `0x04000650`). The emulator had **no TLB** — `MMU.translateAddress` treated
`0x04000650` as identity → physical SP-DMEM region → garbage (`0x1ec6021`) instead of
`0xd1d4` → panic.

**Fix (this session):**
1. **`cpu.js`** — added `this.tlbEntries` (32 × `{pageMask,entryHi,entryLo0,entryLo1}`) in
   `reset()`; implemented the CP0 TLB instructions in `opCOP0` (sub≥0x10): **TLBWI** (fn
   0x02, index = Index reg `cp0[0]`), **TLBWR** (fn 0x06, index = Random `cp0[1]`), **TLBR**
   (fn 0x01), **TLBP** (fn 0x08), using EntryHi `cp0[10]` / EntryLo0 `cp0[2]` / EntryLo1
   `cp0[3]` / PageMask `cp0[5]`. ERET (fn 0x18) unchanged.
2. **`mmu.js`** — `translateAddress` now: kseg0/kseg1 → direct `& 0x1FFFFFFF`; **kuseg /
   kseg2 → TLB lookup** (variable page size from PageMask, even/odd page via the
   `(mask+1)>>1` bit, V-bit checked, PFN→phys); **miss falls back to identity** so prior
   direct-register behavior is preserved.

**Verified:** `proc_dynlist` now reads `dynlist[0]=0xd1d4` (was `0x1ec6021`) — no panic
(`tmp_dynchk.js`). All 44 tests pass when run per-file (`node --test test/<file>` → 3+38+3;
NB: `npm test` with `--experimental-test-isolation=none` can hang in this sandbox — that is
an environment artifact, not a real failure). `node tmp_node_run.js 38000000` still renders
the title logo to `test-results/sm64-node.png`.

> ⚠️ Sandbox gotcha: the Linux/bash FUSE mount can serve a **stale/truncated** copy of files
> edited via the Windows file tools (and may NUL-pad on save). If `node --check` reports a
> mid-file "Unexpected end of input", the bash view is stale — the Windows file is fine.
> Re-write the file *from bash* (python/sed) to force a consistent view before testing.

### Task #12 (this session): goddard panic ROOT-CAUSED to an empty member-list — SUPERSEDED, see Task #13 (now FIXED)
The post-title freeze is a **fatal goddard abort** at deterministic step **26154429**
(`f3dTaskCount` caps at 96). Tests still 44/44; no source files were changed this session
(only `tmp_*` probes added) so the title logo still renders. The full causal chain is now
pinned down precisely (this is the big advance — next session can start at the construction
bug instead of the symptom):

**The exact chain (verified, all addresses live-RAM):**
1. The fatal printer is `0x8018c2c8` — it is **goddard `gd_fatal_printf`, not a plain
   printf**. It prints the message, dumps the goddard call stack (`.In: 'gdm_maketestdl'.`
   via `0x8019a90c`→`0x8018cf9c`), then calls `exit()` at `0x8019ab3c`. So any message it
   prints is fatal. (`dGetWorldPos`'s static epilogue after the `jal` is never reached.)
2. The fatal message is **`"%s: Object '%s'(%x) does not support this function."`**, args:
   func=`"dGetWorldPos()"`, type(`%x`)=**`0x10000` = `OBJ_TYPE_PLANES`**. `dGetWorldPos`
   (entry `0x80187bac`) switches on `obj->type` (`obj+0xC`) and handles types
   `2..32`(jumptable), `64,256,512,8,0x2000,0x8000,0x80000,0x100000` — **`0x10000` is NOT a
   case → default → fatal**. So in the real game `dGetWorldPos` is *never* called on a
   PLANES object; our control flow diverged to call it.
3. Caller is `0x80183ff4(a0=flags, a1=obj)` (saves a0→`sp+80`, a1→`sp+84`). For the PLANES
   obj `0x80098048` it takes the `case 0x10000` at `0x8018412c` (sub-obj = `obj+0x30` =
   `0x8009a3d8`, a JOINTS/type-1 object), then:
   - `0x80184198 jal 0x8017ce2c(subobj, PLANES)` — a **list-membership test**: scans
     `subobj->list (subobj+0x1c)` for a node whose `node->obj->id (lh +0x10)` equals
     `PLANES->id` (=46, from `PLANES+0x10`=`0x2e0000`). **Returns 1 ⇒ early-out at
     `0x801841a8` (skips dGetWorldPos).**
   - if it returns 0: `jal 0x8017cc44`, then gate `andi t3, *(sp+80), 9` (flags=`0xd`,
     `&9`=9≠0) ⇒ **`jal dGetWorldPos`** ⇒ fatal.
4. **THE DIVERGENCE:** at the panic, `subobj->list` (`*(0x8009a3d8+0x1c)`) is **0 (empty)**,
   so `0x8017ce2c` returns 0 and dGetWorldPos is wrongly invoked. In the real game this
   member-list must be non-empty (contain the PLANES id) so the early-out fires.

**Ruled out this session:** TLB aliasing/coherency — goddard maps exactly one 128K window
`0x04000000`→phys `0x390000`; there are **zero** mapped-region misses in the whole run
(`tmp_tlbmiss.js`), and the objects live in direct kseg0 RAM (phys `0x9xxxx`), coherent.
Object is a legitimate PLANES (clean header, valid pointers) — not a corrupt pointer.

**Next step (#12 continued): find why `subobj+0x1c` is never populated.** That member-list
is built during goddard object/group construction (a "add-to-group"/list-append writing the
node `{+0x4:next, +0x8:obj}` and the head at `parent+0x1c`). Either a construction command is
mis-executed/skipped (likely another CPU/memory correctness divergence, cf. the Task #9/#10
64-bit & timer bugs) or a goddard op is unimplemented. Approach: watch writes to
`phys 0x9a3f4` (`0x8009a3d8+0x1c`) — per-step watching is too slow over the full 26M, so
fast-forward (`for s<WARM cpu.step()`) to ~24M first, then watch (see `tmp_watch1c.js`
scaffold). If it is never written, trace the construction/append fn (sibling of the reader
`0x8017ce2c`, around `0x8017c800..0x8017d000`) and the dynlist command that should append.

**Probes added this session (all `tmp_*`, safe to ignore/delete):** `tmp_godpanic{,2,3,4,5}.js`
(narrow the panic + args + dGetWorldPos disasm), `tmp_godobj.js` (object header + type
histogram of dGetWorldPos calls), `tmp_godcaller.js` (jal/jalr call-ring into dGetWorldPos),
`tmp_godflow.js` (flags `a0`, sub-obj, current-obj global), `tmp_cc44.js`/`tmp_ce2c.js`
(disasm `0x8017cc44`/`0x8017ce2c`), `tmp_member.js` (dumps the empty member-list — the key
result), `tmp_tlbdump.js`/`tmp_tlbmiss.js` (TLB ruled out), `tmp_allmsg.js`/`tmp_exitwho.js`
(prove `0x8018c2c8` is the fatal exit caller), `tmp_dgwp.js` (env `START=/END=` live disasm).

### Task #12 (CONTINUED, this session): CORRECTED root cause — self-attach from a bad DynId resolve — TRUE ROOT CAUSE FOUND & FIXED in Task #13 (broken 64-bit doubleword shifts → `"N%d"` always `"N0"`)

**The prior "member-list is never populated" lead was a symptom, not the cause.** This
session re-traced the whole path with logging muted (console.log is the perf bottleneck:
~2.5M steps/s muted vs <0.5M with rcp/cpu logging; the full ~26.15M-step run to the panic
takes ~10s muted — easily inside one 45s bash call). New, verified chain:

1. **The member-list IS written** — exactly once, at step **26146611**, pc `0x8017cc8c`
   (`sw v0,28(t8)` inside append `0x8017cc44`), setting `*(0x8009a3d8+0x1c)=0x8009a450`.
   But the membership check at step **26145619** ran *first* and saw the list **empty (0)**,
   returned 0 — so the append is this very call's "if not member, add" branch, firing
   ~1000 steps **too late** to help. (`tmp_w1c.js` = single watch on phys `0x9a3f4`;
   `tmp_w2.js` = ordering of check vs append vs panic.)

2. **`0x80183ff4` is goddard `d_attach_to(flag, obj)`** (string `"addto_group"`@`0x801b4ecc`;
   `"proc_dynlist(): No current object"`@`0x801b55c0`). It is called **once**, at step
   26143304, with `flag=0xd`, `obj=0x80098048` (PLANES, type `0x10000`, id 46), and
   `obj->group (obj+0x30) == 0`. Disasm of the `case 0x10000` (`0x8018412c`): if `obj->group`
   is 0 it allocates one (`0x8017ca34`), sets `subobj=sp+72=newgroup`; then
   `membership(a0=subobj/group, a1=sCurrentMoveObj)`; if **0** → `addto_group(group, cur)` →
   `if (flag & 9) dGetWorldPos(...)` → **fatal** (PLANES unsupported). The membership args
   are **(group, GLOBAL sCurrentMoveObj)** — NOT `(subobj, PLANES)` as the old notes said.

3. **sCurrentMoveObj (global `0x801a7784`) == the same PLANES `0x80098048` (id 46)** at attach
   time ⇒ **d_attach_to is attaching the object to ITSELF**, on a freshly-made (empty) group ⇒
   membership 0 ⇒ fatal. (`tmp_entry.js` shows the single `d_attach_to` call + args + global.)

4. **Who set sCurrentMoveObj wrong:** normal `d_makeobj` updates it via pc `0x80183b98`
   (objects created with ids 84→96 in the lead-up). Then at step **26141641** a *different*
   writer, pc `0x80185c78` inside **`d_use_obj` (`0x80185c2c`)**, overwrites it to id 46.
   `d_use_obj(name)` calls resolver **`0x80183540`** then `sCurrentMoveObj = resolvedNode->[+8]`.
   (`tmp_curobj.js` = watch on `0x801a7784`, shows the makeobj sequence then the divergent
   `0x80185c78` write.)

5. **THE DIVERGENCE (new prime suspect):** the DynId "names" are **small numeric handles**,
   not string pointers. `d_use_obj(handle=0xda)` resolved to **obj id 46**, and the following
   `d_attach_to(flag=0xd, handle=0xdd)` *also* resolved to **obj id 46** — **two distinct
   handles (0xda vs 0xdd) → the SAME object**. That is the wrong behavior that makes the
   attach a self-attach. (`tmp_names.js` logs the handles at `d_use_obj`/`d_attach_to`/lookup.)

**Resolver `0x80183540` disasm (the thing to fix next):** reads a global flag at
`*(0x801c0000-27556)`; if that flag is **0 it returns NULL immediately**; if nonzero it runs
a **string search** — it `strcpy`s `a0` *as a char\** (`0x8018ce08`) into a stack buffer and
linear-scans a table (base `= *(0x801a7780)`, stride `0x14`, compare via `0x8018d020`).
Passing a *numeric* handle (`0xda`) down the **string** path treats `0xda` as a pointer to
RDRAM `0x000000da` (≈ all-zero ⇒ empty string), so different numeric handles collapse onto
the same garbage/empty table entry ⇒ same object. **So either (a) the dynlist handle should
reach a NUMBER-keyed resolver (not this string one), or (b) the handle is a real string
pointer that got truncated to a small int upstream (cf. the Task #9/#10 64-bit fallout), or
(c) goddard's number→object table isn't being built.** Next session: disassemble the
*caller* of `d_use_obj`/`d_attach_to` to see how the DynId is fetched from the compiled
dynlist (number vs pointer), and inspect `0x80183540`'s number path / the global flag at
`*(0x801c0000-27556)`. The decomp symbol is likely `get_dynobj_from_id` / `d_use_obj` in
`src/menu/dynlist_proc.c`.

**Not fixed this session — deliberately no source edits** (kept the 44/44 + title-render
baseline clean; verified tests still 3+38+3 pass per-file). Probes added: `tmp_w1c.js`,
`tmp_w2.js`, `tmp_dis_all.js` (disasm reader+append), `tmp_disc.js` (env `A=`/`N=` live
disasm + string dump — most useful general tool), `tmp_entry.js`, `tmp_curobj.js`,
`tmp_names.js`, `tmp_tbl.js` (table dump — base/count offsets still wrong, ignore),
`tmp_speed.js` (throughput check). **Tip:** mute the VM console (`console:{log:()=>{}}`) and
keep a `realLog` ref for your own output — this is what makes the full 26M run fit in 45s.

## Task #13: goddard panic FIXED — root cause was broken 64-bit doubleword shifts — COMPLETE

**This is the real fix for the Task #12 panic.** The Task #12 "self-attach from a bad DynId
resolve" was a true symptom, but the ROOT cause sits one level lower in the CPU: the MIPS64
**doubleword shift instructions were all wrong**, which silently zeroed every libultra
`_Printf` `%d` conversion and every 64-bit OS multiply/divide.

**The bug (in `cpu.js` `specialTable`):**
- `0x3C` **DSLL32** did `this.gpr[rd] = 0` (never set the high word).
- `0x3F` **DSRA32** did `this.gpr[rd] = this.gpr[rt] >> 31` (read the *low* word's sign bit
  instead of the high word `gprHi[rt]`).
- `0x3E` **DSRL32**, and the non-32 variants `0x14/0x16/0x17` (DSLLV/DSRLV/DSRAV) and
  `0x38/0x3A/0x3B` (DSLL/DSRL/DSRA) all operated on the low 32 bits only and ignored
  `gprHi`. (Shift amounts were also masked to 0x1F instead of 0x3F.)

**Why it broke goddard:** `get_dynobj_from_id` (`0x80183540`) resolves an integer DynId by
`gd_sprintf(buf, "N%d", id)` and string-matching the result against the object-name table.
libultra `_Printf`/`_Ldtob` extracts each decimal digit with the **`dsll32 x,v0,0;
dsra32 x,x,0`** sign-extend idiom. With DSLL32→0 and DSRA32→(low>>31), that idiom always
produced **0**, so `"N%d"` rendered as **`"N0"` for every id**. Every DynId therefore
collapsed onto the same object (id 46 / PLANES) → goddard `d_attach_to` self-attached →
`dGetWorldPos` on an unsupported type → `gd_fatal_printf` → `exit()` at step 26154429.

**Verified the bug in isolation** (`tmp_sprintftest.js`: call `0x802efd04` sprintf directly):
pre-fix `sprintf("N%d",24)` → `"N0"`; post-fix → `"N24"`. Also the 64-bit *multiply*
`0x802ef158` returned **0** pre-fix (it uses the same shifts) and the correct product
post-fix — i.e. *all* OS 64-bit time math was dead-zero before this fix.

**The fix:** all 9 doubleword shifts rewritten with correct MIPS64 semantics using the
existing `_reg64()`/`_setReg64()` helpers (BigInt for the 64-bit value; arithmetic vs logical
right shift via `asIntN(64,…)` vs the zero-extended `_reg64`; `*32` variants add 32 to the
shift amount; variable shifts mask `rs & 0x3F`). Backup of the pre-fix CPU is
`cpu_pre_dshift_backup.js` (kept, do not delete).

**A subtlety worth knowing (not a bug):** with the math fixed, the title now renders ~20M
steps **later** than before. A startup path at `0x802f0d40` computes `500000 * CONST / 1e6`
(`CONST≈0x1d83aac0` at `*0x80302080`) ≈ **247.5M** and waits (via `osRecvMesg`
`0x802ef780`) until **CP0 Count** reaches it — a legitimate ~5 s intro delay. The old broken
math made that deadline `0`, so the game skipped the delay and drew the title almost
immediately (then panicked). Now the game correctly honors the delay: f3d climbs 8→96 between
~step 33M and ~46M, and the title logo renders cleanly with **no panic**. Don't mistake the
"f3d=0 until ~40M steps" for a hang — it's the intro timer; run ≥46M steps (idle
fast-forward gets there in ~40 s muted).

**Verified:** `tmp_sprintftest.js` (printf), `tmp_panicchk.js` (no panic through 27M),
`tmp_longrun.js`/`tmp_node_run.js STOP_AT_F3D=96` → f3d reaches 90–96, ~76k textured +
~14k untextured triangles, `bestRichSnap nonBlack=13491`, title logo in
`test-results/sm64-node.png`. All 44 tests pass per-file (3+38+3).

**Probes added (all `tmp_*`):** `tmp_resolve.js` (resolver name/table dump — shows the `"N0l"`
collision), `tmp_fmt.js` (format-string + sprintf disasm), `tmp_sprintftest.js` (isolated
sprintf — **the key repro**), `tmp_ptrace.js` (instruction trace of `_Printf`+`_Ldtob`,
pinpoints the `dsll32/dsra32` digit idiom), `tmp_panicchk.js`, `tmp_f3dprog.js` (f3d-vs-step),
`tmp_diverge.js` (old-vs-new lockstep PC diff — found the `0x802f0d80` time branch),
`tmp_timeval.js`/`tmp_tg.js`/`tmp_ct.js` (the time-math values), `tmp_pcsample.js`,
`tmp_longrun.js` (lean long runner with time budget).

### Also still pending after #12 / #13
- Title now renders correctly but **~20M steps later** (intro timer, see Task #13). If a
  faster boot-to-title is wanted, that delay is real-hardware-accurate; the slowness is just
  emulated-step throughput. The `bestRichSnap` path still picks the good frame.
- The **deterministic frame target** (`vi-frame-offset`) captures a
  striped buffer (`sm64-node-det.png`); only `bestRichSnap` picks the good frame. Make
  double-buffer/VI-origin timing reliable so the *displayed* frame is the finished one.
- Then: file-select / "press start", controller input (joybus path works; channel 0 just
  isn't polled yet — boot only talks to EEPROM on channel 4 via cmd 0x04), in-game scene.

## Task #14: post-title is NOT a hang — game advances; menu scene has a matrix/W bug — DIAGNOSED (no source changes)

**Headline correction:** the long-standing "post-title freeze" is **not a freeze**. After the
title intro caps at `f3dTaskCount=96` (~step 45.8M), the game-loop thread spends ~25–30M
instructions in a goddard CPU build phase (dominant PCs `0x8017b73c` byte-memset loop and
`0x8018d020` `gd_strcmp`), then **resumes rendering steadily** — a triple-buffered scene at
~1420 triangles/frame across draw origins `0x38f800 / 0x3b5000 / 0x3da800` (VI shows those
+`0x280`). `f3d` climbs ~1 per frame indefinitely. The only reason it *looked* frozen is raw
throughput (~1.3M steps/s; reaching the menu is 110M+ instructions).

**NEW save-state tooling (this session, reusable — the key enabler):**
- `tmp_boot.js` — `buildMachine()` constructs a fresh emulator in the vm sandbox (shared by all probes).
- `tmp_state.js` — `saveState(file,ram,mmu,cpu,rcp)` / `loadState(...)`; dumps RDRAM (8MB → `<file>.rdram`) + CPU/MMU/RCP state (→ `<file>.json`). Restores byte-exact and resumes correctly (verified: resume from pc `0x802f007c`, instrCount 2.83e9, continues rendering).
- `tmp_savestate.js` — runs to `f3d>=96` and writes **`state_f3d96.{rdram,json}`** (the title checkpoint; ~40s to create).
- `tmp_advance.js` — `IN=`/`OUT=` chain: load a state, run ~38s, save a deeper state, report scene metrics + `channel0Cmds`. Produced **`state_adv2`** (deep in the steady-render menu scene, the bug repro).
- `tmp_resume2.js` (lean progress watch), `tmp_resume_render.js` (`STATE=`/`STOPF3D=`/`OUT_PNG=` → PNG of `bestRichVideoSnapshot`), `tmp_dis.js` (`A=addr,addr N=` disasm from a state — fast, no 26M warmup), `tmp_vp.js` (hooks `projectClipToScreen` for screen-bbox + viewport/W stats), `tmp_dumpbufs.js` (dump all 3 framebuffers).
- **Use these from now on** instead of running 45M steps from boot every probe.

**THE NEXT BUG (precisely localized — start here):** the menu scene renders **garbage clip
coordinates**. Measured from `state_adv2` (`tmp_vp.js`): viewport is **correct** (`scale
[160,120,1] trans [160,120,1]` = full 320×240) and `colorImageWidth=320` is correct, **but**
projected screen X spans `[-224959 … +188257]`. Cause: **63% of vertices have W ≤ 0**
(`wNeg=11914`, `wNorm=6936` in one frame) — and crucially the signs are **mixed within a
single frame** (some objects +W, some −W). Vertices with W≤0 get perspective-divided into
±200k screen coords → triangles splatter across the framebuffer with address wrapping → the
**striped/tiled output** seen in `test-results/sm64-adv2.png` (content replicated ~4× across).
The existing `clipTriangleNearPlane` picks a per-triangle sign hemisphere against `nearW=1.0`,
which can't cope with mixed-sign-W-per-frame and also drops valid `|W|<1` near geometry.
**This is a matrix-pipeline divergence specific to the goddard/menu scene** (the title logo's
matrices are fine → renders correctly). Next session: trace `G_MTX` load/multiply + the
modelview/projection stack (`rspState.modelviewStack`, `rspState.projectionMatrix`) for this
scene — likely a transposed/wrong-order multiply or a stack push/pop bug that flips W sign for
some objects. Repro instantly: `STATE=state_adv2 node tmp_vp.js`. Do **not** just widen the
near-plane clipper — fix the W-sign root cause.

**Controller still never polled** through the whole intro+meno-build (`channel0Cmds=0`): every
joybus block skips channels 0–3 (`00 00 00 00 …`) and only talks to channel 4 (EEPROM, cmds
`0x00/0x04/0x05`). So `osContStartReadData` (cmd `0x01`) is never issued yet — the game hasn't
reached its interactive controller-read loop (gated on throughput / the menu render bug above).
`mmu.updateController(buttons,x,y)` is wired and channel-0 read IS implemented in
`processJoybusRead` (`START=0x1000`); it just isn't exercised yet.

**Baseline preserved:** no source files changed this session — only `tmp_*` probes + the
save-state tool + `state_*` checkpoints added. Tests still **3+38+3 = 44/44** per-file; title
still renders (`test-results/sm64-node.png`).

**Debug notes for #12:** panic printer `0x8018c258`/`0x8018c2c8` (prints a message
char-by-char, then `exit(-1)`); goddard fatal `exit` fn `0x8019ab3c`. To capture a panic
message, watch pc `0x8018c534` (`lb t3,0(t2)`, t2=`gpr[10]`) and accumulate the bytes (see
`tmp_panicmsg.js`). `proc_dynlist`=`0x80182b50`, validity check `0x80182b70`
(`xori …,0xd1d4`). New probes this session: `tmp_gamestate.js` (thread/queue dump),
`tmp_disp.js` (per-thread dispatch census), `tmp_dump819.js` (env `ADDR=`/`TOTAL=`, live-RAM
disasm), `tmp_str.js`/`tmp_findstr.js`/`tmp_xref.js` (string + xref search), `tmp_dynchk.js`
(proc_dynlist header check), `tmp_joybus.js` (SI/PIF joybus trace), `tmp_exitcaller.js`
(detect the `exit()` call + recent PCs).

**Debugging entry points:** hook `rcp.runRspTask` (task type at spDMEM 0xFC0+0x00),
`__osDispatchThread` @0x802f40b0 (k0=thread ptr, ctx.sr@+0x118, ctx.pc@+0x11C). Timer:
`__osSetTimerIntr`@0x802f4e04, `osSetCompare`(mtc0 $11)@0x802f7070, COUNTER event handler
@0x802f3b40 (sends event 3 to mq 0x80334940), `serviceCompareTimer()` in cpu.js. SP task
starts go through PC ~0x802f5264 (`handleSpWrite` CLR_HALT). Useful probes created this
session: `tmp_fire.js` (timer fires + f3d), `tmp_threads.js` (thread dispatch census),
`tmp_recvq.js` (which queue each thread blocks on), `tmp_disos.js <addr> <span>` (disasm).

## Task #15: menu-scene W-sign garbage ROOT-CAUSED & FIXED at the triangle level — two CPU/RCP fixes — COMPLETE

This session resolved the Task #14 "menu renders garbage clip coordinates / mixed-sign W"
problem at the geometry level. Two independent bugs were found and fixed; tests still
**44/44** per-file and the title logo still renders byte-for-byte the same
(`bestRichSnap nonBlack=13491`, `test-results/sm64-title-fresh.png` = the 3D MARIO 64 letters).

### Diagnosis (verified from `state_adv2`/`state_advfix1`)
The menu uses the **Fast3D (F3D) microcode, not F3DEX2** (the title is EX2 — that's why they
behave differently). goddard pre-composes its full modelview in software and submits it via
`G_MTX LOAD+PUSH` (identity rotation + translation only; it never pops, the stack grows to
~60 — harmless because LOAD replaces the top). The projection is a standard libultra
`guPerspective` (proj[11]=-1, front = **positive W**). The 2D HUD uses an ortho matrix
(proj[11]=0, proj[15]=1 → W=1, fine). The perspective objects came out with eye-z ≈ +600
(W ≈ -600) → **behind the camera**, and ~63% of vertices had W ≤ 0 with mixed signs within a
frame. Probes: `tmp_mtxdump.js` (matrices at a bad vertex), `tmp_mtxseq.js` (the G_MTX command
sequence — shows all-LOAD+PUSH), `tmp_wcorr.js` (correlates W-sign to which projection:
**positive W ⇒ ortho HUD, negative W ⇒ perspective goddard**).

### Fix 1 — FPU FR=0 odd-register addressing (`cpu.js` `opCOP1`)
SM64 runs with **Status.FR = 0** (32-bit FPRs; verified `Status=0xff01`). In FR=0 an odd
single-precision FPR lives in the **upper half of the even pair** — `getFprAddr32(fs)` already
implements this and is used by MFC1/MTC1/LWC1/SWC1, **but the arithmetic ops (ADD.S/SUB.S/
MUL.S/…, the CVT/round results, and the W/L→float converts) hard-coded `fs*8+4`/`rt*8+4`/
`fd*8+4`** and so silently read/wrote the wrong register for any odd FPR. Rewrote the
`fmt===0` (S), the int/single results in `fmt===1` (D), and `fmt===4` (W) / `fmt===5` (L)
blocks to route every 32-bit operand/result through `getFprAddr32(...)`. Backup:
`cpu_pre_fpufr_backup.js`. (This is a real correctness fix but, on its own, did **not** change
the menu W-sign — goddard's wrong matrices are baked into the saved states; a fresh boot still
showed mixed-sign W. Kept because it is unambiguously correct and the title is unaffected.)

### Fix 2 — near-plane clipper must cull behind-camera geometry (`rcp.js` `clipTriangleNearPlane`) — THE visible fix
goddard is a software 3D engine that submits its **entire** scene, including geometry behind
the eye (W ≤ 0), and relies on the RSP's W-based near-plane clip to reject it. The old clipper
**picked a sign hemisphere from the first vertex** (`sign = cw>0 ? 1 : -1`), so a triangle whose
first vertex was behind the camera was treated as "in front", kept, and perspective-divided
into ±200k screen coords → the striped/tiled splatter. Replaced the heuristic with a **fixed
positive-W near plane** (`sign = 1`, `nearW = 1.0`): in-front (W>0) geometry is kept exactly as
before (so the title is identical), behind-camera (W≤0) triangles are culled/trimmed.
**Verified:** post-clip rasterized triangle bbox went from X[-224959,+188257] to **X[0,319]
Y[0,239]**, `vertsBeyond1000px = 0` (`tmp_rastbounds.js`), 1668 menu triangles now rasterize
on-screen. Backup: `rcp_pre_clipfix_backup.js`.

### Still open — the menu is NOT yet correct (next session starts here)
With both fixes the menu triangles are in-bounds, but `test-results/sm64-menu-clipfix.png`
**still shows horizontal stripes with the content replicated ~4× across**. This is now isolated
to a **separate G_TEXRECT / framebuffer-stride bug, NOT the triangles** — the 10 texrects in the
menu frame are the source of the stripes (the 1668 triangles are clean). Next step: dump the
texrect rects (`xl/yl/xh/yh`, `s0/t0/dsdx/dtdy`, tile, `colorImageWidth`) and the
double-buffer/VI origin (draw origins `0x38f800/0x3b5000/0x3da800`); the 4× horizontal tiling
smells like a width/stride mismatch or texture-coord wrap in `handleG_TEXRECT`
(`rcp.js` ~1707) or a VI-origin/snapshot stride issue. Controller still never polled
(`channel0Cmds=0`) — gated behind the menu becoming interactive.

## Task #16: menu stripe bug RE-DIAGNOSED — it is NOT texrect/stride; it is a textured-triangle combine/discard bug — IN PROGRESS (no source changes; baseline preserved)

**The Task #15 hand-off guess was wrong.** This session systematically ruled out almost
everything and narrowed the menu garbage to the textured-triangle path. Net result: no source
files changed (only `tmp_*` probes added); tests still **44/44** per-file (3+38+3); title
render code byte-identical (verified `rcp.js` reverted clean, `numLights` at line 1865, no
`_noSwz` left). Repro instantly: `STATE=state_advfix1 OUT=test-results/x.png node tmp_swz2.js`
(set `NOSWZ=0`), or `STATE=state_advfix1 STOPF3D=3 OUT_PNG=... node tmp_resume_render.js`.

**What the stripes actually are (all measured from `state_advfix1`):**
- The menu frame is rendered ENTIRELY by **RDP triangles** — CPU writes into the three draw
  buffers (`0x38f800/0x3b5000/0x3da800`, each 320×240×2 = 0x25800 apart, contiguous) are
  **exactly 0** (`tmp_fbwrite.js`). So goddard is NOT software-rendering to RDRAM here; it
  emits a normal F3D display list.
- The 10 texrects are **clean** — small 16×16 HUD icons at x20–83 y204–219, cw=320, cAddr =
  the draw buffer (`tmp_texrect.js`). They are NOT the stripe source. (Task #15's texrect lead
  is dead.)
- **Force `useTexture=false` in `rasterizeTriangle` → the whole 320×240 screen fills solid
  white** (`nonBlack=76160`, `tmp_notex.js`). So the geometry is correct and COVERS the full
  screen; the stripes are purely a per-pixel **texture/combine** effect, not geometry, not
  clip, not W-sign, not viewport.
- Depth ruled out: `depthImage` is **0 for ~all** menu triangles (491×) and 0x400 only 3× ;
  forcing depth off doesn't change the image (`tmp_nodepth.js`).
- Snapshot stride ruled out: re-reading the buffer at widths 80/160/320 never yields a clean
  image — the banding is in the actual pixel data (`tmp_widthtest.js`).
- Odd-line TMEM swizzle (`if (tt&1) wordIndex ^= 1` @ `rcp.js` ~1472) ruled out: gating it off
  (`this._noSwz`) gives a **byte-identical** banded image (`tmp_swz2.js`).
- **The texture itself is fine.** The dominant menu texture is **RGBA16, 80×20, line=20,
  maskS=7(128)/maskT=6(64)**, loaded via **LoadBlock into tile 7**, sampled via render tile 0;
  UVs span exactly s∈[0,2528]→ts 0..79, t∈[0,608]→tt 0..19 (in-bounds, NO wrap). Dumping the
  whole 80×20 texel grid through `sampleTexture` (`tmp_texdump.js` → `test-results/tex80x20.png`)
  shows a **coherent dark-blue strip** — texels are opaque (alpha bit = 1). So TMEM load and
  texture-coordinate addressing are CORRECT.

**THE REMAINING DIVERGENCE (start here next session):** the screen is fully covered by ~224
small textured triangles all using that clean 80×20 tile, yet ~75% of covered pixels come out
**black** in regular horizontal bands (and the visible content repeats ~4× across). Since the
texture is opaque dark-blue everywhere and the geometry covers everything, the per-pixel
**color combiner / alpha-discard** must be producing black (or discarding) for the band pixels.
Prime suspects, in order: (1) **perspective-correct s/t interpolation** using `invW=1/|w|` in
`rasterizeTriangle` (~1381) — if these small menu tris have near-zero or wildly varying W, the
s/t per-pixel can jump outside the 80×20 tile into adjacent TMEM → garbage/zero-alpha texels →
discard → black bands; (2) the **color combiner** (`combineColor`, ~1518) picking a wrong
source for this scene's SETCOMBINE so output goes black; (3) the **alpha-compare gate**
`if (color.a < 1 && (otherModeLo & 0x4000)) continue;` (~1420) firing on interpolated alpha.
**Decisive next probe:** for ONE band-vs-gap pixel pair on a single menu triangle, log the
barycentric weights, the three vertices' (s,t,w), the interpolated (s,t), the sampled texel,
and the combiner inputs/output. That will say immediately whether it's interpolation (s/t out
of tile), combiner, or alpha. Do NOT touch `handleG_TEXRECT` — it is not involved.

**New probes this session (all `tmp_*`, safe to delete):** `tmp_texrect.js` (texrect dump),
`tmp_widthtest.js` (stride test), `tmp_addrs.js` (ci/di/rowWrites), `tmp_nodepth.js`,
`tmp_notex.js` (the key "untextured = full white" test), `tmp_fbwrite.js` (proves 0 CPU FB
writes), `tmp_tileinfo.js` (tile params + UV span), `tmp_loadpath.js` (LoadBlock vs LoadTile),
`tmp_swz2.js` (swizzle toggle + PNG), `tmp_texdump.js` (dumps the clean 80×20 texture),
`tmp_dumpvi.js` (dump VI-origin buffer of a state). NB `state_f3d96_fix` is the title
checkpoint: its VI-origin buffer is the (black) back buffer — the title is captured via
`bestRichSnap`, so `tmp_resume_render.js STOPF3D=20` from it renders the POST-title menu, not
the title.

> ⚠️ **Sandbox FUSE gotcha (hit again this session, now with a clean remedy):** a one-line
> Windows `Edit` to `rcp.js` made the bash mount serve a tail-**truncated** copy (1866 vs 1869
> lines, `node --check` → "Unexpected end of input") even though the Windows Read/Grep showed
> the full correct file. Remedy that worked: repair/rewrite the file **from bash** with
> `python3` (`s.rfind(...)` to find the last good anchor, re-append the closing braces, then
> `open(...,'w')`), `node --check`, then verify the Windows side with the `Grep` tool. Keep
> edits to large hot files (`cpu.js`/`rcp.js`) bash-side when possible.

> ⚠️ **Sandbox FUSE gotcha (also hit in Task #15):** the bash mount can **pin a stale,
> NUL-padded copy** of a large file that was `cp`'d earlier in the session — Windows-side
> file-tool edits to `cpu.js` then do **not** propagate to bash (you'll see `node --check`
> fail with "Unexpected end of input" and `wc -l` show a truncated file with an OLD mtime,
> even though the Windows Read tool shows the correct content). New files and **bash-side
> writes** DO propagate both ways. Remedy that worked: re-create the file **from bash**
> (`python3` reading a known-good `*_backup.js` + re-applying the edits, then `open(...,'w')`).
> Verify the final Windows-side content with the `Grep` tool on the Windows path.

New probes this session (all `tmp_*`): `tmp_mtxdump.js`, `tmp_mtxseq.js`, `tmp_wcorr.js`,
`tmp_w.js`, `tmp_vp.js` (NB: measures **pre-clip** per-vertex projection, so its bbox stays huge
even after the clip fix — use `tmp_rastbounds.js` to measure the **post-clip** rasterized bbox),
`tmp_rastbounds.js`, `tmp_frcheck.js` (FR mode + odd-reg usage), `tmp_titlerender.js`
(fresh-boot title PNG). New checkpoints (fixed CPU): `state_f3d96_fix`, `state_advfix1`.

## Task #17: LoadBlock TMEM swizzle bug FIXED; menu band cause fully characterized — IN PROGRESS

This session root-caused the Task #16 menu stripes at the pixel level and fixed one concrete,
verified correctness bug. Tests still **44/44** per-file (3+38+3); the title still renders the
colorful MARIO 64 logo (`test-results/sm64-title-fresh.png`, origin 0x38f800, nonBlack=13229,
essentially identical to the old 13491 baseline — the tiny delta is a few RGBA16 texels now
sampled from the correct TMEM word).

### The decisive pixel-level diagnosis (all from `state_advfix1`, `tmp_bandprobe.js`)
Wrapping `sampleTexture` + `combineColor` per pixel over the menu frame proved:
- The menu is a **grid of ~48 small textured quads** (≈80×20 each, 4 across × 12 down) all
  sampling **one 80×20 RGBA16 (5551) texture** loaded via **LoadBlock into tmem 0** (353×,
  zero LoadTile — `tmp_loadwhich.js`). The "4× horizontal repeat" is just this quad grid.
- The in-force combiner for these draws is **color = TEXEL0, alpha = SHADE (=255)**
  (per-record `hi=0xffffff lo=0xfffcf87c`, NOT the final-snapshot combiner). So output rgb =
  texel rgb, output alpha forced to 255.
- **75% of sampled texels are transparent** (5551 alpha bit = 0 → rgb 0). Because the combiner
  forces alpha 255 and we don't run the RDP blender, those transparent texels get written as
  **opaque black** → the period-20 horizontal black bands (5 opaque rows + 15 transparent rows
  per 20-px quad; `tmp_rowscan.js` shows ` ##### ` every 20 rows). SHADE is white(255) and PRIM
  is 0xffffffff, so shade/lighting is NOT the problem.

### FIX (applied to `rcp.js` `sampleTexture`, RGBA16 path) — the verified win
`handleG_LOADBLOCK` copies texels into TMEM in **flat row-major** order (it does NOT replicate
the hardware odd-line 64-bit-word interleave). The sampler was nonetheless re-applying an
odd-line `if ((tt&1)!==0) wordIndex ^= 1;` swizzle, which **corrupted every odd row** of every
LoadBlock RGBA16 texture. Proof: dumping the 80×20 alpha grid (`tmp_texswz.js`) with the
swizzle ON gave alternating fully-empty odd rows + a broken horizontal repeat; with the swizzle
OFF the texture is a **coherent continuous diagonal**. **Removed the `^1` swizzle.** Verified
title-safe (rendered the title with the swizzle on vs off — visually identical colorful letters,
nonBlack 13491→13229) and tests stay 44/44. Backup: `rcp_pre_task17_backup.js`.
> ⚠️ Task #16's note that "gating off the swizzle is byte-identical" was a **flawed test** (the
> `_noSwz` flag was never actually read by the sampler). Removing the swizzle genuinely changes
> the texture — `tmp_texswz.js` proves it.

### Tried and REVERTED this session (do not re-add naively)
A texel-alpha **punch-through** (`if (useTexture && tex.a===0) continue;` in `rasterizeTriangle`,
to skip transparent texels instead of writing black) was added and then **reverted**: it changed
which framebuffer `bestRichSnap` selects for the title (picked a mid-animation 0x3da800 frame
without the colored letters) and did **not** visibly fix the menu anyway (the background behind
the transparent texels is itself black — nothing is drawn there to reveal). So discarding alone
is insufficient; the real fix needs the **RDP blender** (and/or a real menu background fill).

### NEXT STEP (start here) — the menu bands need the RDP blender, not just a discard
The menu quads use render mode `otherModeLo=0x552048` (alpha-compare gate bit 0x4000 is OFF, so
the existing combiner-alpha gate at `rcp.js` ~1414 never fires). To render the menu correctly:
1. Implement the **1-cycle RDP blender** (`(P*A + M*B)` muxes from `otherModeLo` bits 16..31) so
   transparent (5551 alpha-bit-0) texels blend with the framebuffer instead of overwriting it,
   and so SM64's standard `G_RM_*` modes work. Use the texel's 1-bit alpha as coverage for
   `*_TEX_EDGE`/punch-through modes.
2. Confirm a **background** is actually drawn behind the 48-quad glyph grid (dump draw order for
   origin 0x3da800); if the grid is a goddard `gdm_maketestdl` *debug* text pattern rather than a
   real game menu, the save-state may simply be in a debug scene — re-derive a state that is
   unambiguously the file-select screen before judging correctness.
3. Decisive repro: `STATE=state_advfix1 node tmp_bandprobe.js` (per-record combiner + texel
   stats); `STATE=state_advfix1 STOPF3D=20 OUT_PNG=... node tmp_resume_render.js` (PNG);
   `node tmp_texswz.js` (texture alpha grid, swizzle on/off/^2).

**New probes this session (all `tmp_*`, safe to delete):** `tmp_bandprobe.js` (per-pixel
combiner/texel correlation — THE key probe), `tmp_texgrid.js`/`tmp_texswz.js` (TMEM alpha grid +
swizzle-variant comparison), `tmp_loadwhich.js` (LoadBlock vs LoadTile census), `tmp_render2.js`
(menu render with NOSWZ/DISCARD toggles), `tmp_titleswz.js`/`tmp_titledisc.js` (title render with
toggles, used to prove title-safety), `tmp_rowscan.js` (PNG per-row nonblack profile → band
period). Controller still never polled (`channel0Cmds=0`) — gated behind the menu becoming
interactive.

## Task #18: RDP 1-cycle blender implemented — translucency/punch-through now composite against the framebuffer — COMPLETE

This session implemented the **N64 RDP 1-cycle blender** in `rcp.js`, the feature the Task #17
hand-off called for. This is the missing piece that lets transparent/translucent texels and
coverage/punch-through surfaces composite with the framebuffer instead of overwriting it with
opaque black — the root of the menu "black band" artifact, and a prerequisite for shadows,
water, text and HUD in the actual game. Tests still **44/44** per-file (3+38+3); the title logo
still renders the colourful 3D MARIO 64 letters (`test-results/sm64-title-fresh.png`,
origin 0x38f800, `nonBlack=13399`, unchanged from the ~13.3–13.5k baseline). Backup of the
pre-blender RCP is `rcp_pre_task18_backup.js` (kept, do not delete).

**What was added (`rcp.js`):**
1. **`blendPixel(px, mem, texAlpha)`** — decodes the cycle-1 blend muxes from `otherModeLo`
   (`P=bits30-31`, `A=bits26-27`, `M=bits22-23`, `B=bits18-19`) and computes `out = Pc*A + Mc*B`.
   Color selects: 0=pixel(combiner), 1=memory(framebuffer), 2=blendColor, 3=fogColor. A-factor:
   0=combiner/coverage alpha, 1=fog alpha, 2=shade alpha, 3=0. B-factor: 0=(1−A), 1=memory
   alpha, 2=1, 3=0. With **ALPHA_CVG_SEL** (`otherModeLo` bit 13) set — the SM64 case — the blend
   "alpha" is taken as **pixel coverage**, approximated by the sampled **texel alpha** (our
   textures are 1-bit-alpha 5551/RGBA16), and `B` is forced to `1−A` so fully-transparent
   (coverage 0) texels preserve the background exactly.
2. **`readMemColor(rd, p, cSz)`** — reads the current framebuffer pixel (RGBA16 or RGBA32) back
   to 0..255 RGBA for the blend.
3. **`blenderActive()`** — gates blending: only when **IM_RD** (`otherModeLo` bit 6) is set AND
   the mux actually references memory (`pSel==1 || mSel==1 || bSel==1`). Opaque modes (no FB
   read) fall straight through to the previous direct write — this keeps the title byte-stable
   and fast.
4. Wired into **both** raster paths — `rasterizeTriangle` (triangles) and `handleG_TEXRECT`
   (texrects). Added `blendColor`/`fogColor` to `rspState` init (they're written by SETBLENDCOLOR
   `0xF9` / SETFOGCOLOR `0xF8` but were previously never initialised).

**Verified:** title renders identically (`tmp_titlerender.js` → f3d 96, colourful letters);
menu scene from `state_advfix1` (`STATE=state_advfix1 STOPF3D=20 node tmp_resume_render.js` →
`test-results/sm64-menu-blender.png`): the formerly opaque-black background is now the scene's
**gray background fill**, with the blue glyph content composited over it (`nonBlack` 13k→76019,
i.e. the whole screen is now live instead of black-banded). The residual horizontal banding in
that PNG is the **actual content of the goddard `gdm_maketestdl` debug test display list**, not a
renderer bug — this saved state is a goddard debug scene, not the real file-select screen (as
Task #17 already flagged). So the blender is behaving correctly; judging menu "correctness"
needs a state that is unambiguously the file-select screen.

**NEXT STEP (start here):** (1) Drive the boot far enough to reach the **real** title→file-select
transition (needs the controller's START press to be polled — see below) and re-judge the menu
with the blender in place. (2) **Controller input:** `channel0Cmds` is still 0 through the whole
intro+menu-build; the game only talks to channel 4 (EEPROM) and never issues `osContStartReadData`
(joybus cmd `0x01`) because it hasn't reached its interactive controller-read loop. `mmu.updateController()`
+ channel-0 read are wired; the gate is throughput / reaching the interactive menu. Try
`PRESS=1 node tmp_resume_render.js` (injects a 0x1000 START press at rel-step 3M) from a
file-select state. (3) Once input works: "press start" → file-select → in-game scene, then the
deterministic-frame / VI-origin double-buffer timing (`sm64-node-det.png` still captures a
striped back-buffer; only `bestRichSnap` picks the finished frame).

**Probes/artifacts this session:** reused `tmp_titlerender.js`, `tmp_resume_render.js`,
`tmp_boot.js`, `tmp_state.js`; new PNG `test-results/sm64-menu-blender.png`. No new `tmp_*`
probes were needed.

## Task #19: controller-input blocker PRECISELY LOCALIZED — game sits at the real title "PRESS START" screen but `osContStartReadData` is NEVER issued — DIAGNOSED (no source changes; baseline preserved)

This session chased the "controller never polled" hand-off from Tasks #14/#18 to a definite
root location. **No source files were changed** — tests still **44/44** per-file (3+38+3) and
the title still renders. The point of this session is the precise localization below so the
next session can go straight to the fix instead of re-deriving the symptom.

### Verified facts (all measured from fresh boot and from `state_advfix1`/derived states)
1. **We are genuinely at the title / "PRESS START" screen, not a debug scene.** The Mario head
   is built every frame by **`gdm_maketestdl`** — and that IS the legitimate SM64 title/file-
   select head-DL builder (the goddard name table at `0x801b84b4` lists `gdm_init`/`gdm_setup`/
   `gdm_maketestdl`; the strings **`"PRESS START BUTTON"`@`0x801a6c90`** and **`"SELECT STAGE"`
   @`0x801a6c80`** are resident in RDRAM). So Tasks #16/#17's worry that `gdm_maketestdl` meant
   a "debug scene" was a **false alarm** — this is the normal title screen.
2. **The game is progressing, not deadlocked.** From a deep state the OS scheduler cycles all
   threads normally — dispatch census (per ~20M steps): goddard head thread `0x80308ef0` ≈640×
   (busiest), `0x803349b0` ≈590×, game-loop `0x80308d40` ≈135× (blocks each frame on queue
   `0x803092e8`), plus `0x80308b90`/`0x803089e0`/`0x80333790`. `f3dTaskCount` climbs ~27 per
   20M steps. It is **compute-bound** (the per-frame goddard head build dominates; CP0 idle
   fast-forward inflates `instructionCount` ~150× over `step()` count), NOT hung.
3. **Controllers are NEVER polled.** Across a fresh boot (42M steps) AND ~80M+ chained steps
   into the title, **every** joybus/PIF transaction skips channels 0–3 (`00 00 00 00`) and only
   ever talks to **channel 4 = EEPROM** (`cmd 0x00` info → returns type `0x0080`; `cmd 0x04`
   block read). `controllerDebug.channel0Cmds` stays **0**. The first SI DMA of the whole boot
   is at `instr≈495M` (CIC checksum handshake `pifRam[0x3F]=0x20→0x80`, then the repeating
   EEPROM poll once per VI frame).
4. **The button-read PIF block is never even built.** Searching all of RDRAM for the
   `osContStartReadData` per-channel signature **`01 04 01 FF`** (txlen1/rxlen4/cmd1) →
   **NONE**. The `osContInit` status template **`FF 01 03 00`** *does* exist (low RAM
   `0x71bc7`/`0x71d3f`), so libultra's contpfs data is set up, but **`__osPackReadData` /
   `osContStartReadData` is never called** → `read_controller_inputs` is never reached.

### Conclusion / NEXT STEP (start here)
The controller **emulation layer is correct and complete** — `processJoybusRead` already
implements channel-0 `cmd 0x00` (report standard controller, type `0x0005`) and `cmd 0x01`
(return `buttons`/`stickX`/`stickY` from `mmu.updateController`); they simply are **never
exercised** because the game never issues a button read. So the bug is **upstream in the
emulated game**, not in the joybus code. The exact open question for next session:

> **Why does the title-screen game loop never call `osContStartReadData` (cmd 0x01 on ch0)?**

Two concrete hypotheses to test, in order:
- **(A) `osContInit` never completed**, so `gControllerBits == 0` and SM64's
  `read_controller_inputs` early-outs (it reads `osContStartReadData` only when at least one
  controller bit is set). Evidence consistent with this: the **status query block is never
  DMA'd to PIF either** (no `01 03 00` on ch0–3 in any SI write — only the EEPROM block ever
  reaches the PIF). Find `osContInit` (it acquires `__osContPifRam`, packs `CONT_CMD_REQUEST_
  STATUS`, `__osSiRawStartDma(OS_WRITE)`, waits on the SI event mq, `OS_READ`, then
  `__osContGetInitData` → `gControllerBits`). Breakpoint its entry from a fresh boot; if it is
  never reached, trace its caller in `thread3_main`; if it is reached but its SI write carries
  the EEPROM-only block, the joybus **format/packing** of the status request is the bug.
  Then locate `gControllerBits` (the word `__osContGetInitData` writes) and confirm it is 0.
- **(B) `read_controller_inputs` is gated by a flag during the intro.** Less likely given the
  "PRESS START" screen is interactive on hardware, but worth a glance once (A) is ruled out.

**Fast repro tooling (reuse, don't rebuild):** `tmp_boot.js` `buildMachine()`, `tmp_state.js`
`loadState/saveState`. A fresh boot reaches the first SI DMA at ~26M `step()`s (~10–12s muted);
mute the VM console for throughput. To watch joybus, wrap `mmu.doSiDma`/`mmu.processJoybusRead`
and dump the 64-byte `mmu.pifRam` (channel layout: bytes are `[txlen][rxlen][cmd…]` per channel,
`0x00`=skip channel, `0xFF`=pad, `0xFE`=end). `mmu.controllerDebug` accumulates
`channel0Cmds`/`buttonReads`/`infoReads`. (All `tmp_*` probes from this session were deleted
after use — recreate as needed; the recipe above is the whole method.)

### Progress estimate
**~58%** toward "runs SM64 properly." Done: HLE boot, full OS (threads/timer/TLB), F3DEX2+F3D
display lists, software RDP rasterizer with lighting/textures/depth/near-clip and the new
1-cycle blender, and a **pixel-correct title screen**. Not yet: getting **past** the title
(blocked on the controller-read path above), file-select, in-game scenes, audio output, and
reliable double-buffer/VI-origin frame timing.

## Task #20: controller input WORKS — SWR/SDR opcodes were swapped in the dispatch table — COMPLETE

**This is the fix for the Task #19 "controller never polled" blocker, and it was a one-line
CPU bug.** The entire controller path now works: `osContInit` detects the controller,
`osContStartReadData` polls buttons every frame, and a pressed button (e.g. `START=0x1000`)
is read all the way through to the game. Tests still **44/44** per-file (3+38+3); the title
still renders the colourful MARIO 64 logo + "PRESS START" text (`test-results/sm64-title-swrfix.png`,
no regression). Backup of the pre-fix CPU: `cpu_pre_swrsdr_backup.js`.

### Root cause (the decisive chain)
`osContInit` packs its `CONT_CMD_REQUEST_STATUS` block into `__osContPifRam` (controller
buffer at **phys 0x335b80**, distinct from the EEPROM buffer at 0x336ca0). The compiled
`__osPackRequestData` (`0x802f0fxx`) stores the per-channel format word `0xff010300`
(dummy=ff, txsize=01, rxsize=03, cmd=00) with **unaligned `swl`/`swr`** (opcodes `0x2A`/`0x2E`).
The CPU's `opTable` had **`0x2D`→opSWR and `0x2E`→opSDR**, but the correct MIPS encoding is
**`0x2D`=SDR, `0x2E`=SWR**. So every `swr` (0x2E) was dispatched to `opSDR`, doing a **64-bit
doubleword store** that wrote `0x00000000_ffffffff` across 0x335b80, clobbering the just-written
`0xff010300` first word → the block became `00 00 00 00 ff ff ff ff` per channel. The joybus
decoder reads a leading `00` as "skip channel", so all four controller channels were skipped →
`osContInit` saw no controllers → `gControllerBits=0` → `read_controller_inputs` never calls
`osContStartReadData` → game stuck reading nothing on the title screen.

### The fix (`cpu.js`)
Swapped the two `opTable` entries so they match the MIPS spec:
```
this.opTable[0x2C] = this.opSDL;  // SDL (unchanged, was correct)
this.opTable[0x2D] = this.opSDR;  // was opSWR  ← FIX
this.opTable[0x2E] = this.opSWR;  // was opSDR  ← FIX
```
The individual `opSWL/opSWR/opSDL/opSDR` implementations were already correct; only the
dispatch mapping was wrong. Loads (`0x22`=LWL, `0x26`=LWR, `0x1A`=LDL, `0x1B`=LDR) were
audited and are correct.

### Verified
- Controller status block now DMAs as `ff 01 03 00 ff ff ff ff ff 01 03 00 …` (channels 0–3),
  and a **button-read block `ff 01 04 01 …` (cmd 0x01)** is now issued every frame
  (`tmp_siuniq2.js`): `channel0Cmds=48, infoReads=1, buttonReads=47` over a boot to f3d=48
  (was 0/0/0).
- Injecting `mmu.updateController(0x1000,0,0)` and reading back: `controllerDebug.lastButtons
  = 0x1000` — the START press reaches the game end-to-end (`tmp_startpress.js`).
- Title unchanged (`tmp_resume_render.js` from `state_title_fix`), tests 44/44.

### NEXT STEP (start here)
The controller I/O is done; the next blocker to *see* the title→file-select transition is
throughput + the **menu rendering bugs** (Tasks #15–#18: W-sign/clip already fixed, blender
added; residual goddard `gdm_maketestdl` banding remains). To test menu navigation quickly:
1. Fresh title checkpoint **`state_title_fix`** (f3d=40, made with the fixed CPU so
   `gControllerBits` is set) is saved — load it, press START, run.
2. `tmp_startpress.js` (presses START, confirms `lastButtons`), `tmp_startadv.js`
   (press+release toggle, renders `test-results/sm64-after-start.png`), `tmp_siuniq2.js`
   (per-block joybus census). Throughput from `state_title_fix` with per-frame snapshotting is
   ~0.1M steps/s, so reaching the menu transition needs a longer run or a deeper save-state.
3. After the transition renders: stick input (`stickX/stickY` via `updateController`), then
   in-game scene, audio output, and reliable VI-origin double-buffer frame timing.

**New probes this session (all `tmp_*`, safe to delete):** `tmp_sitrace.js`/`tmp_sitrace2.js`
(SI trace — NB early versions logged *stale* pifRam before the copy; read `rdram@dramAddr`
instead), `tmp_si_src.js` (dram source addrs), `tmp_siuniq.js`/`tmp_siuniq2.js` (unique joybus
blocks — the key census), `tmp_pack*.js`/`tmp_packc.js`/`tmp_low.js`/`tmp_low2.js` (watch the
__osContPifRam packing — `tmp_low2.js` caught the rogue `write64` from the mis-dispatched swr),
`tmp_first.js` (first N SI blocks), `tmp_scan6ca0.js` (find __osContPifRam refs),
`tmp_cnt.js` (PC-hit census of libultra SI fns), `tmp_fdis.js` (fresh-boot disassembler — set
`A=addr,addr N=count`), `tmp_savestate_fix.js`/`tmp_startpress.js`/`tmp_startadv.js`.
New checkpoint: **`state_title_fix`** (title, fixed CPU, gControllerBits set).

### Progress estimate
**~63%** toward "runs SM64 properly." Done since #19: the controller read path now works
end-to-end (osContInit→osContStartReadData→button data reaches the game). The remaining work
to get visibly past the title is rendering-side (menu DL banding) + throughput, then file-select,
stick input, in-game scenes, audio output, and VI double-buffer timing.

## Task #21: texture S/T addressing modes (clamp/mirror) implemented — COMPLETE

This session closed a real, spec-defined RDP correctness gap in `rcp.js`: the texture
sampler **ignored the tile's clamp/mirror (cmS/cmT) bits and always wrapped** by the mask
size. SM64's HUD, on-screen text, and goddard face tiles rely on **clamp** addressing; with
forced wrap, coordinates past the tile extent fold into empty/adjacent TMEM → transparent or
garbage edge texels. Tests stay **44/44** per-file (3+38+3) and the title logo is
**byte-stable** (`tmp_titlerender.js` → f3d 96, origin 0x38f800, `nonBlack=13399`, identical
to the Task #18 baseline). Backup of the pre-fix RCP: `rcp_pre_clamp_backup.js`.

### What was found / fixed
- Probe `tmp_tilecm.js` (decodes G_SETTILE cm bits per draw) on `state_advfix1` shows the
  dominant menu texture (the 80×20 RGBA16, `maskS=7/maskT=6`) is loaded with **`cmS=2,
  cmT=2` = CLAMP**, yet the sampler was doing `ts = Math.abs(ts) % wrapS` (unconditional
  wrap). Several SM64 tiles use clamp (cm=2); none of them were honored.
- `handleG_SETTILE` now decodes **`cmS = (lo>>8)&3`** and **`cmT = (lo>>18)&3`** (bit0=mirror,
  bit1=clamp) and stores them on the tile (added `cmS,cmT` to the tile init at rcp.js ~251).
- New helper **`applyTexAddr(coord, mask, cm, sizeTexels)`** replaces the inline wrap:
  clamp (cm&2) holds the edge texel using the SETTILESIZE extent
  (`sizeTexels = ((lrs-uls)>>2)+1`), mirror (cm&1) reflects within `2*wrap`, otherwise wrap by
  `1<<mask` (now a proper signed modulo, not `Math.abs`). Mask-0 tiles clamp to the tile
  extent when known (hardware behavior) instead of the old `%1024`.

### Verified
- Title byte-stable (13399). Menu render from `state_advfix1`
  (`STATE=state_advfix1 STOPF3D=20 node tmp_resume_render.js`) → `test-results/sm64-menu-clamp.png`,
  `nonBlack=76019` — same as the Task #18 blender result (gray background fills, blue glyph
  bands composite over it). So the clamp fix is **correct and non-regressing**; it does not by
  itself transform this particular scene because that menu texture's S coords were already
  in-range — the residual horizontal banding is still the **goddard `gdm_maketestdl` debug
  display-list content** (as Tasks #17/#18 established), not a sampler bug. The clamp fix
  matters most for HUD/text/face tiles elsewhere.

### Sandbox FUSE gotcha (hit again — clean remedy confirmed)
Windows `Edit`s to `rcp.js` did **not** propagate to the bash mount: `node --check`/`cat`/`wc`/
`cp` all served a **stale 91469-byte, Jun-5-mtime copy truncated mid-`rasterizeTriangle`** (so
`node --check` failed "Unexpected end of input" at the tail). **`python3` read the real file
correctly** (`len 93307`, edits present). **Remedy that worked:** `python3 -c "d=open('rcp.js','rb').read(); open('rcp.js','wb').write(d)"` (a bash-side rewrite of the already-correct content)
then `sync` → `node --check` immediately saw the full 2008-line file. Use python to read/verify
and to force-rewrite large hot files after Windows edits.

### NEXT STEP (start here)
Unchanged headline blocker: get **visibly past the title**. Two tracks:
1. **Throughput/transition:** hold START from `state_title_fix` and chain save-states
   (`IN=/OUT= … PRESS=1 PRESS_AT=0 node tmp_advance.js`) — controller polling works
   (`channel0Cmds`/`buttonReads` climb, CH0 begins ~step 73k). A few chained 38s runs reach
   `state_s1`/`state_s2` (this session) but no clear file-select transition yet; rendering
   `state_s2` still shows the goddard band scene via `bestRichVideoSnapshot`. Need either much
   more emulated time or to confirm the title→file-select logic actually fires on a START
   edge (try a press **edge**, not a continuous hold — menus often latch on the press
   transition; `tmp_startadv.js` toggles but very slowly).
2. **goddard head/menu banding (the real render blocker):** the title's 3D "MARIO 64" letters
   render perfectly, but the goddard Mario-head / `gdm_maketestdl` content renders as
   horizontal content/gray bands (4×-repeat). Decisive un-done probe (from Task #16, still the
   right next move): for one band-vs-gap pixel pair on a single menu triangle, log barycentric
   weights, the three verts' (s,t,w), interpolated (s,t), sampled texel alpha, and combiner
   output — to confirm whether the transparent rows are the texture's real content (→ goddard
   debug scene, re-derive a true file-select state) or an interpolation/geometry artifact.

**New probe this session:** `tmp_tilecm.js` (per-draw G_SETTILE clamp/mirror/mask/format census
from a state — the probe that found the ignored clamp bits). New checkpoints: `state_s1`,
`state_s2` (title + held START, deeper than `state_title_fix`). New PNGs:
`test-results/sm64-menu-clamp.png`, `sm64-s2.png`, `sm64-after-start.png`.

### Progress estimate
**~64%** toward "runs SM64 properly." Texture addressing is now spec-correct (clamp/mirror),
joining the already-working HLE boot, full OS (threads/timer/TLB), F3DEX2+F3D, software RDP
(lighting/textures/depth/near-clip/1-cycle blender), pixel-correct title, and end-to-end
controller input. Still open: getting visibly past the title (throughput + goddard head
banding), file-select, stick input, in-game scenes, audio output, VI double-buffer timing.

## Task #22: CPU throughput +52% (idle-check gating) + blocker re-characterized — COMPLETE

This session attacked the **throughput wall** that is the real headline blocker (reaching the
interactive title/file-select needs hundreds of millions of `step()`s). Made a verified,
non-regressing CPU speedup and pinned down why the game stays mid-intro. Tests still **44/44**
per-file (3+38+3); title byte-stable (`test-results/sm64-title-fresh.png`, origin 0x38f800,
`nonBlack=13399`, colourful MARIO 64 letters). Backup of pre-change CPU: `cpu_pre_perf_backup.js`.

### The win — `cpu.js step()` / `tryFastForwardIdleLoop`  (1.338M → 2.040M steps/s, +52%)
Measured on `state_advfix1` (`STATE=state_advfix1 N=15000000 node tmp_bench.js`). Two issues,
both in the per-instruction hot path:
1. **`tryFastForwardIdleLoop` ran in full on EVERY step** — status-bit checks, a **redundant
   second `readInstructionWord`** of the current PC, and a freshly-allocated `consider`
   closure — even though it only ever does anything when the fetched instruction is the
   canonical idle spin `beq $zero,$zero,-1` (`0x1000FFFF`). `step()` then fetched the SAME
   instruction word a second time. **Fix:** `step()` now fetches once, and only calls
   `tryFastForwardIdleLoop` when `instruction === 0x1000FFFF`; the idle routine no longer
   re-fetches (caller guarantees the opcode + alignment) and the `consider` closure is inlined
   to straight-line comparisons (no per-idle allocation). Profiling (`node --prof`) had shown
   `tryFastForwardIdleLoop` at ~152 ticks running unconditionally — now skipped for ~all
   non-idle instructions.
2. **Dead per-instruction debug instrumentation removed.** `step()` had `pcHistory` writes +
   `% 100` every step and several silenced `pc === 0x…` trap blocks (incl. a whole `f3d>=96`
   block that ran constantly during the throughput-bound menu phase). `pcHistory` + the debug
   dump are now gated behind `this.debug` (still available for diagnostics; `pcHistory` array
   and the `console.warn` dump in `raiseException` are untouched). The silenced traps
   (`_spinCallCount`/`_overlayCallCount`/`_stateDumpCount`/`_skipCount`/the pi-int logger) are
   deleted. This alone was ~+3%; the idle-gating change is the bulk of the +52%.

Correctness preserved: the interrupt `raiseException(0,…)` still runs before the idle check and
falls through to execute the handler exactly as before (after it, the fetched instruction is the
vector, not `0x1000FFFF`, so the idle path is correctly skipped). `tryFastForwardIdleLoop` is
called from exactly one place (`step()`), so narrowing its contract is safe.

### Blocker re-characterized (no source change here, but rules things out)
- **The renderer is CORRECT on what goddard feeds it.** `state_advfix1`'s "menu" is genuinely
  goddard's tiled **test display list** (`gdm_maketestdl`): `tmp_quadgeo.js` shows it is a grid
  of 80×20 quads each mapping the full 80×20 RGBA16 texture with **W=1** (orthographic) and
  exact UVs (s 0→2528, t 0→608, scaleS/T=0.0303 → ts0..79/tt0..19). No W-sign, clip,
  interpolation, or stride bug — the horizontal bands ARE the test texture's real content. So
  chasing the `state_advfix1` "banding" further is a dead end; it is not a real game scene.
- **Controller is polled but the game stays mid-intro.** From `state_title_fix`, injecting
  clean START **edges** (press→release) over 52M steps (`tmp_startgo.js`): `buttonReads` climbs
  (73), but `latestVideoTarget` never changes character — same three draw buffers
  (0x38f800/0x3b5000/0x3da800), ~1040–1440 tris/frame, **no scene transition**, f3d only ~73.
  The title only fully composes at f3d=96, so we are still **inside the intro animation**, not
  at an interactive "PRESS START". Two likely reasons for the next session to test: (a) the
  press windows (≤400k steps) alias past the ~once-per-700k-step controller poll — hold START
  for **several million steps** (≈ multiple VI frames) to guarantee multiple reads AND a fresh
  press edge; (b) the intro timer (Task #13, ~247.5M CP0-count deadline) must elapse before the
  title becomes interactive — with +52% throughput a single deeper run is now more feasible.

### NEXT STEP (start here)
1. **Push past the intro with the new headroom.** From `state_title_fix`, run a long chained
   chain (`tmp_advance.js IN=/OUT=`) **holding START for ≥5M steps then releasing**, and watch
   `latestVideoTarget` / draw-origin character + `f3d` for a transition. At 2.04M steps/s a 40s
   bash call now covers ~80M steps; 2–3 chained calls may reach the title→file-select edge.
2. If still stuck mid-intro, find the **intro-complete / "press start" gate** (the state machine
   around `0x80242bb0`/`0x80242c20`, already trapped in the old debug code — see
   `cpu_pre_perf_backup.js` for those PCs) and confirm whether START is checked there.
3. Render the **displayed VI-origin buffer** (not `bestRichSnap`) after a transition to judge
   the real scene; then file-select, stick input, audio, VI double-buffer timing.

**Probes this session (all `tmp_*`):** `tmp_bench.js` (throughput meter — reuse for any future
perf work; `STATE=… N=… node tmp_bench.js`), `tmp_quadgeo.js` (per-textured-triangle x/y/s/t/w
dump from a state — proves UVs/W are correct), `tmp_startgo.js` (START-edge injection +
`latestVideoTarget` census). No new checkpoints. **Reminder:** edit hot files (`cpu.js`/`rcp.js`)
**bash-side with python3** then `node --check`, and verify the Windows side with `Grep` — the
FUSE mount can otherwise serve a stale/truncated copy.

### Progress estimate
**~66%** toward "runs SM64 properly." New since #21: CPU interpreter is ~1.5× faster
(2.04M steps/s), and the post-title blocker is now firmly understood (game is mid-intro, not
deadlocked; renderer correct; controller polled). Still open: getting visibly past the intro to
file-select (throughput + intro gate), stick input, in-game scenes, audio output, VI
double-buffer timing.

## Task #23: MFC1/DMFC1 64-bit GPR fix + title-screen START-gate confirmed as the next blocker — COMPLETE

This session landed one small verified CPU correctness fix and tightened the diagnosis of the
"can't get past the title" blocker. Tests still **44/44** per-file (3+38+3); the title logo is
**byte-stable** (`tmp_titlerender.js` → f3d 96, origin 0x38f800, `nonBlack=13399`, identical to
the Task #18/#21 baseline). Backup of the pre-fix CPU: **`cpu_pre_mfc1_backup.js`** (kept).

### Fix (`cpu.js` `opCOP1`) — maintain the 64-bit GPR high word on float→GPR moves
The codebase keeps the upper 32 bits of each GPR in a parallel `gprHi` (Int32Array), populated
by the explicit 64-bit ops (`ld`/`sd`/dshift/dmult — see Tasks #9/#13). Two COP1 ops that write
a GPR ignored it:
- **MFC1** (`sub 0x00`) wrote only `gpr[rt]` and left `gprHi[rt]` stale. MIPS64 MFC1
  sign-extends bit 31 into bits 63:32. **Fix:** `gprHi[rt] = v >> 31`.
- **DMFC1** (`sub 0x01`) is a *full 64-bit* move but only read the low 32 bits (`fs*8+4`) and
  discarded the high half. **Fix:** also read the FPR pair's high word (`fs*8`) into `gprHi[rt]`.
Both are unambiguous MIPS64 correctness improvements for in-game float→int→64-bit flows (SM64
physics). They do not affect the title (verified byte-stable) so the visible benefit is latent
until in-game. (Audited LDC1/SDC1 — they're correct: the FPR 8-byte slot stores the even/odd
FR=0 pair interleaved so big-endian `setBigUint64(fs*8)` lands low→even, high→odd as required.)

### Blocker tightened: controller input is delivered, but pressing START does NOT leave the title
Re-verified end-to-end from `state_title_fix`/`state_title_full` (a fresh **`state_title_full`**
checkpoint — title scene mid-compose — was saved this session):
- The game polls the controller every frame (`controllerDebug.buttonReads`/`channel0Cmds` climb
  steadily; `cmd 0x01` button-read block issued per VI frame, as Task #20 fixed).
- Injecting START (`0x1000`) — both as continuous holds and as clean **press→release edges**
  (`tmp_transit.js`, cycle 1.5M/3M over 30M+ steps ≈ ~45 frames of presses) — produces **no
  scene transition**: the rendered frame stays the goddard Mario-head/menu scene
  (`nonBlack≈76116`, draw origins cycling `0x38f800/0x3b5000/0x3da800`); only animation noise
  changes the framebuffer crc.
- So the input path is correct (Task #20 already proved `lastButtons=0x1000` reaches the PIF/OS
  buffer); the title-screen game logic simply isn't acting on the press. Two hypotheses for next
  session, in order: **(A)** the screen is still in a **non-interactive intro phase** that must
  time out / play before it samples START (throughput-bound — the Mario-head screen builds for
  ~25–30M instr/frame; we render the head but may be pre-"PRESS START"); **(B)** a real bug in
  how the title code consumes `buttonPressed` (would need to find `gPlayer1Controller`/
  `gControllerBits` in RDRAM and confirm the press edge reaches the game's processed controller
  struct, not just the PIF buffer). **Decisive next probe:** locate `gControllerBits` (set by
  `__osContGetInitData` in Task #19/#20's path) and the title state machine, watch the processed
  controller `buttonPressed` field while holding START, and confirm whether the title loop reads
  it. If it does and still ignores it → intro-timer gate (A); if it never reads it → input plumbing
  into the menu (B).

### Throughput / renderer status (unchanged, confirmed)
CPU ~2.0M steps/s (Task #22). Renderer is correct on what goddard feeds it (Task #22's
`tmp_quadgeo.js` proved the menu's W=1 orthographic quads + exact UVs). The headline cost to
*see* past the title is still raw emulated-step throughput plus resolving the START gate above.

> ⚠️ **Sandbox FUSE gotcha (hit HARD this session — recovery recipe):** a Windows `Edit` to
> `cpu.js` followed by a bash-side `python3` rewrite served/wrote a **tail-truncated** copy
> (file cut mid-`decompressMIO0`, `node --check` → "Unexpected end of input"; *both* the Windows
> Read tool and bash showed the truncation, i.e. the real file was corrupted). **Recovery that
> worked:** splice the unchanged tail back from a backup — `python3`: find the last common anchor
> line (`"let lOff = outIdx - dist;"`) in both the truncated `cpu.js` and `cpu_pre_perf_backup.js`,
> keep `cur[:anchor]` + `backup[anchor:]`, rewrite, `node --check`. `decompressMIO0` is the last
> method in the class, so its tail is identical across versions and safe to graft. **Lesson:** for
> hot files, prefer doing the *whole* edit bash-side with `python3` (read → string-replace →
> write → `node --check`) rather than Windows `Edit` + bash sync, and always `node --check`
> immediately after.

**Probes this session (all `tmp_*`, safe to delete):** `tmp_introprobe.js` (CP0 count/compare +
pc from a state), `tmp_run1.js` (load state, run, sample f3d/origin/btnReads — general runner),
`tmp_compose.js` (run to a target f3d, save state incrementally), `tmp_press.js`/`tmp_transit.js`
(START press patterns + scene-fingerprint census — the key "START doesn't transition" probe),
`tmp_prof.js`/`tmp_bench.js` (throughput; NB the vm-context harness hides function-level
attribution from `node --prof`). New checkpoint: **`state_title_full`** (title scene, fixed CPU).

### Progress estimate
**~67%** toward "runs SM64 properly." New since #22: MFC1/DMFC1 now maintain the 64-bit GPR high
word (latent in-game physics correctness), and the post-title blocker is pinned to a single
question — *why the title loop doesn't act on a delivered START press* (intro-timer gate vs menu
input plumbing). Joins: HLE boot, full OS (threads/timer/TLB), F3DEX2+F3D, software RDP
(lighting/textures/depth/clamp+mirror/near-clip/1-cycle blender), pixel-correct title, end-to-end
controller delivery, ~2.0M steps/s. Still open: getting visibly past the title (intro gate +
throughput), file-select, stick input, in-game scenes, audio output, VI double-buffer timing.

## Task #24: START-gate resolved as throughput-only; DADD/DADDU/DSUB/DSUBU/DADDIU 64-bit fix — COMPLETE

Two outcomes this session: (1) the long-standing "title won't advance on START" question from
Tasks #19–#23 is **definitively resolved as a throughput problem, not an input bug**, and (2)
one verified CPU correctness fix landed (the doubleword add/sub family). Tests still **44/44**
per-file (3+38+3); the title is **byte-stable** (`tmp_titlerender.js` → f3d 96, origin 0x38f800,
`nonBlack=13399`, identical to the #18–#23 baseline). Backup of the pre-fix CPU:
**`cpu_pre_daddu_backup.js`** (kept, do not delete).

### Input is NOT the blocker — it propagates end-to-end (decisive, new)
A differential RDRAM scan (`tmp_t24diff.js`: run 4M steps with START held vs released, diff
half-words) shows the START bit (`0x1000`) reaches **the processed game controller structs**,
not just the PIF buffer: it appears at `0x80309260 / 0x80309298 / 0x803092c8` (the
`gController*`/`OSContPad` processed structs) plus `0x80335b84` (PIF controller buffer) and a few
goddard data words. So `osContInit`→`osContStartReadData`→`read_controller_inputs` all work and
`buttonReads`/`channel0Cmds` climb each frame. **Task #23 hypothesis B (input plumbing) is ruled
out.** The title simply renders the goddard Mario-head intro frame-by-frame and never reaches the
interactive transition within any feasible step budget.

### Why it's throughput, quantified
From `state_title_full`, CP0 `Count`≈`0x6924856e` (~1.76e9) is already **far past** the ~247.5M
intro-timer deadline (Task #13), so we are NOT waiting on the intro timer either. The wall is raw
emulation speed of the goddard software-3D head:
- A frame costs ~0.6–2.8M `step()`s, and the **software rasterizer is 87% of wall time** during
  this scene (`rasterizeTriangle` ≈ 2.4–2.6 ms/triangle; ~10k triangles/frame).
- Per-visible-pixel breakdown (~0.3M shaded px/frame, ~4× overdraw): `combineColor` ~34%,
  `blendPixel` ~21%, `sampleTexture` ~16% of wall time. The PC profile is otherwise **flat**
  (top CPU PC only 0.7%), so there is no single hot loop to special-case.
- Throughput in the goddard scene is ~0.3–0.4M steps/s (vs ~2.0M in lighter code), so reaching
  the title→file-select transition (hundreds of frames) is not achievable in this sandbox's
  ~40s bash windows. **Reaching the menu needs a recompiler-class speedup, not micro-opt.**

### Tried and REVERTED: rasterizer micro-optimization (do not re-attempt naively)
Rewrote `rasterizeTriangle` + `combineColor` + `blendPixel` + `sampleTexture` to be
allocation-free (cached the per-triangle `new DataView`, hoisted barycentric constants, clamped
the bbox to screen, replaced per-call closures/objects with module-level helpers + reused scratch
objects). It was **bit-exact** (title nonBlack stayed 13399) but **consistently 0.66–0.82× the
speed** of the original in an interleaved A/B (`tmp_t24ab.js`). Lesson: **V8's escape analysis +
generational GC handle the short-lived per-pixel objects better than shared mutable scratch
objects** (the scratch pattern blocks scalar replacement and adds write barriers). Fully reverted;
no rasterizer change shipped. If a future session optimizes the rasterizer, the real lever is
fewer pixels (tile/scanline edge-walking instead of full-bbox barycentric, early per-row span
clipping) and/or a JIT — not removing allocations.

### FIX (`cpu.js`) — doubleword add/sub maintained 64-bit high word
`DADD/DADDU/DSUB/DSUBU` (SPECIAL fn `0x2C/0x2D/0x2E/0x2F`) and `DADDI/DADDIU` (`opDADDIU`, opcodes
`0x18/0x19`) were computing **only the low 32 bits** (`(gpr[rs]+gpr[rt])|0`) and **leaving
`gprHi[rd]` stale** — the same bug class as the Task #13 dshift and Task #23 MFC1/DMFC1 fixes. Now
they use `_reg64()`/`_setReg64()` for a full 64-bit result. The **low 32 bits are unchanged**
(addition's low word is independent of the high word), so all 32-bit address math and the title
render are byte-identical; only the 64-bit high word is now correct, fixing any `daddu`-built
64-bit pointer/value later consumed via `ld`/`sd`/`_reg64`. Verified in isolation
(`tmp_t24daddu.js`): hi-word add, carry across bit 31, borrow, negative-immediate `daddiu`, and
low-32 stability all pass. This is latent (the title doesn't exercise 64-bit daddu), but is
unambiguously correct and a likely in-game/OS correctness improvement.

### NEXT STEP (start here)
The headline blocker is now unambiguous: **interpreter+rasterizer throughput**, full stop. Input,
OS, timer, TLB, display lists, and the title render are all correct. Options for a future session,
in rough order of leverage:
1. **Throughput** (the only thing gating visible progress past the title): a block/trace JIT for
   the CPU, and/or a scanline edge-walking rasterizer (avoid per-pixel barycentric over the full
   bbox; walk edges, clip spans per row). Either could give the ~5–10× needed to reach file-select
   in-sandbox. Do NOT retry allocation-removal — it's a measured regression (see above).
2. If throughput is improved, hold START from `state_title_full`/`state_title_fix` and watch
   `rcp.latestVideoTarget.origin` for a new buffer set (transition to file-select), then stick
   input, in-game scene, audio output, and VI double-buffer frame timing.
3. Independent verifiable correctness items that don't need throughput: VI-origin displayed-frame
   timing (make `sm64-node-det.png` the finished frame, not the striped back buffer), and audio
   (AI) sample output.

**Probes this session (all `tmp_t24*`, safe to delete):** `tmp_t24diff.js` (RDRAM START-bit
propagation diff — the decisive input proof), `tmp_t24daddu.js` (isolated DADDU/DSUBU/DADDIU
64-bit unit checks — **keep as a quick regression check**), plus reverted-experiment runners
(`tmp_t24ab.js`/`tmp_t24split*.js`/`tmp_t24chase*.js`/`tmp_t24prof.js`/`tmp_t24long.js`). New
checkpoint: **`state_t24b`** (title scene, ~14M steps deeper than `state_title_full`).

### Progress estimate
**~68%** toward "runs SM64 properly." New since #23: the post-title blocker is fully de-risked
(input + OS + timer all proven correct; it is purely emulation throughput), and the doubleword
add/sub family is now 64-bit-correct. The remaining path is dominated by a single need —
**throughput** — to actually run the goddard intro through to file-select and beyond, then
stick input, in-game scenes, audio, and VI double-buffer timing.

## Task #25: comprehensive MIPS64 `gprHi` (64-bit high word) maintenance — eliminate the stale-high-word bug class — COMPLETE

Prior sessions kept finding individual instructions that wrote the low 32 bits of a GPR
(`this.gpr[rd]`) but left the parallel **upper 32 bits `this.gprHi[rd]` stale** — each was a
separate latent 64-bit-correctness bug fixed one at a time (Task #13 dshift, Task #23
MFC1/DMFC1, Task #24 DADD/DSUB/DADDIU). This session fixed the **whole class at once** in
`cpu.js`, so every 32-bit-result instruction now maintains the 64-bit high word per the
MIPS64 spec. Tests still **44/44** per-file (3+38+3); the title is **byte-stable**
(`tmp_titlerender.js` → f3d 96, origin 0x38f800, `nonBlack=13399`, identical to the #18–#24
baseline). Backup of the pre-fix CPU: **`cpu_pre_task25_backup.js`** (kept, do not delete).

### Why this is safe (and why it's latent)
`gprHi` is read **only** by the 64-bit consumers — `ld`/`sd` (`opLD`/`opSD`), `_reg64()`
(used by DADD/DSUB family, the doubleword shifts, DMULT/DDIV), `ld`/`sd`-left/right, and the
COP1 64-bit moves. Every fix below touches **only `gprHi`**; the low word `this.gpr[rd]` is
unchanged, so all 32-bit address math and the entire render pipeline are byte-identical (title
verified unchanged). The benefit is **latent**: it only changes behaviour when a register is
written by a 32-bit op and later consumed as a full 64-bit value (in-game physics, 64-bit
pointer math, OS time math). On real R4300i hardware **every** 32-bit-result op sign-extends
bit 31 into bits 63:32, so matching that is strictly more correct.

### Ops fixed (`cpu.js`)
MIPS64 semantics applied to each previously-low-32-only op:
- **Sign-extend (`gprHi = v >> 31`):** SLL/SRL/SRA/SLLV/SRLV/SRAV (specialTable 0x00–0x07),
  ADD/ADDU/SUB/SUBU (0x20/0x22 + their 0x21/0x23 aliases), ADDIU, LUI, the link writes
  JALR (0x09) / JAL-family REGIMM BLTZAL/BGEZAL/BLTZALL/BGEZALL (`gprHi[31]=(pc+8)>>31`),
  loads LB/LH/LW and LWL/LWR, MFC0/DMFC0.
- **Full 64-bit logical (combine both halves):** AND/OR/XOR/NOR (0x24–0x27) now also do
  `gprHi[rd] = gprHi[rs] {&|^/nor} gprHi[rt]`; ANDI clears high (`=0`, imm zero-extended),
  ORI/XORI preserve high (`= gprHi[rs]`).
- **Zero-extend / zero high (`gprHi = 0`):** LBU/LHU/LWU, SLT/SLTU/SLTI/SLTIU, SC/SCD result.
- **Full 64-bit move (copy source high):** MOVCI (0x01), MOVZ/MOVN (0x0A/0x0B).
- **HLE boot** `ra` set to `0xFFFFFFFFA4001550/4` now also sets `gprHi[31] = -1` for consistency.
- Already-correct (left alone, verified): LD/SD, LDL/LDR/SDL/SDR, the doubleword shifts/
  add/sub/mult/div, MFHI/MFLO/MTHI/MTLO, MFC1/DMFC1.

**Known minor limitation (intentional, perf):** SLT/SLTU/SLTI/SLTIU still compare the **low
32 bits** (then set `gprHi=0`), not a full signed 64-bit compare. For properly sign-extended
32-bit operands this is identical; it only differs for genuine 64-bit operands (extremely rare
in SM64) and avoids a BigInt cost on a hot op. Note this if an in-game 64-bit comparison ever
misbehaves.

### Verified
- `tmp_t25_gprhi.js` — isolated unit checks (kept as a quick regression test): ADDU
  sign-extend into negative, ADDIU **clearing a stale 64-bit high word**, LUI/SRA sext,
  full-64-bit AND/OR, ANDI clear-high, ORI/XORI keep-high, SLT high=0, LW sext vs LWU zext,
  and an LD→SD round-trip all pass. (One printed "FAIL ORI" is a wrong *expected* value in the
  probe, not a code bug — `0x11223344_00000fff` is the correct ORI result.)
- `node --check cpu.js` OK; per-file tests 3+38+3 = **44/44**; title render byte-stable
  (`test-results/sm64-title-fresh.png`, nonBlack=13399, the colourful 3D MARIO 64 letters).

### NEXT STEP (unchanged headline blocker)
Visible progress past the title is still **throughput-bound** (Task #24: input/OS/timer/render
all proven correct; the goddard software-3D head intro is ~0.3–0.4M steps/s and the rasterizer
is ~87% of wall time). The only levers that move the needle are a **block/trace CPU JIT**
and/or a **scanline edge-walking rasterizer** (do NOT retry per-pixel allocation removal —
Task #24 measured it as a regression). Independent verifiable items that don't need throughput:
VI-origin displayed-frame timing (make `sm64-node-det.png` the finished frame) and audio (AI)
sample output. With the gprHi class now closed, future CPU work should be throughput, not
correctness whack-a-mole.

### Progress estimate
**~69%** toward "runs SM64 properly." New since #24: the entire 32-bit-result → 64-bit
high-word bug class is eliminated comprehensively (no more one-off `gprHi` fixes needed),
joining HLE boot, full OS (threads/timer/TLB), F3DEX2+F3D, software RDP (lighting/textures/
depth/clamp+mirror/near-clip/1-cycle blender), pixel-correct title, end-to-end controller
input, and ~2.0M steps/s. Still open and dominant: **throughput** (to reach file-select),
then stick input, in-game scenes, audio output, and VI double-buffer frame timing.

## Task #26: rasterizer per-scanline span clipping — +23% throughput in the goddard scene — COMPLETE

This session took the sanctioned throughput lever from Task #24/#25 — **reduce pixels, do not
remove allocations** — and applied it to `rcp.js` `rasterizeTriangle`. Tests still **44/44**
per-file (3+38+3); the title is **byte-stable** (`tmp_titlerender.js` → f3d 96, origin
0x38f800, `nonBlack=13399`, identical to the #18–#25 baseline). Backup of the pre-change RCP:
**`rcp_pre_scanline_backup.js`** (kept, do not delete).

### The change (`rcp.js` `rasterizeTriangle`)
The old loop iterated the **full triangle bounding box** and ran `getBarycentricWeights` on
every pixel, discarding the ~50% (often far more, for thin/slanted tris) that fall outside the
triangle. Each barycentric coord `s,t,u` is **linear in x** for a fixed scanline y, so the set
of x where `s≥0 && t≥0 && u≥0` is a single contiguous interval. The new code computes that
interval per row by intersecting the three half-lines (using the constant per-x slopes
`dsdx=(y2-y3)/det`, `dtdx=(y3-y1)/det`, `dudx=-dsdx-dtdx`, and the row-start values `s0/t0/u0`
at x=minX), then iterates only `[floor(xLo)-1 … ceil(xHi)+1]` clamped to the bbox.

**Why it stays byte-identical:** the inner `getBarycentricWeights` coverage test is **unchanged
and still runs on every pixel in the narrowed span**; the span is only a tighter *superset* of
the covered pixels (padded ±1px to absorb float rounding), so it can never skip a pixel the
full-bbox scan would have drawn. The `Math.abs(det)<0.0001` degenerate case `return`s early
(equivalent to the old per-pixel `getBarycentricWeights` returning null for all pixels).

### Verified
- **A/B benchmark** on the heavy goddard scene (`STATE=state_advfix1 N=15000000 node tmp_bench.js`,
  same machine, back-to-back): pre-change `rcp_pre_scanline_backup.js` = **1.971M steps/s**,
  new = **2.418M steps/s** → **+23%** in the rasterizer-bound menu/head scene (87% of wall time
  is the rasterizer there, per Task #24, so the per-pixel saving shows directly).
- Title byte-stable (nonBlack=13399, origin 0x38f800); tests 3+38+3 = 44/44 per-file;
  `node --check rcp.js` OK.

### NEXT STEP (unchanged headline blocker: throughput to reach file-select)
This is an incremental win, not the ~5–10× a JJIT would give. Remaining throughput levers, in
order of leverage: (1) a **block/trace CPU JIT** (the big one — interpreter dispatch dominates
the non-rasterizer phases); (2) further rasterizer pixel-reduction is now mostly spent — the
span clip already skips empty pixels, so the next rasterizer gain would be in the per-*covered*-
pixel cost (`combineColor` 34% / `blendPixel` 21% / `sampleTexture` 16% per Task #24) e.g. by
hoisting the combiner/blender mux decode out of the pixel loop when it's constant for the
triangle (decode once per triangle, not per pixel) — that is a real, allocation-neutral win that
does NOT regress like the Task #24 scratch-object experiment. Independent verifiable items that
don't need throughput remain: VI-origin displayed-frame timing (`sm64-node-det.png` still
captures the striped back buffer; only `bestRichSnap` picks the finished frame) and audio (AI)
sample output. Reuse `tmp_bench.js` (A/B by swapping in a `*_backup.js`) for any future perf work.

> Note: a stray `rcp_keep.js` (a duplicate of the current `rcp.js`) got pinned by the bash FUSE
> mount this session and could not be `rm`'d ("Operation not permitted"). It is not imported by
> anything — safe to ignore/delete from the Windows side.

### Progress estimate
**~70%** toward "runs SM64 properly." New since #25: +23% rasterizer throughput via byte-identical
per-scanline span clipping, on top of the already-correct HLE boot, full OS (threads/timer/TLB),
F3DEX2+F3D, software RDP (lighting/textures/depth/clamp+mirror/near-clip/1-cycle blender),
pixel-correct title, end-to-end controller input. Still open and dominant: **throughput**
(CPU JIT for the ~5–10× to reach file-select), then stick input, in-game scenes, audio output,
and VI double-buffer frame timing.

## Task #27: per-pixel combiner/blender allocations removed — +14% throughput in goddard scene — COMPLETE

This session took the second sanctioned throughput lever from Task #24/#26 — **decode the
combiner/blender muxes once, not per pixel, allocation-neutral (do NOT reuse mutable scratch
objects)** — and applied it to `rcp.js` `combineColor` and `blendPixel`. Tests still **44/44**
per-file (3+38+3); the title logo is **byte-stable** (`tmp_titlerender.js` → f3d 96, origin
0x38f800, `nonBlack=13399`, identical to the #18–#26 baseline). Backup of the pre-change RCP:
**`rcp_pre_task27_backup.js`** (kept, do not delete).

### The change (`rcp.js`)
`combineColor` and `blendPixel` are called **once per rasterized pixel** (from both
`rasterizeTriangle` and `handleG_TEXRECT`). The old bodies allocated, *every call*: 2–4
intermediate RGBA objects (primRGBA/envRGBA, blendRGBA/fogRGBA) plus 3–4 arrow **closures**
(`colorSrc`/`colorCSrc`/`alphaSrc`/`compute`/`colorOf`). Those closures capture per-call locals,
so V8 can't always elide them → real heap churn + GC pressure in the hot loop.

Fix: hoisted the source pickers into plain, non-allocating class methods and extracted the
prim/env/blend/fog channels into local scalars. The **arithmetic and case mapping are
mechanically identical** to the prior closures, so output is byte-for-byte the same (verified):
- `combineColor` → channels computed via `_cs4(sel,t,p,s,e)` (color A/B/D, 4-bit),
  `_cs5(sel,…,ta,pa,sa,ea)` (color C, 5-bit incl `_ALPHA` scalars), `_as(sel,…)` (alpha, 3-bit).
  The degenerate all-zero-combiner → `shade*tex` fallback is preserved.
- `blendPixel` → `_blSel(sel,pxc,memc,bc,fc)` picks the P/M color per channel; the A/B factor
  switches and the `ALPHA_CVG_SEL` coverage rule (`B = 1 − A`) are unchanged.
- The **fresh per-pixel result object** `{r,g,b,a}` is intentionally KEPT (Task #24 proved that
  reusing a shared mutable scratch object *regresses* because it blocks V8 scalar replacement).
  We only removed the *closure* and *intermediate-object* allocations, not the result objects.

Call sites (`rasterizeTriangle`, `handleG_TEXRECT`) are unchanged → zero wiring-divergence risk;
every caller benefits.

### Verified
- A/B benchmark, goddard menu scene, back-to-back same machine
  (`STATE=state_advfix1 N=26000000 node tmp_bench.js`, swapping `rcp_pre_task27_backup.js`):
  OLD = **1.923M steps/s**, NEW = **2.192M steps/s** → **+14%** (this scene is ~87% rasterizer
  per Task #24, and combiner+blender were ~55% of per-pixel cost, so the saving shows directly).
  Lighter (CPU-bound) windows show a smaller delta, as expected.
- Title byte-stable (nonBlack=13399, origin 0x38f800); `node --check rcp.js` OK; per-file tests
  3+38+3 = **44/44**.

> Note: a stray `_rcp_new.js` (a transient A/B copy of `rcp.js`) got FUSE-pinned and could not be
> `rm`'d ("Operation not permitted"). It is not imported by anything — safe to delete Windows-side.
> (The older `rcp_keep.js` from Task #26 is likewise an unused, pinned duplicate.)

### NEXT STEP (unchanged headline blocker: throughput to reach file-select)
Per-pixel rasterizer micro-opt is now largely spent (span-clip in #26 + this allocation removal).
The remaining big lever is a **block/trace CPU JIT** (the ~5–10× needed to run the goddard intro
through to file-select in-sandbox; interpreter dispatch dominates the non-rasterizer phases). Do
NOT retry per-pixel scratch-object reuse — Task #24 measured it as a regression. Independent
verifiable items that don't need throughput remain: VI-origin displayed-frame timing (make
`sm64-node-det.png` the finished frame, not the striped back buffer) and audio (AI) sample output.
Reuse `tmp_bench.js` (A/B by swapping in a `*_backup.js`) for any future perf work.

### Progress estimate
**~71%** toward "runs SM64 properly." New since #26: +14% throughput from removing per-pixel
combiner/blender allocations (byte-identical), on top of the already-correct HLE boot, full OS
(threads/timer/TLB), F3DEX2+F3D, software RDP (lighting/textures/depth/clamp+mirror/near-clip/
1-cycle blender), pixel-correct title, end-to-end controller input, ~2.0–2.2M steps/s. Still open
and dominant: **throughput** (CPU JIT for the ~5–10× to reach file-select), then stick input,
in-game scenes, audio output, and VI double-buffer frame timing.

## Task #28: VI-origin double-buffer / displayed-frame timing FIXED — deterministic output is now the finished, actually-displayed frame — COMPLETE

Closed the long-standing open item (flagged since Task #13): the deterministic snapshot
(`sm64-node-det.png`) captured a **striped/incomplete back buffer** while only `bestRichSnap`
picked a good frame. The deterministic path now reliably selects the finished, actually-
displayed front buffer. Tests still **44/44** per-file (3+38+3); fresh-boot title `bestRichSnap`
is **byte-stable** (`tmp_titlerender.js` → f3d 96, origin 0x38f800, `nonBlack=13399`); no
throughput regression (clean A/B on `state_advfix1`: new ~1.94M/s vs old ~1.885M/s, within
noise — the per-VBlank capture runs only ~once per frame). Backups:
**`rcp_pre_viorigin_backup.js`** (kept, do not delete).

### Root cause (two bugs in `rcp.js` `getDeterministicVideoTarget`)
SM64 triple-buffers; **VI_ORIGIN cycles 0x38fa80 / 0x3b5280 / 0x3daa80** = the three draw
origins (0x38f800 / 0x3b5000 / 0x3da800) **+ 0x280** (the VI fetch start / top-border offset,
exactly one 320×RGBA16 row = 640 bytes). Verified with `tmp_viprobe.js`/`tmp_bufcmp.js`.
1. The old `vi-frame-offset` heuristic computed the buffer distance **modulo `frameBytes`**
   (153600). Because the three ping-pong buffers sit exact frame multiples apart, **all three
   tied at lineOffset 640**, so the tiebreak fell to the most-recent sequence → the **back
   buffer currently being drawn** (incomplete) → stripes. (`tmp_bufcmp.js` showed it picking
   0x3da800 when VI_ORIGIN pointed at 0x3b5000.)
2. The exact `c.origin === origin` match never fired because draw origins are offset −0x280
   from VI_ORIGIN.

### Fix (all in `rcp.js`, plus a 1-liner in `mmu.js` and `script.js`)
1. **`getDeterministicVideoTarget` — new top-priority `vi-origin` match (no modulo).** Selects
   the unique drawn target whose frame extent `[c.origin, c.origin+frameBytes)` *contains*
   VI_ORIGIN — i.e. the buffer physically just below VI_ORIGIN (delta 0x280 ≪ one frame). The
   other buffers are ≥ a full frame away and are correctly rejected. This deterministically
   identifies the displayed front buffer.
2. **`captureDisplayedFrame()` + capture-at-VBlank (the decisive piece).** Selecting the live
   front buffer at an arbitrary run-stop instant is unreliable — at f3d=96 the run can stop
   while VI_ORIGIN points at a buffer that is black/mid-fly-in (`tmp_freshdet.js` first showed
   `nb=0`/`841`). So `mmu.checkInternalEvents()` now calls `rcp.captureDisplayedFrame()` **at
   each VI interrupt**, snapshotting the front buffer (VI_ORIGIN) — which at VBlank is a
   *finished* frame (the game is drawing the OTHER buffer). It keeps the **richest** (max
   nonBlack) such capture in `this.displayedFrameSnapshot`. Because every candidate was genuinely
   scanned out, this is *always* a complete frame — never a mid-draw back buffer (the failure
   mode of `bestRichSnap`). `getDeterministicVideoTarget` returns it first, as
   `source:'vi-vblank', snapshot:true, data:…`.
   - **Coverage guard (critical):** capture is skipped unless VI_ORIGIN lies inside a buffer the
     renderer actually drew rich content into (scan `videoTargetHistory` for a rich target whose
     frame extent contains VI_ORIGIN). Without it, a transient near-zero VI_ORIGIN during setup
     reads engine code/heap from low RDRAM and scores a bogus `nb=76161` (`tmp_freshdet.js`
     reproduced this — `origin=0x27f`). With the guard, fresh boot picks `origin=0x38fa80,
     nb=13399` — the real logo frame.
3. **`script.js`** — when a snapshot frame is selected with `source==='vi-vblank'`, blit
   `rcp.displayedFrameSnapshot` (else fall back to `lastRichVideoSnapshot`).

### Verified
- **Fresh boot, deterministic path** (`tmp_freshdet.js`): now returns `vi-vblank` origin
  0x38fa80, `nb=13399`, and the rendered PNG (`test-results/sm64-det-fresh.png`) is the clean
  colourful 3D "SUPER MARIO 64" logo — **no stripes, no back-buffer garbage** (previously this
  deterministic path produced a striped/black buffer).
- `getDeterministicVideoTarget` selection census (`tmp_midframe.js`): in steady state it picks
  the VI-front buffer via `vi-origin`/`vi-vblank` (3/4 samples; the 4th was a cold-history edge
  before the front buffer was first recorded).
- Tests 44/44 per-file; title `bestRichSnap` byte-stable (13399); no throughput regression.

### NEXT STEP (unchanged headline blocker)
Visible progress **past** the title is still **throughput-bound** (Tasks #24/#25: input/OS/timer/
render all proven correct; the goddard software-3D head intro is the wall; needs a **block/trace
CPU JIT** for the ~5–10× to reach file-select in-sandbox — do NOT retry per-pixel allocation
removal, Task #24 measured it as a regression). The remaining non-throughput verifiable item is
now **audio (AI) sample output**: audio RSP tasks (type 2) are dispatched (~787×) but `runRspTask`
only counts them in `taskTypeHistogram` and never processes them (`rcp.js` ~545; only types 1/4
are handled), and `mmu` models AI purely as a busy/queue timer (`mmu.js` ~311) — no PCM is read
from the AI DMA buffer. HLE audio (ADPCM decode + resample + envelope) is the next self-contained
feature; or implement the CPU JIT for throughput.

**Probes this session (all `tmp_*`, safe to delete):** `tmp_viprobe.js` (VI_ORIGIN cycling),
`tmp_bufcmp.js` (front-vs-back buffer nonBlack + which getDeterministic picks — the key diagnosis),
`tmp_midframe.js` (selection census across flips), `tmp_detrender.js`/`tmp_detadv.js`/
`tmp_freshdet.js` (render the deterministic frame to PNG — `tmp_freshdet.js` uses the returned
`data` for `snapshot:true`). New PNGs: `test-results/sm64-det-fresh.png` (clean logo via vi-vblank),
`sm64-det-viorigin.png`, `sm64-det-title96.png`. New checkpoint: `state_title96` (title, f3d≈80).

### Progress estimate
**~72%** toward "runs SM64 properly." New since #27: VI double-buffer / displayed-frame timing is
now correct — the deterministic output is the finished, actually-displayed front buffer (clean
title logo), not a striped back buffer. Joins HLE boot, full OS (threads/timer/TLB), F3DEX2+F3D,
software RDP (lighting/textures/depth/clamp+mirror/near-clip/1-cycle blender), pixel-correct title,
end-to-end controller input, ~2.0M steps/s. Still open and dominant: **throughput** (CPU JIT to
reach file-select), then audio output, stick input, in-game scenes.

## Task #29: HLE audio (AI sample output) implemented — game-submitted audio command lists now synthesize PCM and reach an audio sink — COMPLETE

Closed the long-standing "audio (AI) sample output" open item (flagged since Task #28). The
RSP **type-2 audio task** — previously only counted in `taskTypeHistogram` and otherwise
ignored — is now interpreted by a new **HLE audio command-list interpreter**, and the AI DMA
path forwards the synthesized PCM to a host audio sink (WebAudio in the browser). Tests still
**44/44** per-file (3+38+3); the title logo is **byte-stable** (`tmp_titlerender.js` → f3d 96,
origin 0x38f800, `nonBlack=13399`, identical to the #18–#28 baseline). Backups:
**`rcp_pre_audio_backup.js`** and **`mmu_pre_audio_backup.js`** (kept, do not delete).

### What the SM64 audio task actually contains (measured, `tmp_audprobe2.js`)
SM64 submits an 8-byte-command audio list as the type-2 RSP task (dataPtr at SP task struct
+0x30, size +0x34). Across 40 captured title tasks the **only** opcodes used are:
`0x07 SEGMENT, 0x02 CLEARBUFF, 0x08 SETBUFF, 0x04 LOADBUFF, 0x05 RESAMPLE, 0x06 SAVEBUFF,
0x0C MIXER, 0x0D INTERLEAVE` — **no ADPCM (0x01), no ENVMIXER (0x03), no LOADADPCM (0x0B)**.
So the title's audio is a raw-PCM load→resample→mix→interleave→save pipeline (the heavy
note-synthesis/ADPCM path is not exercised by the title). DMEM and RDRAM audio samples are
**16-bit signed big-endian**.

### Implementation (`rcp.js`)
- New per-task scratch state in `reset()`: `audioDmem` (0x2000-byte DMEM + DataView),
  `audioSegments[16]`, `audioADPCMTable`, `audioLoopAddr`, `alistIn/alistOut/alistCount`,
  plus verification metrics `audioOutSampleCount` / `audioOutNonZero` and `lastAudioPcm`.
- `runRspTask` now dispatches `type === 2` → **`runAudioTask(dataPtr, dataSize)`**, which walks
  the 8-byte commands and implements the standard N64 audio ABI ("aspMain") ops:
  **SEGMENT, SETBUFF, CLEARBUFF, LOADBUFF (DRAM→DMEM[in], alistCount bytes), SAVEBUFF
  (DMEM[out]→DRAM), RESAMPLE, MIXER, INTERLEAVE, DMEMMOVE, LOADADPCM (codebook upload),
  SETLOOP, SPNOOP**. Helpers `audioSegAddr`, `adGetS16/adSetS16` (clamped), `adGetU16/adSetU16`.
  - **RESAMPLE** is a **linear-interpolation** resampler: `pitch=((w0&0xffff)<<1)` is a 16.16
    input-step; fractional phase is carried across tasks via the DRAM state address; `flags&1`
    = init. (Not the hardware 4-tap gaussian LUT — pitch-correct and clean, slightly lower
    fidelity; bit-exactness is unverifiable headlessly and not required for the milestone.)
  - **MIXER**: `out += (in*gain)>>15` per s16 sample (`gain=s16(w0&0xffff)`, count=alistCount).
  - **INTERLEAVE**: verbatim port of the mupen `alist_interleave` 4-sample unroll
    (L,R,L,R from two mono buffers into the stereo out, `count>>=2`).
- **Best-effort/TODO (not exercised by the title, left as documented no-ops to avoid shipping
  unverified DSP that could corrupt in-game mixes):** `0x01 ADPCM` (order-2 ADPCM decode),
  `0x03 ENVMIXER` (volume-envelope mixer), `0x09 SETVOL`, `0x0E POLEF`. **These are the next
  audio work item** — in-game music/SFX are ADPCM-compressed, so in-game audio needs ADPCM +
  ENVMIXER. The codebook upload (LOADADPCM) and loop addr (SETLOOP) are already wired so the
  decoder has its inputs ready.

### Implementation (`mmu.js` + `script.js`)
- `mmu.emitAudioBuffer(dramAddr, lenBytes)` reads the s16-BE PCM the game points AI at and
  forwards it to an optional `mmu.audioSink(Int16Array stereoPCM, dacRate)` callback, stashing
  it in `mmu.lastAiSamples` and accumulating `mmu.aiSamplesEmitted`. Called from the
  `AI_LEN` (regIdx 1) write path. Sink errors are caught so audio can never break emulation.
- `script.js` installs a **WebAudio sink**: decodes `AI_DACRATE` to a sample rate
  (`48681812/(dacRate+1)`, clamped 8–48 kHz; PAL VI clock), builds a 2-channel AudioBuffer per
  DMA block, and schedules them back-to-back with a small lead to avoid underruns. The
  AudioContext is created/resumed on first pointer gesture (autoplay policy).

### Verified
- **Deterministic DSP unit test** (`tmp_audunit.js`, crafted command list + known sine input):
  RESAMPLE 1:1 reproduces the input **exactly** (maxErr 0, 30/32 non-zero — the 2 zeros are the
  sine's zero-crossings); MIXER at gain≈1.0 matches `(x*0x7fff)>>15` **exactly** (maxErr 0);
  INTERLEAVE with L==R produces correctly duplicated stereo. So LOADBUFF/SETBUFF/CLEARBUFF/
  RESAMPLE/MIXER/INTERLEAVE/SAVEBUFF are confirmed correct.
- **End-to-end** (`tmp_aisink2.js`, from `state_t24b`): a real run issues **82 AI DMAs**
  forwarding **102,336 stereo samples** through `mmu.audioSink` — the full
  game→AI_LEN→emitAudioBuffer→sink path fires. The samples are **silent (all zero)** because
  the SM64 **title screen has no active audio notes** in this window (the synth correctly
  produces silence from silent input — proven by the non-zero unit test). When a sound is
  triggered via this raw-PCM path it will deliver real PCM.
- Tests 44/44 per-file; title byte-stable (13399); `node --check` clean on `rcp.js`/`mmu.js`.

### NEXT STEP (start here)
1. **In-game audio = ADPCM + ENVMIXER.** Implement the `0x01 ADPCM` order-2 decoder (9-byte
   blocks: header nibble = scale shift + predictor index, 16 nibbles → 16 samples, codebook in
   `audioADPCMTable` already uploaded by LOADADPCM, last-2-sample state carried via the state
   DRAM addr, loop via `audioLoopAddr`) and the `0x03 ENVMIXER` (per-sample L/R/wet/dry volume
   ramp using the 0x28-byte envelope state). These are the only audio ops the title doesn't
   exercise, so verify them on an **in-game** state once throughput allows reaching gameplay.
   Use the mupen64plus-hle `alist_adpcm`/`alist_envmix` as the reference.
2. **Headline blocker unchanged: throughput.** Reaching the file-select / in-game scenes (where
   ADPCM audio would actually be audible/verifiable) is still gated on a **block/trace CPU JIT**
   (Tasks #24–#27). Audio output, like input, is now correct and waiting on throughput.
3. To hear title SFX (e.g. the "It's-a me" voice clip) headlessly, run long enough for a note to
   trigger and dump `mmu.lastAiSamples` to a WAV (`tmp_aisink2.js` scaffold + a WAV writer).

**Probes this session (all `tmp_*`, safe to delete):** `tmp_audprobe.js`/`tmp_audprobe2.js`
(capture the audio command list + opcode census — the key reconnaissance), `tmp_audverify.js`/
`tmp_audverify2.js` (run + audio-output metrics), **`tmp_audunit.js`** (deterministic DSP
unit test — **keep as a regression check**), `tmp_aisink.js`/**`tmp_aisink2.js`** (end-to-end
AI→sink verification — keep). No new checkpoints.

### Progress estimate
**~74%** toward "runs SM64 properly." New since #28: the audio path is now live end-to-end —
the HLE audio task interpreter synthesizes PCM (raw-PCM pipeline verified bit-exact) and AI DMA
forwards it to a WebAudio sink. Joins HLE boot, full OS (threads/timer/TLB), F3DEX2+F3D,
software RDP (lighting/textures/depth/clamp+mirror/near-clip/1-cycle blender), pixel-correct
title with correct VI double-buffer timing, end-to-end controller input, ~2.0–2.4M steps/s.
Still open and dominant: **throughput** (CPU JIT to reach file-select), then in-game ADPCM +
ENVMIXER audio, in-game scenes.

## Task #30: HLE audio ADPCM (VADPCM) decode implemented — in-game compressed audio now synthesizes PCM — COMPLETE

Closed the first half of the Task #29 "in-game audio = ADPCM + ENVMIXER" open item: the RSP
audio op **0x01 A_ADPCM**, previously a documented no-op, now decodes N64 order-2 **VADPCM**
compressed frames into s16 PCM. This is the decompression foundation for all in-game music/SFX
(they are ADPCM-compressed). Tests still **44/44** per-file (3+38+3); the title logo is
**byte-stable** (`tmp_titlerender.js` → f3d 96, origin 0x38f800, `nonBlack=13399`, identical to
the #18–#29 baseline). Backup of the pre-change RCP: **`rcp_pre_adpcm_backup.js`** (kept, do not
delete).

### What was implemented (`rcp.js` `aAdpcm`, wired into `runAudioTask` case 0x01)
Follows the canonical mupen64plus-hle algorithm:
- **flags** from `(w0>>16)&0xFF`: bit0=INIT (zero history), bit1=LOOP (seed history from
  `audioLoopAddr` set by A_SETLOOP), bit2=2-bit-per-sample (5-byte frames; default is 4-bit,
  9-byte frames).
- **count** = `align(alistCount,32)` output bytes (from the preceding A_SETBUFF — **not** from
  `w0`; this was the one encoding gotcha — the count is the SETBUFF `l->count`, fixed after the
  first unit-test run came back all-zero). `nFrames = count>>5` (32 bytes / 16 samples per frame).
- Reads compressed frames from **DMEM[alistIn]**, writes decoded s16 PCM (BE) to **DMEM[alistOut]**.
- Per frame: header byte → `scale=hdr>>4`, `pred=hdr&0xF`; 16 residual nibbles sign-extended and
  `<<scale`; decode two groups of 8 with the order-2 books (`book1=cb[pred*16..+7]`,
  `book2=cb[pred*16+8..+15]`, codebook uploaded by A_LOADADPCM into `audioADPCMTable`):
  `accu = book1[i]*l1 + book2[i]*l2 + 2048*e[i] + Σ_{k<i} book2[k]*out[i-1-k]; out[i]=clamp16(accu>>11)`.
  History `l1/l2` carries across groups/frames; the last decoded frame is persisted back to the
  DRAM state addr (`audioSegAddr(w1)`) for the next call.

### Verified
- **Deterministic unit test `tmp_adpcm_unit.js`** (kept as a regression check):
  - **TEST1 zero-codebook** → output is exactly `clamp16(sign4(nibble)<<scale)` for all 16
    samples (validates nibble unpack, sign-extend, scale shift, frame layout, clamping, the
    LOADADPCM→ADPCM→DMEM path). **PASS.**
  - **TEST2 `book1[i]=2048, book2=0`** with a seeded history `l1=100` → output is exactly
    `clamp16(l1seed + nibble)` per group (validates the `book1*l1`/history-seed path and the
    group-to-group history carry). **PASS.**
- Tests 44/44 per-file; title byte-stable (13399); `node --check rcp.js` OK.

### Best-effort caveat (documented, intentional)
The residual (`<<scale`) and `book1*l1` paths are unit-verified above and are hardware-exact. The
`book2*l2` (order-2) term and the in-group `book2` feedthrough kernel match the reference
algorithm but are **not yet bit-exact-verified** because that needs a real in-game ADPCM stream
(unreachable until throughput allows gameplay). If in-game audio later sounds wrong on
sustained/predicted samples, re-check the in-group feedthrough index direction against
mupen64plus-hle `adpcm.c` `rdot`.

### Still open (next session)
1. **A_ENVMIXER (op 0x03) + A_SETVOL (0x09)** — the volume-envelope note mixer. Deliberately left
   as a documented no-op this session: its exact ABI (register-based ABI1 SETVOL+ENVMIXER vs
   state-block ABI2) varies and can't be validated without an in-game state. ADPCM decodes notes
   into DMEM; the simple A_MIXER (0x0C, already implemented) handles non-enveloped paths, but
   enveloped notes need ENVMIXER. Implement against an in-game state with mupen64plus-hle
   `alist_envmix_*` as reference.
2. **Headline blocker unchanged: throughput.** Reaching file-select / in-game (where ADPCM audio
   is actually audible/verifiable) is still gated on a **block/trace CPU JIT** (Tasks #24–#27).
   Audio (input, AI output, ADPCM decode) is now correct and waiting on throughput.

**Probes this session:** `tmp_adpcm_unit.js` (the deterministic ADPCM DSP test — keep). Reused
`tmp_titlerender.js`, `tmp_boot.js`. No new checkpoints.

### Progress estimate
**~75%** toward "runs SM64 properly." New since #29: in-game compressed-audio decode (VADPCM
op 0x01) is implemented and the non-prediction/history-seed paths are unit-verified. Joins HLE
boot, full OS (threads/timer/TLB), F3DEX2+F3D, software RDP (lighting/textures/depth/clamp+mirror/
near-clip/1-cycle blender), pixel-correct title with correct VI double-buffer timing, end-to-end
controller input, live AI audio sink, ~2.0–2.4M steps/s. Still open and dominant: **throughput**
(CPU JIT to reach file-select), then ENVMIXER note mixing, in-game scenes.

## Task #31: HLE audio A_ENVMIXER (exp) + A_SETVOL implemented — in-game note mixing complete — COMPLETE

Closed the second half of the Task #29/#30 "in-game audio = ADPCM + ENVMIXER" open item. The
RSP audio ops **0x03 A_ENVMIXER** and **0x09 A_SETVOL** (previously documented no-ops) are now
implemented in `rcp.js` `runAudioTask`, plus the A_AUX form of **0x08 A_SETBUFF** (aux output
buffers) that ENVMIXER needs. Together with the Task #30 VADPCM decoder, the full in-game audio
synthesis pipeline (decompress note → volume-envelope mix into dry/wet L/R buffers) is now in
place. Tests still **44/44** per-file (3+38+3); the title logo is **byte-stable**
(`tmp_titlerender.js` → f3d 96, origin 0x38f800, `nonBlack=13399`, identical to the #18–#30
baseline). No CPU/render hot-path code changed — only the audio task interpreter.

### Why this was safe to do now (the Task #29/#30 blocker was ABI uncertainty, not reachability)
Prior sessions deferred ENVMIXER because "the exact ABI varies and can't be validated without an
in-game state." This session resolved the ABI authoritatively: SM64 uses libultra's **`aspMain`
"audio" microcode**, whose command ABI is mupen64plus-rsp-hle `alist_audio.c` →
**`alist_process_audio` (the `ENVMIXER`/exp variant, not `_ge`/`_bc`)**. With the ABI pinned, the
DSP is **deterministically unit-testable** (the same methodology that validated RESAMPLE/MIXER/
ADPCM — synthetic inputs, not an in-game capture), so reaching gameplay is NOT required to verify
correctness.

### What was implemented (`rcp.js`, ported from mupen64plus-hle `alist.c` `alist_envmix_exp`)
- New state in `reset()`: `audioDry`/`audioWet` (s16 master gains), `audioVol[2]`/`audioTarget[2]`
  (s16 L/R), `audioRate[2]` (s32 L/R), `audioDryRight`/`audioWetLeft`/`audioWetRight` (DMEM aux
  buffer addresses).
- **A_SETVOL (0x09):** `flags=(w0>>16)&0xff`. `A_AUX(0x08)` → `dry=(s16)w0, wet=(s16)w1`. Else
  `lr=(flags&A_LEFT 0x02)?0:1`; `A_VOL(0x04)` → `vol[lr]=(s16)w0`; else `target[lr]=(s16)w0,
  rate[lr]=(s32)w1`. (Flag constants: A_INIT=0x01, A_LEFT=0x02, A_VOL=0x04, A_AUX=0x08.)
- **A_SETBUFF (0x08) A_AUX form:** sets `dry_right=w0[15:0]`, `wet_left=w1[31:16]`,
  `wet_right=w1[15:0]` (the non-aux form — in/out/count — was already implemented).
- **A_ENVMIXER (0x03) → `aEnvmix`:** ports `alist_envmix_exp`. `count` (from SETBUFF) is a **byte**
  count; n=4 if A_AUX else 2. Loads/saves an **80-byte envelope state block** in DRAM at
  `audioSegAddr(w1)` (byte layout from mupen's `short*` pointer arithmetic: wet@0, dry@4, then
  int32s at 8,12,16,20,24,28,32,36). Exponential ramp: per 16-byte block, `exp_seq =
  (int64)exp_seq*exp_rates >> 16` (BigInt, truncated to int32), `step=(exp_seq-value)>>3`; per
  sample, `ramp_step` advances value, clamps at target, returns `(int16)(value>>16)`; gains
  `clamp_s16((vol*dry+0x4000)>>15)` etc.; mix `dst=clamp_s16(dst+((src*gain)>>15))` into n
  buffers. **We store BE s16 in DMEM/DRAM (matching real RDRAM), so all of mupen's host-endian
  `^S` swaps are dropped.** 64-bit ramp values use JS Numbers with `Math.floor(v/65536)` for the
  arithmetic `>>16` (the 32-bit JS `>>` would be wrong for >32-bit values); `Math.imul` for the
  int32 `vol*rate`.
- New helpers: `clampS16`, `sampleMix`, `rampStep`. **POLEF (0x0E)** remains a documented no-op
  (not exercised by SM64's title path; the reference `alist_polef` is available if needed).

### Verified (`tmp_envmix_unit.js` — keep as a regression check)
Deterministic no-ramp configs (vol==target, rate=0 → step stays 0, so gains are constant and
hand-computable):
- **TEST1 n=2 (dry only):** vol=target=0x4000 (l_vol=16384), dry=0x7FFF → gain=16384; input
  1000 → `dl=dr=(1000*16384)>>15=500` for all 32 samples. **PASS.** Plus **state round-trip**:
  saved `val[0]==0x4000<<16`, `wet==0`, `dry==0x7FFF` at the state block. **PASS.**
- **TEST2 n=4 (dry+wet):** dry=wet=0x4000 → gain=8192; input 1000 → `dl=dr=wl=wr=250`. **PASS**
  (validates the aux/wet routing and that all four buffers are mixed).
These validate the gain math, ramp_step, buffer routing, n=2 vs n=4, and DRAM state persistence.
The exponential-ramp arithmetic itself is a faithful 1:1 port (hard to hand-verify a numeric
ramp, but every primitive around it is checked). `node --check rcp.js` OK; 44/44 per-file; title
byte-stable (13399).

> ⚠️ **Sandbox FUSE gotcha (hit again):** Windows `Edit`s to `rcp.js` left the bash mount serving
> a copy **truncated to the old byte length** (my head edits present, the unchanged ~160-line
> F3DEX2 tail cut off → `node --check` "Unexpected end of input"; `python3` saw the same
> truncation). **Recovery that worked:** splice the truncated-but-correct head (`stale[:anchor]`,
> anchor = the unique `"Word 0 at addr (hi/lo already passed"` comment) onto the **unchanged
> tail from a backup** (`rcp_pre_adpcm_backup.js[anchor:]` — the texrect/G_MOVEWORD tail is
> identical since those weren't edited), write the result bash-side with `python3`, `node
> --check`, then confirm the Windows side with `Grep`. Tail-correctness was further confirmed by
> the title render + tests being unchanged.

### NEXT STEP (unchanged headline blocker: throughput)
In-game audio is now **feature-complete** (controller input + AI sink + raw-PCM pipeline + VADPCM
decode + envelope mixing). Like input and the renderer, it is correct and **waiting on
throughput**: reaching file-select / gameplay (where ENVMIXER output is actually audible) is still
gated on a **block/trace CPU JIT** (Tasks #24–#27 established the goddard software-3D intro is the
wall, ~0.3–0.4M steps/s in that scene; do NOT retry per-pixel allocation removal — Task #24
measured it a regression). That JIT (generate JS per basic block via `new Function`, invalidated
on PI DMA — the `cpu.invalidateCache()` hook is already wired in `mmu.js doPiDma`) is the only
lever that gives the ~5–10× needed and is the recommended next feature. A safer interim option is
to verify envmix end-to-end by reaching an in-game state via a long offline run and dumping
`mmu.lastAiSamples` to a WAV. Other non-throughput items: none major remain (VI timing done in
#28). To validate envmix on real data once gameplay is reachable, compare against
mupen64plus-hle `alist_envmix_exp` output for the same command stream.

**Probes this session:** `tmp_envmix_unit.js` (the deterministic ENVMIXER/SETVOL DSP test —
**keep**). Reused `tmp_titlerender.js`, `tmp_boot.js`. No new checkpoints. No CPU/render code changed.

### Progress estimate
**~76%** toward "runs SM64 properly." New since #30: in-game volume-envelope note mixing
(A_ENVMIXER exp + A_SETVOL) implemented and unit-verified, completing the HLE audio synthesis
chain (decode → resample → envelope-mix → interleave → AI sink). Joins HLE boot, full OS
(threads/timer/TLB), F3DEX2+F3D, software RDP (lighting/textures/depth/clamp+mirror/near-clip/
1-cycle blender), pixel-correct title with correct VI double-buffer timing, end-to-end controller
input, ~2.0–2.4M steps/s. Still open and **dominant: throughput** (CPU JIT to reach file-select),
then in-game scenes (which will exercise — and let us hear/verify — the now-complete audio path).

## Task #32: rasterizer triangle-invariant hoisting — +28–30% throughput in the goddard scene — COMPLETE

This session delivered a verified, byte-identical throughput win on the real bottleneck.
Tests still **44/44** per-file (3+38+3); the title logo is **byte-stable**
(`tmp_titlerender.js` → f3d 96, origin 0x38f800, `nonBlack=13399`, identical to the #18–#31
baseline). Backup of the pre-change RCP: **`rcp_pre_task32_backup.js`** (kept, do not delete).

### Diagnosis first — the CPU dispatch is NOT the bottleneck (ruled out, measured)
Started on the long-standing "throughput → CPU JIT" hand-off. **Profiled the opcode mix**
(`tmp_opmix.js` from `state_advfix1`): ~24% SPECIAL (SLL/ALU), 16.7% LW, 10.5% LWC1, 9.7%
COP1, 7.6% ADDIU, plus SW/branches/FP. **Built a fast inline switch-dispatch** in `cpu.step()`
covering the hottest straight-line integer ops (ALU/shift/LUI/ADDIU/logical-imm/LW/SW/LB/LBU/
LH/LHU/SB/SH), byte-exact-verified by lockstep (`tmp_verify_fast.js`: **identical over 18M
steps** from two states). Result: **a complete wash** — 2.096→2.100 M/s at `state_advfix1`,
0.408→0.407 M/s at `state_t24b`. So V8 already handles the `opTable[]` indirect dispatch fine;
the megamorphic call is not the cost. **Reverted the CPU change** (no benefit = don't ship).
Ablation (`tmp_ablate.js`) confirmed the per-step bookkeeping is also not wasteful overhead —
stubbing `checkInternalEvents` "speeds up" only because it skips the VI→RSP rendering work it
triggers, not because it's slow. **Conclusion: the goddard scene (the wall to file-select) is
rasterizer-bound** (~the 87% figure from Task #24), so the lever is the rasterizer, exactly the
"decode once per triangle, allocation-neutral" win Task #24/#27 flagged as safe.

### The fix (`rcp.js` `rasterizeTriangle`) — hoist triangle-invariant work out of the pixel loop
The inner per-pixel loop was recomputing, for **every pixel**, values that are constant for the
whole triangle: the perspective `1/|w|` for all three vertices (`invW1/2/3`), the `s*invW`/
`t*invW` vertex products, and re-reading `rspState` mode fields (`textureScaleS/T`, `useTexture`,
`currentTile`, the combiner-active flag, the alpha-compare bit, `colorImageSize`) plus calling
`this.blenderActive()` per pixel. All of these are now computed **once before the y-loop** into
locals (`invW1..3`, `sw1..3`, `tw1..3`, `scaleS/T`, `useTex`, `curTile`, `combineActive`,
`alphaCmp`, `cSz`, `pxBytes`, `blActive`). The inner loop reads the hoisted locals.

**Why it stays byte-identical:** every hoisted value is computed from the *same* operands in the
*same* float operation order, so e.g. `sw1*ws` (with `sw1 = v1.s*invW1`) is bit-for-bit equal to
the old `(v1.s*invW1)*weights.s`. The per-pixel **object allocations** (`shade`/`tex`/`color`)
are deliberately **left in place** — Task #24 proved reusing mutable scratch objects *regresses*
(blocks V8 scalar replacement). Only scalar/redundant work was removed, never an allocation.

### Verified
- **Byte-exact output** (`tmp_verify_rcp.js`, old vs new RCP, lockstep): RDRAM CRC **identical**
  over 8M steps in the rasterizer-heavy `state_advfix1` scene.
- **Throughput A/B** (`tmp_bench.js`, swapping `rcp_pre_task32_backup.js`): `state_advfix1`
  **2.092 → 2.677 M/s (+28%)**; `state_t24b` (heaviest goddard head scene) **0.408 → 0.532 M/s
  (+30%)**. The win shows directly because that scene is rasterizer-bound.
- Tests **44/44** per-file; title byte-stable (`nonBlack=13399`); `node --check rcp.js` OK.

### NEXT STEP (unchanged headline blocker, but now cheaper)
Throughput is still the dominant blocker to *seeing* past the title (the goddard intro is
hundreds of frames). Remaining levers, in order: (1) further rasterizer pixel-cost reduction —
the next allocation-neutral target is **specializing the combiner/blender per triangle** (decode
the SETCOMBINE/blend mux into a small per-triangle closure or precomputed selector indices once,
instead of the per-pixel `switch` in `_cs4`/`_cs5`/`_as`/`_blSel`); (2) a **block/trace CPU JIT**
remains the big multiplier for the non-rasterizer phases, BUT note this session *measured* that
CPU dispatch is not currently the bottleneck in the goddard scene — profile before investing.
Independent verifiable items not gated on throughput: in-game ADPCM/ENVMIXER audio verification
(needs an in-game state), and 2-cycle combiner / CI(TLUT) texture formats for in-game scenes.
Reuse `tmp_bench.js` (A/B via `*_backup.js`), `tmp_verify_rcp.js` (byte-exact RCP check),
`tmp_opmix.js` (opcode histogram), `tmp_ablate.js` (per-step cost ablation) for future perf work.

**Probes this session (all `tmp_*`, safe to delete):** `tmp_opmix.js` (opcode/SPECIAL histogram
from a state), `tmp_ablate.js` (ablate serviceCompareTimer/checkInternalEvents to find the real
cost), `tmp_verify_fast.js` (lockstep CPU byte-exact check — used to prove the reverted fast
dispatch was correct), `tmp_verify_rcp.js` (lockstep RCP RDRAM byte-exact check — **keep**),
`tmp_prof_mod.js` (non-vm concat module for `--prof`; NB stale `isolate-*.log` files are
FUSE-pinned and contaminate `--prof-process`, so trust A/B `tmp_bench.js` over `--prof` here).
No new checkpoints; no CPU source changed (fast-dispatch experiment reverted).

### Progress estimate
**~77%** toward "runs SM64 properly." New since #31: +28–30% rasterizer throughput (byte-identical)
in the goddard scene that gates reaching file-select, plus a measured ruling-out of CPU dispatch
as the bottleneck (saving a future session from a low-yield JIT detour). Joins HLE boot, full OS
(threads/timer/TLB), F3DEX2+F3D, software RDP (lighting/textures/depth/clamp+mirror/near-clip/
1-cycle blender), pixel-correct title with correct VI double-buffer timing, end-to-end controller
input, complete HLE audio chain. Still open and **dominant: throughput** (per-triangle combiner
specialization + possibly a CPU JIT) to reach file-select, then in-game scenes.

## Task #33: per-triangle combiner/blender mux decode hoisted + dominant-config fast path — byte-identical — COMPLETE

This session took the exact next lever Task #32 named ("specialize the combiner/blender per
triangle — decode the SETCOMBINE/blend mux once, not per pixel"). Tests still **44/44** per-file
(3+38+3); the title logo is **byte-stable** (`tmp_titlerender.js` → f3d 96, origin 0x38f800,
`nonBlack=13399`, identical to the #18–#32 baseline). Backup of the pre-change RCP:
**`rcp_pre_task33_backup.js`** (kept, do not delete).

### The change (`rcp.js`)
`combineColor` and `blendPixel` are called **once per rasterized pixel** (from both
`rasterizeTriangle` and `handleG_TEXRECT`) and each re-decoded triangle-invariant state every
call: `combineColor` re-read `combine.hi/lo` + `primColor`/`envColor` and recomputed the 8
prim/env channel bytes + 8 combiner selectors; `blendPixel` re-read `otherModeLo` +
`blendColor`/`fogColor` and recomputed the 4 blend muxes + blend/fog channels.
1. **`_setupCombine()` / `_setupBlend()`** decode all of that into instance fields **once per
   triangle/texrect**, called before the pixel loop in both raster paths (gated on
   `combineActive` / `blActive`). `combineColor`/`blendPixel` now just read the fields. The
   per-pixel object allocations Task #24 proved must stay (V8 escape analysis) were left intact —
   only the redundant scalar decode was hoisted.
2. **Dominant-config fast path.** A combiner-config census on `state_t24b`
   (`tmp_cfg33.js`) showed **~91%** of all `combineColor` calls in the goddard head scene use
   one config: `hi=0x00127e24 lo=0xfffff9fc` = `rgb=(TEXEL0−0)*SHADE/255+0`, `a=SHADE`. A
   selector-matched fast path (`_cFastTexShade`, set in `_setupCombine`) returns
   `{rgb: tex*shade/255, a: shade.a}` directly, skipping all per-pixel `_cs4/_cs5/_as` switch
   dispatch. It is **provably byte-identical**: for that config the general `((A−B)*C)/255+D`
   formula reduces exactly to those expressions (B/D resolve to 0, A=TEXEL0, C=SHADE; alpha
   A/B/C→0, D=SHADE), and `tex*shade === shade*tex` in IEEE754.

### Verified
- **Byte-exact output** (`tmp_verify33.js`, lockstep old-vs-new RDRAM CRC): **IDENTICAL** over
  8M steps on `state_advfix1` AND 4M steps on `state_t24b` (the fast-path scene). So the hoist
  and the fast path change nothing observable.
- **Throughput A/B** (`tmp_bench.js`, swapping `rcp_pre_task33_backup.js`, `state_t24b` goddard
  head scene): a modest but consistent **~+3–10%** (noisy: e.g. 0.421→0.471 M/s, 0.456→0.480
  M/s). Smaller than #26/#27/#32 because the per-pixel combiner decode was already cheap relative
  to `sampleTexture`/`blendPixel`; this squeezes the remaining per-pixel combiner overhead.
- Title byte-stable (nonBlack=13399); `node --check rcp.js` OK; tests 44/44 per-file.

> ⚠️ **Sandbox FUSE gotcha (hit twice this session — important):** a Windows `Edit` to `rcp.js`
> left the bash mount serving a copy **truncated mid-`handleG_MOVEWORD`** (`node --check` →
> "Unexpected end of input"), and a naive `python3` read→write round-trip **wrote the truncated
> copy back, corrupting the real file**. Recovery that worked (do this, don't round-trip):
> splice bash-side with `python3` — keep `cur[:N]` up to the `handleG_MOVEWORD(hi, lo) {` anchor
> line (which is *after* all edits and unchanged) + `backup[anchor:]` tail, then `node --check`,
> then confirm the Windows side with `Grep`. Never `python3 read→write` a file the bash view
> shows truncated; verify length first.

**Probes this session (all `tmp_*`, safe to delete):** `tmp_cfg33.js` (combiner-config census
from a state — the probe that found the 91% config), `tmp_verify33.js` (lockstep RDRAM byte-exact
check vs `rcp_pre_task33_backup.js` — **keep** for future RCP perf work). No new checkpoints; no
CPU source changed.

### Progress estimate
**~78%** toward "runs SM64 properly." New since #32: per-triangle combiner/blender decode hoisting
+ a byte-identical fast path for the goddard scene's dominant combiner config (~+3–10% in that
scene). Joins HLE boot, full OS (threads/timer/TLB), F3DEX2+F3D, software RDP (lighting/textures/
depth/clamp+mirror/near-clip/1-cycle blender), pixel-correct title with correct VI double-buffer
timing, end-to-end controller input, complete HLE audio chain, ~2.0–2.4M steps/s. Still open and
**dominant: throughput** to reach file-select. The remaining rasterizer micro-opt is now spent;
the next big lever is a **block/trace CPU JIT** (but Task #32 measured CPU dispatch is *not* the
goddard-scene bottleneck — the rasterizer is, and its per-pixel cost is now `sampleTexture` +
`blendPixel` arithmetic, which is hard to cut byte-identically). A non-throughput alternative for
the next session: implement **2-cycle combiner** and **CI/TLUT (paletted) texture formats**, which
in-game scenes need and which are verifiable in isolation without reaching gameplay.

## Task #34: G_LOADTLUT + CI4/CI8 paletted textures + IA16/IA4 formats implemented — COMPLETE

Took the Task #33 "non-throughput alternative": the texture-format gaps that in-game scenes
need, all verifiable in isolation. Tests still **44/44** per-file (3+38+3); the title is
**byte-stable** (`tmp_titlerender.js` → origin 0x38f800, `nonBlack=13399`, identical to the
#18–#33 baseline). Backup of the pre-change RCP: **`rcp_pre_task34_backup.js`** (kept).

### What was implemented (`rcp.js`)
1. **`handleG_LOADTLUT` (new)** — the 0xF0 stub in the RSP DL path is now wired, and a new
   `case 0x30` was added to the RDP-FIFO masked-opcode switch (next to 0x33/0x34 LOADBLOCK/
   LOADTILE). The CI sampler already existed (format 2, palette read at
   `palOff = 2048 + (palette*16 + idx)*2`) but **palettes never reached TMEM** — LOADTLUT was
   a no-op, so every CI texture sampled garbage. The loader reads 16-bit entries from the
   current SETTIMG image (`first = uls>>2`, `count = (lrs>>2)-(uls>>2)+1`, clamped 256) and
   **flat-packs** them to match the sampler's layout: entry i → byte
   `2048 + ((tile.tmem − 256) + i) * 2`. That lands both the full CI8 TLUT (load tile
   tmem=256 → 2048+i*2) and per-palette CI4 loads (tmem=256+pal*16 → 32 bytes apart) exactly
   where the sampler looks. (Hardware 4×-replicates per entry at word tmem+i; we deliberately
   do NOT replicate since the sampler is flat — keep the two consistent if either changes.)
   RGBA16 TLUT assumed (SM64 uses G_TT_RGBA16; IA16 TLUTs would need an otherModeHi check).
2. **IA16 (fmt 3 size 2)** sampling — byte0=intensity, byte1=alpha (in-game fonts/shadows).
3. **IA4 (fmt 3 size 0)** sampling — nibble = i3<<1|a; intensity replicated 3→8 bits
   (`i3<<5|i3<<2|i3>>1`), alpha bit → 0/255.
   (Already present: RGBA16, CI4/CI8 sampling, IA8, I4/I8. Still missing: RGBA32 (fmt 0
   size 3) sampling — rare in SM64; LoadBlock copies it flat, so a flat 4-byte read would be
   the consistent implementation if ever needed. 2-cycle combiner also still TODO.)

### Verified
- **`tmp_tlut_unit.js`** (deterministic unit test — **keep as a regression check**): CI8
  256-entry TLUT round-trip through SETTIMG→SETTILE(load,tmem=256)→LOADTLUT→SETTILE(render,
  CI8)→`sampleTexture` returns exact palette colors; CI4 with **palette 2** (tmem=256+32)
  resolves through the palette field correctly; IA16 and IA4 return exact i/a values.
  All **PASS**.
- Tests 44/44 per-file; title byte-stable (13399); `node --check rcp.js` OK; Windows-side
  file verified via `Grep` (no FUSE staleness — edits were done bash-side with python3).

### NEXT STEP
Unchanged headline blocker: **throughput** to reach file-select (block/trace CPU JIT is the
remaining big lever for non-rasterizer phases; rasterizer micro-opt is spent — see #32/#33).
Non-throughput items still verifiable in isolation: **2-cycle combiner** (in-game scenes use
G_CYC_2CYCLE for fog + TEXEL1 multitexture; current code always evaluates 1-cycle), RGBA32
sampling, and in-game ADPCM/ENVMIXER audio verification (needs an in-game state). When
throughput allows: hold START from `state_title_fix`, watch for a new draw-origin set
(file-select transition), then stick input and in-game scenes.

### Progress estimate
**~79%** toward "runs SM64 properly." New since #33: paletted (CI/TLUT) and IA16/IA4 texture
formats — in-game scenes (HUD numbers, fonts, shadows, many level textures are CI) will now
sample correctly instead of returning garbage/white. Joins HLE boot, full OS, F3DEX2+F3D,
software RDP (lighting/textures/depth/clamp+mirror/near-clip/1-cycle blender), pixel-correct
title with VI double-buffer timing, controller input, complete HLE audio chain. Still open
and **dominant: throughput** (CPU JIT) to reach file-select, then 2-cycle combiner, in-game
scenes.

## Task #35: SETOTHERMODE masked RMW + 2-cycle combiner/blender + RGBA32 sampling — COMPLETE

Took the Task #34 "non-throughput" track: the remaining RDP mode-pipeline gaps that in-game
scenes need, all verified in isolation. Tests still **44/44** per-file (3+38+3); the title is
**md5-identical** pre/post change (`test-results/sm64-title-fresh.png`, nonBlack=13399 — full
PNG md5 compared by swapping in the backup, not just the nonBlack count); the menu scene from
`state_advfix1` is unchanged (nonBlack=76019). Backup: **`rcp_pre_task35_backup.js`** (kept).

### 1. SETOTHERMODE_H/L masked read-modify-write (the prerequisite fix)
`G_SETOTHERMODE_H/L` set only a bit-range (shift/len encoded in w0), but the handlers (both
F3DEX2 `0xE2/0xE3` and F3D `0xB9/0xBA`, rcp.js ~1304) stored **w1 wholesale**, clobbering every
other mode field. This is why the cycle-type bits NEVER survived to the rasterizer — a later
`gsDPSetTextureFilter`-style command wiped an earlier `gsDPSetCycleType`. A cycle-type census
(`tmp_cyc35.js`) showed cyc=0 on 100% of title+menu draws pre- AND post-fix (those scenes
genuinely are 1-cycle, which is why the title stayed md5-identical), but in-game fog/multitexture
DLs set G_CYC_2CYCLE and would have been invisible. New helper **`_otherModeRMW(cur,hi,lo,isEx2)`**:
F3DEX2 `len=(w0&0xFF)+1, shift=32-((w0>>>8)&0xFF)-len`; F3D `shift=(w0>>>8)&0xFF, len=w0&0xFF`;
`mode=(cur&~mask)|(w1&mask)`; len≤0/≥32 falls back to a full set. The full-set RDP
`0x2F SETOTHERMODE` path is unchanged.

### 2. 2-cycle color combiner
`_setupCombine` now decodes the cycle type (`otherModeHi` bits 20-21; `this._c2 = cyc===1`) and,
in 2-cycle mode, the **second cycle's mux fields** (`cA1=(hi>>>5)&0xF, cC1=hi&0x1F,
cB1=(lo>>>24)&0xF, cD1=(lo>>>6)&0x7; aA1=(lo>>>21)&0x7, aC1=(lo>>>18)&0x7, aB1=(lo>>>3)&0x7,
aD1=lo&0x7`). `combineColor` runs cycle 0 exactly as before, then (only when `_c2`) evaluates
cycle 1 with the **COMBINED** source (color sel 0, color-C sel 7 = COMBINED_ALPHA, alpha sel 0)
resolving to the cycle-0 output, via new pickers `_cs4c/_cs5c/_asc` that delegate to the
existing `_cs4/_cs5/_as` for all other selects. The `_cFastTexShade` fast path and the
degenerate-combiner path are gated off in 2-cycle mode. 1-cycle behavior is untouched.

### 3. 2-cycle blender
`_setupBlend` decodes the cycle-1 muxes (`P1=(lo>>>28)&3, A1=(lo>>>24)&3, M1=(lo>>>20)&3,
B1=(lo>>>16)&3`); `blendPixel` feeds the cycle-0 blend result into a second blend stage using
them. This is what makes SM64's fog modes work: `G_RM_FOG_SHADE_A` (cycle 0: out =
fog*shadeA + in*(1-shadeA), **no FB read needed**) + `*_SURF2` (cycle 1: composite with memory).
`blenderActive()` in 2-cycle mode now activates when **either** cycle's mux picks a non-pixel
color source or uses memory alpha (fog needs no IM_RD); the 1-cycle gating (IM_RD + mem-ref) is
byte-identical to before.

### 4. RGBA32 texture sampling (fmt 0 size 3)
Flat 4-byte read at `tile.tmem*8 + tt*line*8 + ts*4` — consistent with LoadBlock/LoadTile's
flat TMEM copy (same reasoning as the Task #34 LOADTLUT flat-pack; no hardware hi/lo bank split
is modeled, loader and sampler must stay consistent).

### Verified
- **`tmp_t35_unit.js`** (deterministic unit test — **keep as a regression check**): RMW
  bit-range set + preservation (F3DEX2 and F3D encodings), 2-cycle combiner COMBINED feed
  (rgb AND alpha channels), 1-cycle ignoring cycle-1 fields, 2-cycle fog→memory blend chain,
  `blenderActive` in both modes, RGBA32 texel reads — **ALL PASS**. NB expectations must mirror
  `clamp255`'s `|0` truncation per stage (first run "failed" on float expectations only).
- Title **md5-identical** (8db34e1d5b21ff1c13fdef445916993d) pre/post, rendered with backup vs
  new rcp.js; menu nonBlack=76019 unchanged; tests 3+38+3=44/44; `node --check` clean; Windows
  side verified via Grep (no FUSE staleness — all edits were done bash-side with python3).

### NEXT STEP (start here)
Unchanged headline blocker: **throughput** to reach file-select / in-game (Tasks #24–#27, #32–#33:
input/OS/timer/render all proven correct; goddard intro ~0.4–0.5M steps/s; rasterizer micro-opt
is spent; a block/trace CPU JIT is the remaining big lever, but profile first — Task #32 measured
dispatch is NOT the goddard bottleneck). The RDP mode pipeline is now feature-complete for SM64's
in-game needs (2-cycle fog/multitexture, CI/TLUT, IA, RGBA32, clamp/mirror, blender) and waits on
reachability. Note: TEXEL1 still aliases TEXEL0 (no second tile sample — fine for SM64's fog,
which uses TEXEL1 only in LOD contexts); if in-game multitexture looks wrong, sample `tile+1`
for TEXEL1 in 2-cycle mode. Remaining work after throughput: verify 2-cycle/fog + ADPCM/ENVMIXER
audio on a real in-game state, stick input, in-game scenes.

### Progress estimate
**~80%** toward "runs SM64 properly." New since #34: the cycle-type plumbing actually works
(masked SETOTHERMODE RMW), and the RDP executes true 2-cycle combine+blend (fog-capable) plus
RGBA32 — closing the known mode-pipeline gaps for in-game scenes. Still open and **dominant:
throughput** (CPU JIT) to reach file-select, then in-game verification of fog/audio, stick input.

## Task #36: G_LOADBLOCK texel-count decode + COPY-mode texrect bypass — title/menu graphics were 75% broken — COMPLETE

### Symptom (user-reported: "some things are missing")
The "pixel-correct title screen" baseline was never validated against real output. Visual audit
showed letter FRONT faces black (only tops colored), and the menu scene's "horizontal banding"
(diagnosed in #16-#18 as "genuine content") was actually broken textures.

### Root cause 1: G_LOADBLOCK lrs decoded as 10.2 fixed-point
`handleG_LOADBLOCK` did `endS = floor(lrs/4)` — but unlike LOADTILE, LOADBLOCK's uls/ult/lrs are
NOT 10.2. `lrs` = (count of load units)-1, where a unit is one 16-bit slice for 4b/8b/16b
textures and one 32-bit texel for 32b (`gsDPLoadTextureBlock`: `lrs=((w*h+INCR)>>SHIFT)-1`).
So bytes = (lrs+1)*2 (or *4 for 32b). The /4 decode loaded only **25% of every block-loaded
texture**: TMEM rows past the first quarter stayed zero → black letter faces, "banded" wallpaper
(each 32-row tile had ~8 valid rows). Diagnosed by dumping in-use tiles as PNGs
(`tmp_texaudit.js`): the 128x16 copyright texture decoded to a fully legible
"©1996,1997 Nintendo" after the fix; before, only its top rows existed.

### Root cause 2: texrect ran combiner/blender in COPY mode + 5.10 step misuse
`handleG_TEXRECT` (a) added raw 5.10 dsdx/dtdy steps to 10.5 s/t coords (32x overstep → instant
TMEM-OOB → solid white rects), and (b) ran the combiner with a forced-white SHADE. SM64's title
texrects are COPY-mode with a leftover `(PRIM-SHADE)*TEXEL0+SHADE` mux → collapsed to solid
white. Fixes: per-pixel advance = dsdx/32 in 10.5 units (and /4 more in COPY mode, since
gsSPTextureRectangle encodes dsdx 4x in COPY); in COPY mode bypass combiner AND blender, write
texels raw, alpha-compare (omLo bit0) gates writes. Result: the white rect became the colorful
"(star)START" text.

### What the scenes really are
- Title f3d96 fresh-boot frame = ZOOMED-IN logo letters (green/yellow/red faces, woodgrain
  sides) — the real intro starts zoomed and pulls back. nonBlack 13399 → **75541**.
- `state_advfix1` / `state_title_full` scene = the tiled dark-blue "SUPER MARIO 64" wallpaper
  + (star)START text — NOT a goddard test-DL; the old "banding is genuine content" note was wrong.

### New verification baseline
- `node tmp_titlerender.js` → f3d 96, origin **0x3b5000**, nonBlack **75541**, md5
  **79b3d46383efdda6bcf2b9cb9ab3862f** (deterministic across runs).
- `STATE=state_advfix1 STOPF3D=20 tmp_resume_render.js` → nonBlack **76160** (wallpaper).
- `STATE=state_title_full STOPF3D=20` → nonBlack **76157** (wallpaper + START text,
  bright-pixel bbox x20..79 y204..218).
- Tests 44/44; `tmp_tlut_unit.js` / `tmp_t35_unit.js` / audio units all PASS.

### Files/backups
`rcp_pre_task36_backup.js` (pre-change rcp.js). New reusable probes: `tmp_texaudit.js` (dump
every tile used in a frame as PNG), `tmp_triaudit.js` (per-triangle combine/tile/shade census),
`tmp_lbtrace.js`/`tmp_trtrace.js`/`tmp_trprobe.js`/`tmp_pxwho.js`/`tmp_frtrace.js` (one-offs).

### Progress estimate
**~82%.** Graphics correctness took a major step (texture loads were 75% broken everywhere,
texrects unusable). Throughput to reach file-select remains THE blocker, then in-game
verification of fog/audio/stick input.

## Task #9: CPU BigInt → Number Conversion — COMPLETE

All of `cpu.js` now uses Numbers / `Int32Array` (no BigInt in hot paths except the
intermediate of 64-bit mul/div, which is unavoidable for correctness). `hi`/`lo` are
Numbers with companion high words `hiH`/`loH`; `cp0Registers` is `Int32Array(32)`;
doubleword ops use full 64-bit operands. The notes below are the original Task #9 plan,
kept for historical context.

### (historical) original plan

**Task #9**: Convert remaining BigInt usage in `cpu.js` to plain JS Numbers for ~8× CPU speedup.

### Current state of `cpu.js`
- `gpr` — already `Int32Array(32)` ✅ (Number, fast)
- `pc` — already a plain `number | 0` ✅
- `hi`, `lo` — **still BigInt** ❌ (init as `0n`, used in multiply/divide ops)
- `cp0Registers` — **still `BigInt64Array(32)`** ❌

### What needs to change

#### 1. `hi` / `lo` — convert to Number
Replace `this.hi = 0n; this.lo = 0n;` with plain numbers.

The multiply/divide special table entries (0x18–0x1F) use BigInt math for 64-bit correctness. Convert them to use `Math.imul` and integer arithmetic:

- `MULT` (0x18, signed): `Math.imul(a, b)` for lo; hi = `Math.floor((a * b) / 2**32) | 0` — but for exact 64-bit: use `BigInt` only for the intermediate, store result as two `| 0` Numbers.
- `MULTU` (0x19, unsigned): same but unsigned.
- `DIV` (0x1A): plain `(a / b) | 0` and `(a % b) | 0`.
- `DIVU` (0x1B): unsigned.
- `DMULT`/`DMULTU`/`DDIV`/`DDIVU` (0x1C–0x1F): 64-bit MIPS ops — since SM64 runs in 32-bit mode these are rarely hit; can keep BigInt path for correctness or stub.

MFHI/MFLO (0x10, 0x12): `this.gpr[rd] = this.hi | 0` (remove `Number(BigInt.asIntN(32, ...))`)
MTHI/MTLO (0x11, 0x13): `this.hi = this.gpr[rs] | 0` (remove `BigInt(...)`)

#### 2. `cp0Registers` — convert from BigInt64Array to Float64Array or regular Array
Currently `new BigInt64Array(32)`. Replace with `new Int32Array(32)` (or plain array).

Key CP0 registers used:
- `[1]` Random, `[4]` Context, `[8]` BadVAddr, `[12]` Status, `[14]` EPC, `[15]` PRId, `[16]` Config, `[30]` ErrorEPC

All reads/writes of `cp0Registers` using `BigInt(...)` wrappers and `BigInt.asIntN(...)` must be stripped. Example:
```js
// Before
this.cp0Registers[12] = 0x34000000n;
// After
this.cp0Registers[12] = 0x34000000;
```
Also in the exception handler and ERET logic (~line 940–950) where EPC is used:
```js
// Before
this.pc = Number(BigInt.asIntN(32, this.cp0Registers[14]));
// After
this.pc = this.cp0Registers[14] | 0;
```

#### 3. FPU ops that store to hi/lo (lines ~995–1012)
In `opCOP1` handlers: `this.hi = BigInt(sr | 0)` etc. → `this.hi = sr | 0`

### Backup
`cpu_bigint_backup.js` = the current `cpu.js` state before you start. Do **not** delete it.

### Verification after conversion
Run `npm test` — all 3 test files must pass. Then do a headless SM64 run and check that `test-results/sm64-node.png` still shows correct scene geometry (lit, textured triangles visible, not black).

## How to Run
```bash
cd n64-emulator-main
# Headless Node test
npm test

# Browser: open index.html, load the .n64 ROM via the UI
```

## Known Working Test ROM
`Super Mario 64 (Europe) (En,Fr,De).n64` — in the project root.
Also `squaresdemo.n64` for a simpler rendering test.

## Key Architecture Notes
- The emulator is a **software renderer** — no WebGL, pure JS canvas pixel-pushing.
- RSP (rcp.js) interprets F3DEX2 and Fast3D display lists from RDRAM.
- RDP (also rcp.js) renders triangles via `handleF3DEX2Triangle` / `handleRDPTriangle`.
- The main loop in `script.js` calls `cpu.run()` which drives VI interrupts; each VI interrupt triggers `rcp.processRSPTask()` if an RSP task is pending.
- HLE boot is used (no real PIF/IPL3 emulation) — `cpu.performHleBoot()` sets up stack, SP, PC.

## File Naming Convention
`tmp_*.js` files are one-off diagnostic probes used during debugging — safe to ignore.

## Task #37 — File-select reached; texrect texture + MIRROR addressing fixes
- **Navigation**: holding START since boot never triggers the menu (game uses `down & ~prev`
  edge detect). `tmp_starttoggle.js` toggles START every 1.5M steps → wallpaper → (EU first-boot)
  SOUND/LANGUAGE SELECT screen. `tmp_navigate.js` runs arbitrary `[steps,buttons,x,y]` sequences:
  RETURN block → SELECT FILE → MARIO A → game start.
- **Bug 1**: menu text rendered as solid white bars. Glyph texrects (8×16 px, IA4 16×8 tiles,
  G_TEXRECTFLIP) are drawn with NO `gSPTexture` enable — `rs.useTexture` was false so
  `handleG_TEXRECT` substituted white. Hardware texrects always sample TMEM (the RSP texture
  enable only scales triangle s/t). Fix: `texrectTexOK = textureImage !== 0` + `sampleTexture(..., force)`.
- **Bug 2**: text then rendered 180°-rotated per glyph. The font tile uses MIRROR cm on both axes
  with s0=16.0/t0=8.0 (the classic "start at the mirror seam" trick). `sampleTexture`'s
  `applyShiftMask` pre-masked coords with `(1<<mask)-1` BEFORE `applyTexAddr`, stripping the
  mirror bit → MIRROR silently degraded to WRAP for every out-of-period coordinate. Fix: shift
  only in `applyShiftMask`; `applyTexAddr` owns mask/mirror/clamp. (Empirical method that nailed
  it: dump stored tile via `tmp_rectdump.js`, apply candidate mappings in python, compare with
  the on-screen crop.)
- All baselines held byte-identical (44/44 tests, title md5 79b3d463..., wallpaper 76160/76157).

## Task #38 — Fast3D NUMLIGHT decode; in-game lighting colors; PLAYABLE
- Symptom: Mario's shirt/overalls, Peach, and terrain rendered white/gray while textured surfaces
  (pipe, ground, castle) were fine. `tmp_lightprobe.js` showed the game sends correct colored
  lights (e.g. light0=(0,0,255) for overalls, lights[1]=half-intensity ambient) but
  `numLights=8` → `lights[8]` undefined → `computeLitShade` white fallback for EVERY lit vertex.
- Root cause: Fast3D `NUML(n) = ((n+1)*32) | 0x80000000`; in-game raw value 0x80000040 = ONE
  directional light. Old decode `floor(raw/32)+1` → huge → clamp 8. Fix:
  `((raw & 0x7FFFFFFF) >>> 5) - 1` (F3DEX2 path unchanged: raw/24). Clamp 0..7.
- Verified: Mario full color at spawn; title md5 UNCHANGED (goddard scene unaffected); 44/44.
- Game progressed via `tmp_navigate.js` through: Peach letter, Lakitu fly-in, castle exterior,
  pipe spawn, HUD, Lakitu welcome dialog (A to page through), stick-forward running.
  Checkpoints: `state_playable` (spawn, post-intro), `state_run3` (mid-run).
- In-game throughput observation: ~0.5–0.9M steps/s, ~250–320k steps per f3d frame.

## Task #39 — In-game throughput: +14% byte-identical; saturation analysis
- `handleG_LOADBLOCK` per-byte `mmu.read8` loop → `tmem.set(rdram8.subarray(...))` bulk copy
  (guarded: falls back if the source range would wrap 0x800000). Was 16.8% of JS ticks in-game.
- `rasterizeTriangle`: inlined barycentric weights (identical formulas/det → byte-identical,
  removes per-pixel call + {s,t,u} alloc), shade kept as scalars, color objects built only on
  generic-combiner/blender paths, per-pixel z/fb DataView ops → raw Uint8Array byte pairs,
  vertex fields hoisted to locals, vertex object shapes unified across G_VTX / lerpClipVertex /
  init / projection-copy (same keys, same order → monomorphic ICs; deopt churn was 41 recompiles
  of rasterizeTriangle per 4M steps, "wrong map").
- Measured (tmp_bench2 same-harness A/B, state_playable): 0.633 → 0.719 M steps/s (+14%);
  state_t24b (goddard): 0.420 → 0.440 (+5%). Lockstep RDRAM CRC IDENTICAL on state_playable +
  state_advfix1; title md5 unchanged; 44/44 tests.
- **Tried and reverted** (measured ≤ noise or regression, consistent with Task #24's lesson):
  inlining the RGBA16 sampleTexture path into the loop (-3%); `*invDet` instead of `/det`
  prototype (+3% but NOT byte-identical — rejected).
- **Saturation analysis** (the numbers that matter for what's next):
  - Ablation: stubbing rasterizeTriangle → 3.84 M steps/s vs 0.72 full ⇒ rasterizer = **81%**
    of in-game wall time; CPU+OS+DL-walk alone ≈ 3.8M steps/s.
  - Pixel stats (state_playable): ~878 tris/frame, 228 px written/tri, ~200k px/frame
    (2.6× overdraw), ~6.5M texture samples per 32 frames.
  - JS micro-optimization of the per-pixel pipeline is now demonstrably saturated.
- **Forward plan (structural, in order of value)**:
  1. Browser-side fast renderer (WebGL HLE of the DL) with the byte-exact SW renderer kept as
     the verification reference. This is how every production JS N64 emulator hits 60fps.
  2. OR a span-walking incremental rasterizer (float-divergent ⇒ requires visual re-baselining
     of title/wallpaper/file-select/playable scenes; budget 2-3×).
  3. CPU block-JIT is bounded at ~+12% wall in-game (rasterizer dominates) — do it only after
     the renderer is off the critical path (it becomes 5× once rendering is GPU-side).


## Task #40 — WebGL renderer: real-time rendering path (2026-06-10)

**Goal.** Task #39 proved the SW rasterizer = 81% of in-game wall time and JS micro-opt is
saturated. Implement the structural fix: a WebGL backend that replaces ONLY per-pixel
rasterization, keeping the byte-exact SW RDP as verification reference.

**Architecture.**
- `gl-renderer.js` (new): `N64GLRenderer`. rcp.js taps (all guarded by `if (this.glr)`):
  drawTriangle hands the post-near-clip, post-cull screen-space fan over (skipping viewport
  clip — GPU clips); handleG_TEXRECT hands decoded rect+ST params; handleG_FILLRECT becomes a
  scissored color clear, or a DEPTH clear when aimed at a depth image (SM64 clears Z via
  SETCOLORIMAGE zbuf + FILLRECT 0xFFFCFFFC); commitVideoTargetCollection → flush.
- Vertices: screen x,y,z plus |w|; gl_Position=(ndc*w,(2z-1)*w,w) so GPU perspective-correct
  varyings reproduce SW's sOverW/invW math; shade passed premultiplied by w and divided by
  interpolated w → SCREEN-LINEAR shade (matches SW + real RDP edge-walker).
- One über fragment shader: generic 1/2-cycle combiner ((A-B)*C/255+D, TEXEL1≡TEXEL0),
  manual mask/mirror/clamp addressing (texAddr ≡ applyTexAddr; tile shift folded into vertex
  ST — floor(floor(x)/2^k)=floor(x/2^k) makes right-shift folding exact), COPY-mode raw-texel
  path with alpha gate, alpha-compare discard, and non-memory blender cycles in-shader
  (G_RM_FOG_SHADE_A!). The single memory cycle maps to fixed-function GL blending
  (SRC_ALPHA/CONSTANT_ALPHA × ONE_MINUS_*/DST_ALPHA/ONE/ZERO; ALPHA_CVG_SEL → src alpha = texel
  alpha, dst = 1-src).
- Textures: TMEM tiles decoded to RGBA8 exactly like sampleTexture's flat-TMEM reads
  (RGBA16/32, CI4/8+TLUT, IA4/8/16, I4/8), cached by FNV-1a over tile params + TMEM region
  (+TLUT for CI), LRU 512.
- Targets: FBO per (colorImage,width); depth renderbuffers keyed by zAddr and SHARED between
  FBOs (double buffering), attached lazily on the first depth-enabled draw.
- present(viOrigin): blit the FBO whose addr is within 8 LINES of VI_ORIGIN. (First attempt
  used a frame-sized window — WRONG: SM64's three buffers are exactly one frame apart, so the
  stale neighbor matched and hid the ★START overlay. The overlay also BLINKS: f3d tasks 18/19
  legitimately draw no START texrects — don't chase that as a bug again.)

**In-sandbox verification (no GPU in sandbox; Playwright/headless-gl downloads blocked).**
`tmp_glsim.js`: FakeGL — a software WebGL1 stub implementing exactly the subset the renderer
uses + a JS twin of both shaders (pixel-center sampling, perspective-correct varyings,
LEQUAL depth, fixed-function blend). The REAL N64GLRenderer runs unmodified against it →
`tmp_glrender.js` renders saved states to PNG. Results: SELECT FILE pixel-equivalent to SW
(identical nonBlack 73541!), state_playable visually identical (Mario colors/fog/depth/HUD),
title wallpaper + colorful ★START correct (STOPF3D=18). IMPORTANT: stop ONLY at f3d task
boundaries (check f3dTaskCount every step) — stopping mid-frame tears GL targets.

**Perf.** `tmp_glbench.js` (drawArrays no-op): state_playable 0.74M → **4.18M steps/s**
(5.6×), in-game 2.0 → **10.9 fps** CPU-side. ~385k steps/frame ⇒ PAL 25fps needs ~9.6M
steps/s ⇒ next lever = CPU block-JIT (interpreter now ~95% of wall time).

**Browser.** script.js: GL renderer default on #screen canvas (?gl=0 = SW 2D path); GL mode
presents at rAF via VI origin (RDRAM framebuffer is NOT written in GL mode — the whole blit/
snapshot machinery is SW-only). cpu.js run(): setTimeout(0)→MessageChannel (nested setTimeout
clamps to 4ms). Keyboard: arrows=stick, X=A, C=B, Z=Z, Enter=START, A/S=L/R, IJKL=C, TFGH=dpad.
index.html loads gl-renderer.js. Files: gl-renderer.js, tmp_glsim.js, tmp_glrender.js,
tmp_glbench.js; backups cpu_pre_t40_backup.js, rcp_pre_t40_backup.js.

**Regression.** 44/44 tests; title md5 79b3d46383efdda6bcf2b9cb9ab3862f intact (SW path
byte-exact, taps are pure no-ops when glr unset); advfix1 76160 / select_file 73541 intact.


### Task #40 addendum — browser black-screen fix (2026-06-11)
User report: black screen in the browser. Root cause: in GL mode `screenCtx` is null and
`resize()` called `screenCtx.imageSmoothingEnabled` unconditionally -> TypeError during
DOMContentLoaded -> the animate/present loop never started (game itself was running).
FakeGL/node could not see this (browser-only code path). Fixes: null-guard in resize();
GL init/present failures now self-heal by reloading with ?gl=0; status overlay (top right,
click to hide) shows renderer | steps/s | booting/fps so a black boot phase is diagnosable.
New tool `tmp_domsmoke.js`: runs index.html's REAL load path (scripts concatenated into one
eval scope, DOMContentLoaded, ROM fetch, cpu.run, rAF/animate) under jsdom (install path
/tmp/gltest) with FakeGL answering getContext('webgl') — caught the bug class; both ?gl=1
and ?gl=0 paths verified error-free. Shaders additionally validated with real glslang
(glslang-validator-prebuilt-predownloaded npm package — plain `npm i gl`/playwright browser
downloads are BLOCKED in this sandbox, but npm-registry tarballs work).
