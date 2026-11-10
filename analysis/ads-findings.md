# Original ADS scheduler findings

This report was derived only from supplied `SCRANTIC.SCR`, its segment 10 machine code, other original segments where cited, and decoded original ADS chunks. No external implementation was consulted. Executable SHA-256: `7811b526b36bba2f08326d7a680f2f063190b4278e5a36393fde5a02080b0262`.

`tools/ads_dump.py` reads the instruction-size table directly from the original binary and generates `analysis/ads-listings/*.ADS.txt`. All ten ADS resources parse to their exact ends: 66 scenes and 2,622 instructions. Original resource scene IDs are identifiers, not zero-based indices; STAND has scenes 1–12 and 14–16.

## The important execution model

ADS is an event-driven rule program reevaluated every scheduler pass. Multiple TTM actors can run concurrently. A scene can start multiple actors, inspect their activity/completion, launch another ADS scene, and stop its own ADS rule evaluation while its already-launched TTM actors finish. An implementation that chooses one animation and plays it to its end cannot reproduce these scripts.

At `seg10:1acb–1e59`, each scheduler pass has three ordered phases:

1. Apply each ADS scene's mode to the TTM actors it references. Reset those actors if the ADS mode is 3.
2. Evaluate all active ADS scenes in stored order. Starts with mode 3/4 become mode 1. Evaluate from the scene beginning, or after opcode 0005 on subsequent passes if present, or from a saved WHILE continuation when one exists.
3. Visit TTM actors in linked-list rendering order; render eligible actors, advance their frame cursors, and update completion state. Clear one-pass completion state 4 to inactive state 0 only here, **after** ADS rules had the opportunity to observe it.

The shipped corpus has no 0005 opcode, so rules normally run from their first instruction on every pass.

```js
function schedulerPass(nowTick) {
  for (const ads of scenes) {
    const mode = ads.mode & ~8;
    for (const actor of ads.referencedActors) {
      if (mode === 3) resetActor(actor);
      else actor.groupMode = mode;
    }
  }
  for (const ads of scenes) {
    let mode = ads.mode;
    const first = !!(mode & 8);
    mode &= ~8;
    ads.mode = mode;
    let pc = first ? ads.start : ads.afterInitMarker;
    pc = ads.savedWhile ?? pc;
    if (mode === 3 || mode === 4) ads.mode = mode = 1;
    if (mode === 1 && pc != null) executeBlock(ads, pc);
  }
  for (const actor of renderOrder) renderAndAdvanceActor(actor, nowTick);
}
```

Modes: 0 inactive, 1 evaluate rules, 2 stop evaluating rules but allow actors to finish, 3 reset actors and start rules, 4 start rules without resetting actors, 5 freeze group progression, 6 suppress group rendering/progression; bit 8 is first-entry. External start routine `seg10:0874` uses mode 3. Initial scene modes are 8 at `seg10:064d–0664`.

`seg10:0766` answers whether a requested ADS scene is still busy: true if its mode with bit 8 removed is 1 or 4; otherwise true if any referenced actor has state other than 0/4 and actor `+0c` is zero. A stop-ADS instruction therefore does not immediately mean the visible scene is over. The outer program calls this busy query after every scheduler pass at `seg04:080b–081a`.

## Resource format and linking

ADS:RES is `u16 count`, then repeated `u16 resourceId; NUL-terminated filename`. ADS:TAG uses the same layout for scene captions. ADS:SCR is repeated `u16 sceneId; instructions...; u16 0xffff`. All numbers are little-endian. Only signed arguments such as repetition/time and -1 current-scene sentinel need signed conversion.

Loading an ADS resource loads every referenced TTM (`seg10:0079–02fa`). Every TTM scene marker becomes a shared actor descriptor keyed by `(resourceId, TTM sceneId)`; lookup is `seg10:0bf4`. The descriptor's `startFrame` is obtained from the TTM scene marker, not from ADS. The TTM resource loader creates descriptors at `seg11:042a`, called after finding original TTM opcode 1111 at `seg11:063b–064d`.

For each ADS scene, a prepass collects its unique referenced actors from its 2000/2005 commands (`seg10:040f–04fb`, the original opcode pair at DS:260a). This list is used for reset/group controls and busy/completion querying. It includes commands nested in conditions/random choices.

## Instruction sizes

`seg10:0303` advances one ADS instruction, using the 35-entry table at `seg10:0383` and its target table at `03c9`. Sizes are fixed, not encoded in the low opcode nibble (unlike TTM).

| Byte size | Opcodes |
|---|---|
| 10 | 2000, 2005 |
| 8 | 2010, 2015, 2020, 4000, 4010 |
| 6 | 1010,1020,1030,1040,1050,1060,1070; 1310,1320,1330,1340,1350,1360,1370 |
| 4 | f010,f200,f210,1080,1380,1390,13a0,13a1,13b0,13b1,13c0,13c1,3020 |
| 2 | Everything else, including f000,ffff,0001,0005,1420,1430,1500,1510,1520,3010,30ff |

Actual corpus opcodes and counts: `1070=1,1330=55,1350=500,1360=76,1370=30,1420=47,1430=30,1510=584,1520=1,2005=867,2010=111,3010=77,3020=17,30ff=77,4000=4,f010=67,f200=12,ffff=66`.

## Commands

Main opcode dispatcher: `seg10:1519`; 44-entry opcode table `1875`, branch targets `18cd`.

| Opcode | Arguments after opcode | Meaning and original handler |
|---|---|---|
| 2005 | resourceId, sceneId, signed playsOrTicks, weight | Start/resume TTM actor, retaining its cursor. `15a6 → 0db6`. |
| 2000 | same | Set current frame to initial frame, then start. `1591 → 0e2e → 0db6`. Not in corpus. |
| 2010 | resourceId, sceneId, weight | Set actor state 0, immediately stopping it. `15c8 → 0e9b`. |
| 2015 | resourceId, sceneId, weight | Set actor state 5, holding its current frame. `15d9 → 0e6e`. Not in corpus. |
| 2020 | resourceId, sceneId, weight | Full actor reset. `15ea → 0ec8 → 0b3e`. Not in corpus. |
| 4000 | resourceId, sceneId, weight | Move actor to tail of rendering order. `15fb → 0f8c`. |
| 4010 | resourceId, sceneId, weight | Move actor to head. `160c → 0ef2`. Not in corpus. |
| f010 | ADS sceneId (-1 means current) | Set named ADS mode 2. If self, terminate current interpreter execution immediately. `1669–16bf`. |
| f000 | none | Set current ADS mode 2 and terminate execution. `1645`. Not in corpus. |
| f200 | ADS sceneId | Set target mode to `(mode & 8) | 4`, starting without reset. `16c2–1707`. |
| f210 | ADS sceneId | Set target mode to `(mode & 8) | 3`, reset/start. `1709–1749`. Not in corpus. |
| 3010 | variable candidate list, terminated by 30ff | Execute one weighted choice. `1629 → 0cda`. |
| 3020 | weight | Weighted choice that does nothing. Not a block header. |
| 0001,0005 | none | Advance; 0005 also marks end of one-time initialization for future passes. |
| ffff | none | End current ADS scene's bytecode. Does **not** by itself stop its mode 1 reevaluation. |

The final argument called `weight` is ignored when an ordinary command is executed outside a random block. It is not delay, priority, or another repeat count.

Starting does not zero `starts`, frame-state flags, or the frame cursor. `2005` intentionally resumes where a timed/stopped actor was left. At natural end, the cursor has already been redirected to its start, allowing it to be played again. `2000` is the explicit rewind variant.

```js
function startActor(a, playsOrTicks, now) { // seg10:0db6
  if (!a) return;
  if (playsOrTicks === 0) a.state = 1;          // one complete play
  else if (playsOrTicks > 0) {
    a.state = 2;
    a.remainingRepeats = playsOrTicks - 1;     // total plays, not extra plays
  } else {
    a.state = 3;
    a.stopAt = now - playsOrTicks;             // loop until deadline
  }
  a.starts++;
}
```

## Conditions, nested blocks, and waiting

Expression evaluator `seg10:1223–14bc`; predicate table `14bd`, branch targets `14eb`.

| IF opcode | Predicate on actor `(resourceId, sceneId)` |
|---|---|
| 1310 | actor exists and state === 5 |
| 1320 | actor absent or state !== 5 |
| 1330 | actor absent or starts === 0 |
| 1340 | actor exists and starts !== 0 |
| 1350 | actor exists and state === 4 (completed on previous pass) |
| 1360 | actor absent or state is 0 or 4 |
| 1370 | actor exists and state is 1, 2, or 3 |

The branch tests are at `1351–13c7`. 1350 is an edge-like completion condition, not “has ever finished.” Multiple rules may observe a finished actor before rendering clears the state. A rule that starts the same actor changes its state immediately, affecting later rules in the same pass.

Conditions can be chained by **1420 = AND** and **1430 = OR**. AND binds more tightly than OR. The evaluator implements short-circuiting: true OR remembers a true group, false AND skips its remaining predicates. Code `13ed–14ae`. No parentheses appear in the format. Conditional bodies may themselves contain nested IF blocks.

* 1510 ends an IF body. 1500 is ELSE (not present in supplied ADS). `seg10:106b` skips nested IFs correctly, looking for matching ELSE/ENDIF. `seg10:1758` executes or skips the selected branch.
* 1010–1070 use the same actor predicates as 1310–1370 but are **WHILE across scheduler passes**. 1520 ends their body. When true, save the WHILE instruction as the ADS continuation, execute its body once, and end this pass's ADS execution. When false, clear continuation/count, skip to 1520, and continue after it. Handler `seg10:17a0–1861`.
* 1080 is a WHILE predicate comparing that ADS scene's iteration counter `<= argument` (`seg10:132f`); the counter increments before a true body and resets to zero when false. Unused in supplied ADS.
* 1380/1390 compare signed global DS:463c <=/>= argument. 13a0/a1 compare unsigned DS:4638/463a <= argument; 13b0/b1 >=; 13c0/c1 ==. Their domain meaning was not established and they are unused in supplied ADS.

There is exactly one shipped WHILE: ACTIVITY scene 7, SCR offsets `07fe–0804`. It waits while TTM `(4,5)` is running, then launches `(4,22)`. This requires preserving the continuation even though the enclosing IF (TTM `(4,10)` just finished) will no longer be true on subsequent passes.

## Random blocks

`seg10:0c8d` reads candidate weight: byte offset +8 for 2000/2005, +2 for 3020, +6 for other weighted commands. `seg10:0cda` scans until 30ff, sums weights, chooses `(random16 % total)+1`, subtracts weights in order until <=0, and executes exactly that one candidate through `1519`. Then it resumes **after 30ff**. If total is zero, no command executes.

```js
function weightedChoice(candidates, random16) {
  const total = candidates.reduce((n,c) => n + c.weight, 0);
  if (!total) return;
  let n = random16 % total + 1;
  for (const c of candidates) {
    n -= c.weight;
    if (n <= 0) {
      if (c.op !== 0x3020) executeCommand(c);
      return;
    }
  }
}
```

For example STAND scene 1 starts one of `(1,1)` weight2, `(1,2)` weight2 with three plays, `(1,53)` weight5, `(1,3)` weight2. A later random block stops actor `(1,53)` with weight1 or does nothing with weight5. The random block is reevaluated on eligible scheduler passes, so it creates an ongoing chance of exit.

## Actor state, frame scheduling, and completion

Actor descriptor offsets (original byte offsets):

| Offset | Meaning |
|---|---|
| +00,+02 | TTM resource ID and scene ID |
| +04 | initial frame index |
| +06 | pending requested frame index (-1 = ordinary increment) |
| +08 | current frame index |
| +0a | frame rendered this pass (-1 if none) |
| +0c | set if a TTM jump targets its own current frame; busy query excludes it |
| +0e | already rendered current frame flag |
| +29 | frame delay in global ticks |
| +2b | ADS group mode |
| +2d | count of actor start commands |
| +2f | actor state: 0 inactive,1 one-play,2 finite-repeat,3 timed-loop,4 just-finished,5 held |
| +31 | remaining extra plays |
| +33,+35 | 32-bit timed-loop deadline |
| +37,+39 | 32-bit next frame deadline |
| +3b | next actor in render order |

Actor reset `seg10:0b3e`: current=start; pending=-1; starts/state/count/delay/deadlines/renderedFlag/selfJumpFlag become zero; resets per-actor graphics state, clipping to full screen, and foreground/background palette indices to 15.

Rendering details `seg10:1c3c–1e16`:

* Group mode 6 skips actor rendering. Actor states 1/2/3/5 render via `seg11:074a(currentFrame)` after selecting its TTM resource via `seg11:03e2` and copying actor drawing state into globals.
* Group mode 5 holds progression; actor state 5 also holds progression except the original handler's end-marker path, which should be mirrored if implementing unused freeze operations.
* TTM interpreter reports completion in DS:4644, requested next frame in DS:4646, delay changes in DS:46e8. Before each frame, completion is reset to 0 and delay request to -1. TTM initializes requested-next itself.
* On delay change, set actor delay to the request and frame deadline to `now + delay`.
* On TTM completion, request its initial frame. Finite repetitions with remaining count >0 advance when due and decrement count. Timed loops advance to start while their deadline is active. Otherwise advance when due, mark state4, and zero frame delay.
* On a non-completed frame, store TTM's requested jump if not -1. A request equal to the current frame sets +0c. Advance if due unless actor state5.
* When a previously active timed actor reaches its absolute stop deadline, set state4 even if a TTM end marker has not been reached. This may leave its cursor in the middle of a TTM scene.
* Actor state4 becomes state0 during the following render pass if no ADS rule restarted it. This is why the rules see completion for one pass.

Exact frame advance helper `seg10:196e–19e6`:

```js
function advanceFrame(a, now) {
  if (a.delay !== 0) {
    if (a.frameDeadline > now) return false;
    a.frameDeadline = now + a.delay;
  }
  a.alreadyRendered = false;
  if (a.pendingFrame !== -1) {
    a.frame = a.pendingFrame;
    a.pendingFrame = -1;
  } else a.frame++;
  return true;
}
```

## Original clock units

DS:2e72/2e74 is incremented at `seg02:16ce–16dd`. Initialization `seg02:1516–1533` calls `seg09:076a(13)` and registers this callback with multiplier 4. `seg09:0781–0791` computes a base interval `floor(1000 / (13 * 18)) = 4` milliseconds; `seg09:083d–0843` multiplies it by 4. Thus original global ticks are nominally **16 ms, 62.5 Hz**, with catch-up callback execution at `seg09:0918–093b`. ADS `-180` means 180 ticks (approximately 2.88 seconds), not 180 milliseconds.

The scheduler and wall-clock tick are conceptually separate: scheduler passes render and decide whether enough ticks have elapsed. Browser reconstruction can update at a stable 16 ms logical tick while rendering at display refresh frequency, preserving these integer deadlines.

## ADS lifetime between outer catalog scenes

`seg04:0c88` caches the currently loaded ADS family. At `0c97–0ca9`, it calls the old-family unload routine `0d37` **only if the family ID changed**. At `0cf4–0d0b`, it loads a named ADS only if that family's handle is zero; otherwise `0d26` returns its existing handle. Full plan cleanup `seg04:0673` releases plan families.

After selecting the cached ADS handle (`seg04:07c0`), the outer program starts the requested sequence at `07ce` through `seg10:0874`. This routine calls `0805` with mode3, clears only that scene's saved WHILE pointer, and preserves first-entry bit8. It does not stop all ADS scenes or rebuild actors. During the next scheduler pass, `seg10:1b33–1b41` resets only the TTM actor list referenced by that requested scene.

Therefore consecutive catalog scenes in the same family must reuse their `AdsPlayer`, calling `select(sceneId)` to set its queried main scene and request mode3. Actors outside that scene's references, other ADS scene modes, and linked rendering order persist. Reconstructing a new player every catalog scene incorrectly discards those states even if shared bitmap resources are preserved. Changing family, or full plan cleanup, releases the player and shared TTM resource contexts.
