# Original SCRANTIC TTM interpreter findings

Source: only the supplied `SCRANTIC.SCR`, its extracted code/data segments, and original `RESOURCE.001` TT3 streams. No external implementation or `research/` contents were used. Addresses below are NE segment:offset, not file offsets. The executable SHA-256 is `7811b526b36bba2f08326d7a680f2f063190b4278e5a36393fde5a02080b0262`.

`tools/ttm_inspect.py` parses the decoded streams using the executable's rules. All **41 streams / 6,631 frame terminators / 30 distinct opcodes** parse to exact end without residual bytes. Full operands and file offsets are in `analysis/decoded/*.TTM.TT3.json`; counts and examples are in `analysis/ttm-opcodes.json`.

## Encoding and frame structure

- The main interpreter is `12:040c`; frame pointer lookup is `12:0429–0445`.
- Each opcode is a little-endian word. The low nibble is the number of following signed 16-bit words. Operand extraction is `12:0497–04ef`; dispatch is `12:0689–06a5` and the table at `12:12bd`.
- Low nibble `F` normally denotes a NUL-terminated byte string. Include NUL, then pad to an even byte boundary. `11:04a8–04d5` proves padding: an even string length before NUL gets a second padding byte; an odd length does not.
- Exceptions `AF1F/AF2F` have a count word followed by `count*2` coordinate words (four bytes per point), not a string (`12:04f8–052f`, `11:05d2–060b`). They do not occur in these assets.
- `0FF0` is a frame boundary, checked before operand reading at `12:0483`. It returns from the interpreter at `12:1212–1274`; it does not mean the whole animation ends. The scanner `11:04d6–06f9` builds a zero-based array of frame-start pointers by splitting on these boundaries.
- `1101`/`1111` labels only resolve when they are the **first instruction of a frame** (`12:13a9–141e`). `1111` also causes the scan to create a sequence descriptor using `(frameIndex, TTM resource ID, label)` at `11:063b–0650`; `1101` does not.
- The first frame is ordinarily resource/palette/background setup. Many later frames begin with `1111`, a named sequence entry, and contain an ending `0110` before `0FF0`.
- **Resource loading does not execute frame 0.** `10:0044` calls load/preindex routines `11:0177` and `11:04d6`; both only allocate/parse. ADS actors begin at their `1111` entry frames, which load their own bitmaps. Frame 0 is executable only if explicitly selected. The web initialization therefore indexes and allocates state without painting frame 0.

## All 30 opcodes actually present

`a,b,c,d` are operands in stored order. Source/target buffer numbers refer to the table below. `once` means the original skips the side effect when descriptor `+0x0e` is nonzero (redrawing the same frame).

| Opcode | Count | Original behavior | Evidence |
|---|---:|---|---|
| `0080` | 190 | Free selected bitmap slot; clear its pointer. Shared JOHNWALK bitmap is not freed. once. | `12:0806–084d` |
| `0110` | 528 | Set sequence-finished flag `DS:4644=1`; still execute remaining instructions in this frame. | `12:0f73` |
| `0FF0` | 6631 | Finish current frame. | `12:0483`, `12:1212` |
| `1021 a` | 1148 | Set requested frame delay to `a` timer ticks (`DS:46e8`). | `12:0e37` |
| `1051 a` | 456 | Select bitmap resource slot `descriptor+0x14=a`. | `12:075c` |
| `1061 a` | 41 | Select palette slot `descriptor+0x12=a`; make its palette current. | `12:0952–098f` |
| `1101 a` | 5 | Frame label (no execution effect). | `12:12e1`, `12:13a9` |
| `1111 a` | 611 | Frame label and sequence entry registration during pre-scan (no execution effect). | `11:063b–0650` |
| `1121 a` | 61 | Select saved-region slot `descriptor+0x16=a`. The only general saved-region operation present, `4214`, is a stub here. | `12:0853` |
| `1201 a` | 75 | Resolve label `a` and set requested next-frame index `DS:4646`. This is deferred until the scheduler advances; it is not an immediate jump in the instruction stream. | `12:0fc3–0fcc`, `10:1d84–1da3` |
| `2002 a,b` | 217 | Set outline/line color index to low byte of `a`, fill color index to low byte of `b`. Both persist in the sequence descriptor. | `12:06a9–06c2` |
| `2012 a,b` | 52 | On first execution sets `DS:46d8=1` for the next bitmap load. The called function `12:197c` is empty; the arguments themselves have no effect here. | `12:0f23–0f3d`, `12:197c–1989` |
| `2022 a,b` | 152 | once: set frame delay `a + abs(rand() % (b-a))`. The divide is unsigned; normal assets have positive increasing bounds. Upper bound is exclusive. | `12:0e08–0e31` |
| `4004 a,b,c,d` | 52 | Enable rectangular clipping; bounds are left=`a`, top=`b`, right=`c`, bottom=`d`, inclusive. Persist in descriptor. | `12:0f40–0f6d`; inclusive-to-exclusive GDI conversion `08:1b06–1b19` |
| `4204 a,b,c,d` | 38 | Commit the current working rectangle `(x,y,width,height)` to persistent background (copy buffer1 to buffer2), then queue its display. once. | `12:0e55–0eae`; copy `11:0b74–0bc6` |
| `4214 a,b,c,d` | 60 | **No-op in this Windows executable.** Checks first-execution flag then returns to dispatch. Do not invent capture semantics from the operands. | `12:0860–086a` |
| `A002 a,b` | 63 | Draw a pixel at `(a,b)` in current outline color. | `12:022c–0238`, `09:0d54` |
| `A054 a,b,c,d` | 1 | Capture current working-buffer rectangle `(x,y,width,height)` into saved-region slot **0**, storing its rectangle. once. Slot is hardcoded, not `1121` selected slot. | `12:1747–17fc`; capture source `07:01d9–0217` |
| `A064 a,b,c,d` | 1 | Restore saved-region slot **0** into working buffer1 at its stored coordinates and dimensions. once. Operands are bounds-checked before entry, but the restore uses the stored rectangle. | `12:1801–1856` |
| `A0A4 a,b,c,d` | 784 | Draw a line from `(a,b)` to `(c,d)` in outline color. | `12:0179`, `07:02ef–03d6` |
| `A104 a,b,c,d` | 111 | Filled rectangle `(x,y,width,height)`, outline color=`2002.a`, fill color=`2002.b`. | `12:01a9`, `08:1bd8–1cf9` |
| `A404 a,b,c,d` | 437 | Filled **circle**, not a general ellipse, in this executable. Radius=`d>>1`, center=`(a+radius,b+radius)`; operand `c` is ignored. | `12:01c4–01f5`, `09:0688–0769` |
| `A504 a,b,c,d` | 12546 | Draw bitmap slot `d`, frame `c`, at top-left `(a,b)`, normal orientation. Indexing is zero-based. | `12:025b–02cd` |
| `A524 a,b,c,d` | 2822 | Same sprite draw, horizontally mirrored. | `12:025b–02cd`, `08:0b65–0b97`, `08:0ce3–0cf7` |
| `A601 a` | 6814 | **No rendering body in this executable.** It still reaches dirty-rectangle logic using the saved-region rectangle for slot `a` if one exists. Since `4214` is empty, most such slots are empty here. | `12:02d8–02e2`, `12:1158–1192` |
| `B606 a,b,c,d,e,f` | 6 | Copy rectangle `(x,y,width,height)` at the same coordinates from buffer `e` to buffer `f`. once. All six occurrences are `e=2,f=1` (background restoration). | `12:0eb4–0ef6`; buffer mapping `12:14e0–150f` |
| `C051 a` | 535 | Play original embedded sound ID `a` once, if sound enabled, ID in 1..25, and resource exists. Async in-memory WinMM playback with flags 7. | `12:0063`, `05:00ba–0104` |
| `F01F "file"` | 40 | Load original SCR picture into current working buffer, **immediately copy the full working buffer to persistent background**, mark full redraw, reset relevant dirty regions. once. | `12:06c5–06d8`, `06:1813`, `07:16d8`, `11:0b31–0b6d`, `11:0b74–0bc6` |
| `F02F "file"` | 263 | Load sprite file into `1051` selected bitmap slot, replacing old allocation. Special JOHNWALK uses shared loaded bitmap. Consume/reset `2012` load flag. once. | `12:0769–0800` |
| `F05F "file"` | 41 | Load palette into `1061` selected palette slot and mark it current. once. | `12:0995–09eb` |

## Timing, sequencing, loops, and redraw

The original scheduler repeatedly renders the current frame, while side effects are guarded by `descriptor+0x0e`. Before each render it clears finish (`4644`) and sets requested delay (`46e8`) to -1 (`10:1cae–1cbd`). At first success it sets the guard to one (`10:1cd2–1cde`). After the deadline it resets that guard to zero and moves to the requested next frame or increments the frame index (`10:196e–19e6`). Rendering should therefore be separated from advancing and firing sounds/loading resources.

Requested delay `1021`/`2022` persists in descriptor `+0x29`. A new value updates deadline `+0x37/+0x39` to `currentTick+delay`; repeated unchanged values do not continually restart the deadline (`10:1ce6–1d17`). The advancing routine also sets the next deadline to `now+delay` when it advances. A zero delay permits advancement immediately. Sequence finish is handled by the ADS scheduler: it requests the sequence's start frame and either repeats, completes, or continues according to ADS playback mode (`10:1d1a–1d82`). There is no standalone TTM counted-loop opcode among the original assets. `1201` supports explicit cyclic frame links.

**Timer units are 16 ms.** Initialization calls `09:076a(13)` at `02:1516`, calculating integer `1000/(13*18)=4` ms (`09:0781–0791`). It registers `02:16ce` with multiplier 4 at `02:1522–1533`. Registration multiplies base by multiplier (`09:083d–0843`); callback increments `DS:2e72/2e74` (`02:16d8–16dd`). Thus a seven-tick delay is nominally 112 ms; a 120-tick pause is 1.92 s. Callback dispatch catches up elapsed timer intervals (`09:0918–093b`).

## Rendering and buffer semantics

| TTM number | Global HDC | Role inferred from original copy flows |
|---:|---|---|
| 0 | `DS:1eb4` | Display/front composition buffer |
| 1 | `DS:1eb2` | Working animation buffer |
| 2 | `DS:1eb0` | Persistent background buffer |

All are created as compatible memory DCs at `08:17e0–17f8`. `DS:1eb6` is active copy source; `DS:1eb8` is drawing/copy destination. Each TTM instruction resets both to buffer1 (`12:048e–0494`). `B606` temporarily changes them and uses opaque copy (`08:079e–07c6`). Copy rectangles expand horizontally to an eight-pixel boundary (`08:06ff–071a`), which can matter for faithful restoration edges.

Normal sprites/primitives are drawn to buffer1, then `11:0a85` queues damage copies for display and restoration. The third queue request at `11:0b0a–0b28` is from buffer2 back to buffer1; this explains how transient sprites disappear without a real `A601` restore operation. `4204` changes the persistent background by copying current buffer1 into buffer2 before this restoration. **`F01F` also commits the full working buffer to background immediately:** `12:06d8` jumps to `12:0e4a`, calls `11:0b31`, which calls `11:0b74` with `(0,0,screenWidth,screenHeight)` at `11:0b48–0b54`. The latter sets source to `1eb2` and destination to `1eb0`, then copies at `11:0b94–0bac`. This happens before any sprite commands following `F01F`. Next, `11:0b5c–0b68` clears the old background-to-working damage queue. The `0FF0` exit later queues the full image display update (`12:1212–1263`). This makes JOFFICE/SUZBEACH/THEEND persist across animation frames without explicit `4204`.

Sprite flags are `(opcode & 0x00f0)>>4`. Value 2 is horizontal flip; value 1 vertical flip. Normal draw `06:17d8` delegates to `08:0ae4`, which either selects precomputed mirrored bitmap/mask or falls back to negating destination width/height. Negative coordinates are supported. `A506/A516/A526/A536` are recognized but absent; they append requested output width and height and call `07:03d7`. `A5A7` is recognized but its render body exits without drawing (`12:0294–029f`). The existing sprite's alpha/mask is handled by original GDI composition, not palette-color guessing in this interpreter.

Palette updates are applied after rendering by `11:0799`, which realizes the selected palette then clears the pending pointer. Thus a web renderer can maintain indexed pixel assets and apply the palette consistently rather than recoloring individual sprites ad hoc.

## Other recognized instructions (not present in these 41 streams)

- `3003 x,y,label` recursively executes one labeled frame with draw-coordinate offsets (`12:0f7f–0fc0`). It preserves an already-set completion flag and suppresses a newly-set recursive completion flag. Offset excludes `A601/AF1F/AF2F`; `A0A4` offsets both endpoint pairs. Global ADS offsets at `DS:46e6/46e4` additionally shift `Axxx`, `4004`, and `4204` (`12:0569–0620`).
- `0010` fill-screen helper and `1011` setting helper call empty Windows stubs (`06:188e`, `06:18ae`); `1041` only stores their color variable.
- `0020` marks full redraw (`11:0b31`); `0070` frees selected palette; `0090` frees selected font; `00C0` frees selected saved-region slot; `00E0` unloads selected animation resource.
- `1031` stores descriptor `+0x1c`; `1071` selects font slot; `F04F` loads font.
- `F08F` loads an additional animation resource; `2032` configures it and `A704` draws it. These are unused here.
- `2302/2312/2322` configure three palette-cycle ranges; `2402 mask,speed` enables selected ranges, sign sets direction and absolute value sets period; `0400` stops cycling. `4114/4124` fade out/in; `4136` interpolates brightness over a timed range. None occur here.
- `A114` is outline rectangle; `A424` selects unfilled circle mode, but circle helper itself always installs a brush, so the mode flag's actual visual effect is uncertain. `AF02` and `AF1F/AF2F` ultimately call empty Windows primitive stubs.
- `0500/0510` set/clear a dirty-copy suppression flag; `B000/B013` initialize and advance a scrolling strip of all frames of the selected bitmap; none occur here.

## Limits and reconstruction cautions

- The above covers **all opcodes actually used** in the original assets. Some unused operations are summarized at call/field level rather than fully reconstructed; this is explicit, not assumed implementation behavior.
- Do not assign presumed DOS semantics to Windows stubs `4214`, `2012`, or `A601`. Their actual code is visible and tiny.
- The data includes original references to `FLAME.BMP` and `FLURRY.BMP`, absent from the extracted original archive. Missing-resource handling should retain that fact instead of manufacturing original sprites.
- The original engine supports 320x200 and 640x400 logical modes (`08:17b8–17da`), while much animation art uses a 640x350 stage. Confirm the surrounding application layout and background dimensions separately before fixing web canvas height.

### Invalid sprite indexes in original data

`12:027d–0288` multiplies the sprite index by two and reads that pointer directly. `12:028d–0291` skips a null pointer. There is **no clamp, wrap, or modulo**. The original bitmap loader allocates `(count+1)*2` pointer bytes at `07:1168–1175`; it writes an explicit terminating NULL pointer at index `count` at `07:1235–123d`. Therefore a sprite index exactly equal to count is a defined no-draw sentinel. Larger indexes read beyond the allocated array and have undefined behavior in the original heap, so a browser implementation should skip them and retain a diagnostic, not synthesize a replacement frame.

Observed data examples: `GJNAT1LI.BMP` has 19 frames and `GJNAT1.TTM` frame21 draws index19 immediately after loading it (the sentinel case). `SMDATE.TTM` frames173–175 refer to `SMDATE11.BMP` indexes31/30/31, although its original INF says24. `GJNAT1.TTM` frame162 refers to `GJNAT1.BMP` index27, although its original INF says26. Some additional diagnostics arise on replay of frames that draw using a slot and then replace that slot later in the same frame: `SJLEAVES.TTM` frame60 draws index17 from slot1, then replaces slot1 with the 14-frame `SLEVEJC2.BMP`. The original replay guard suppresses resource loading on the second render but not drawing. These cases are original data/runtime hazards, not evidence that valid indexes should wrap.

## Implemented web interpreter and validation

`web/dist/ttm.js` exports `createActor(resourceName,sceneId,assets)`, `initTtm(env,resourceName)`, and `interpretFrame(actor,env)`. Shared bitmap and saved-region state lives in `env.ttmResources`; per-actor selection, colors, and clipping live in `actor.graphicsContext`. The ADS scheduler owns frame advancement and `alreadyRendered`. The renderer returns `{valid,complete,done,nextFrame,delay}` and only executes resource loads, sounds, and irreversible frame effects on first rendering.

`node tools/ttm_verify.mjs` executes every one of the **6,631 original frames twice**, creates all **611 original sequence descriptors**, observes exactly **535 sound events** with no replay duplication, proves initialization does not paint frame 0, checks a deferred FIRE label loop, and verifies unknown opcodes raise an explicit diagnostic. Pixel-buffer regressions additionally execute the real `SJWORK`, `SJMSUZY`, `SUZYCITY`, and `THEEND` transitions, proving that their loaded SCR persists into background while subsequent sprites remain transient and repeated frame rendering does not reload the SCR. This validates command coverage and interpreter event behavior; final GDI raster-edge matching and whole-story composition require the integrated browser visual checks.

