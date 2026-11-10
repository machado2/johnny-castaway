# Original scheduler, walking and ambient rendering

Evidence is exclusively the supplied `SCRANTIC.SCR` bytes and extracted original
segments. No existing reimplementation, port, or research folder was read.
Addresses below are original 16-bit segment offsets, `DS` means segment 14.
`tools/story_extract.py` reproducibly emits `analysis/story-tables.json`.

## Scene catalogue

The catalogue is **80 records**, `DS:1756` through `DS:1C95`, stride 17, followed
by a zero group ID at `DS:1CA6`. The first record (group 200) is an inert dummy.
There are 79 usable entries, 65 ADS entries and 14 idle/walk entries.

| Offset | Type | Meaning |
|---|---|---|
| +0 | i16 | Group/category ID 200–215; multiple variants share an ID |
| +2 | i8 | Random selection weight |
| +3 | i8 | Required start location, 1–6; zero accepts current location |
| +4 | i8 | Required start direction, 0–7; `-1` would accept current direction |
| +5 | i8 | Resulting location; zero randomizes 1–6 after ADS completion |
| +6 | i8 | Resulting direction; zero randomizes 0–7 after ADS completion |
| +7 | i8 | Scene budget cost, used to fill a batch with initial budget 300 |
| +8 | i8 | Minimum time slot, inclusive |
| +9 | i8 | Maximum time slot, exclusive |
| +10 | i8 | Story day, zero for ordinary scenes, 1–11 for story |
| +11 | u32 | Behaviour/placement flags, mutable top two bits |
| +15 | i8 | ADS family ID; -1 means native idle/walk, -2 is custom ADS |
| +16 | i8 | ADS sequence number, one-based |

Confirmed by `seg04:06BF` playback, `seg04:08B9` construction, and
`seg04:0D76` weighted eligibility. `seg04:0EA1` finds the Nth record in a group.

ADS map at `DS:166E`, stride 17: i16 ID, 13-byte filename, u16 cached handle.
101 ACTIVITY, 102 BUILDING, 104 FISHING, 105 JOHNNY, 106 MARY, 107 MISCGAG,
108 STAND, 109 SUZY, 110 VISITOR, 111 WALKSTUF. Full filenames and addresses
are in the JSON. The custom entry -2 has a runtime-supplied filename.

## Batch construction and eligibility

`seg04:0540` clears the prior sequence, derives time/calendar state, resets
placement accumulators (`seg03:1C41(-1)`), updates story state, invokes
`seg04:08B9(slot,300)`, sets Johnny's initial location/direction from the first
record, and rebuilds the background.

`seg04:0D76(category,slot,budget)`:

1. Category 4 (ending) ignores budget and uses 999. Category 0x80 is the story
   attempt: returns zero unless `random()%10 == 0`, then copies max story day to
   current story day and uses budget 999.
2. Iterate all records, clearing flag `0x40000000` (temporary eligible marker).
3. For category 0x80, a matching `record.story_day == currentStoryDay` immediately
   qualifies. This intentionally bypasses time and placement eligibility.
4. Ordinary eligibility requires `flags & category`, sequence != 0,
   `min_slot <= slot < max_slot_exclusive`, story_day == 0,
   `floor(duration_budget/2) < remaining_budget`, and compatible placement flags.
5. Sum eligible weights, draw `random()%sum + 1`, subtract weights to choose.

`seg04:08B9` constructs an array of record pointers at `DS:30F4`:

- First tries story, rejecting the previous batch's ending and previous story
  record. A story record with flag 4 becomes the ending; otherwise reserve it.
- Chooses a flag-4 ending, excluding the previous ending and, when a story is
  reserved, endings with flag 1. Its cost is subtracted and placement accumulated.
- If ending also has flag 1, the batch consists only of this ending.
- If reserved story also has flag 1, it has a 50-percent attempt to be the first
  entry; otherwise choose flag-1 opening and subtract its budget cost.
- Fill middle using flag 2. Each loop has a 5-percent attempt to insert reserved
  story, otherwise choose an ordinary middle. Flag 8 permits repetition: sample
  1–6 copies using weights `[10,20,30,20,10,10]`, redraw if total cost is too big.
- Stop on zero/no eligible middle or 298 entries. Append ending and zero pointer.
- Set `0x80000000` on every chosen record as its not-yet-started marker.

The budget is an estimate, not a wall-clock cutoff. Selection admits an entry
whose half cost fits, so the remaining budget can go negative; the next choice
then fails eligibility. A faithful port should preserve this rather than assume
exactly 300 seconds of runtime.

Useful flags confirmed in original code:

| Flag | Meaning |
|---|---|
| 0x00000001 | May open a batch |
| 0x00000002 | May fill its middle |
| 0x00000004 | May end a batch |
| 0x00000008 | Repeatable middle |
| 0x00000010 | Disable holiday decoration |
| 0x00000200 | Require island variant zero |
| 0x00000400 | ADS origin x shifted by 272 pixels |
| 0x00000800 | Force night background |
| 0x00001000 | Disable ambient ocean/shore wave updates |
| 0x00002000 | Full screen scene; flat background and ADS origin (0,0) |
| 0x00004000 | Hide raft |
| 0x003F0000 | Island placement compatibility/constraint bits |
| 0x40000000 | Temporary eligible selection marker |
| 0x80000000 | Sequence has not started yet |

Placement compatibility is `seg04:0EDB`; placement accumulation is
`seg03:1C41`. Constraints accumulate across the full selected batch before its
background is rendered. Flags 0x20000/0x10000 constrain island quadrants;
0x100000 and 0x200000 force specific horizontal origins (below).

## Playback

`seg04:06BF` first restores/updates ambience. On a not-yet-started record it calls
`seg04:0B64(requiredLocation,requiredDirection)`. Until Johnny reaches that state,
it ticks native walking (`seg04:0094`) and does not start the ADS.

For ordinary ADS: load family `seg04:0C88`, select it `seg10:04FC`, start sequence
`seg10:0874`, clear started marker, set ADS origin `seg03:00FC`, then tick
`seg10:1ACB`. `seg10:0766(sequence)` reports whether it is still running. On
completion, install the record's end location/direction, restore start marker,
advance batch index. End location zero randomizes 1–6; end direction zero
randomizes 0–7. Exhausting batch invokes construction of a new batch.
The same ADS family remains loaded between catalogue entries: `seg04:0C97`
unloads only on a changed family ID. Therefore the implementation retains the
ADS player and TTM resource map, calls `select(sequence)` for the next entry,
and clears both on family change or batch rebuild. Unrelated actor states and
ordering persist within the loaded family; see `analysis/ads-findings.md`.

Native idle records (`ads_id == -1`) clear start marker, wait
`180 + random()%240` timer callbacks, and tick native walk/standing animation.
Afterward their fixed end location/direction is installed without randomization.

`seg02:16CE` decrements walk/idle/shore/wave counters. It is registered by
`seg02:1522` with interval 4, while `seg09:076A(13)` establishes base interval
`floor(1000/(13*18)) = 4` milliseconds. Thus the intended counter callback is
16 ms and the native walk frame cooldown of four callbacks is nominally 64 ms.
Actual legacy wall-clock timing is subject to the Win16 message loop.
The outer animation timer is set to **50 ms**, explicitly `0x32` at
`seg02:103E`, passed to `USER.#10` at `seg02:1046`. `WM_TIMER=0x113` dispatch
at `seg02:1266` catches up internal timers and invokes scene update through
`DS:2D91`. The modern host uses 55 ms to approximate the historical Windows 3.1
timer granularity; 55 is not an encoded constant in SCRANTIC.SCR.

## Calendar and story

`seg04:0540` rounds system minutes down to 00 or 30, then invokes
`seg04:0C48(HHMM) = (floor(HHMM/50) + floor((HHMM%100)/30) + 14) % 16`.
The active slot is `(16 + slot(now) - slot(configStartTime)) % 16`.
Default `DS:00BE` start time is 900. The 16 slots repeat every eight clock hours.
Slots 0–11 choose a day ocean; 12–15 choose NIGHT unless flags override.
Time is rechecked at batch construction, not every animation frame.

`DS:2D9B` is current story day, `DS:2D9C` max available story day.
`seg04:0BA5` compares stored calendar date (`DS:2D95/97/99`) with DOS date.
On a new calendar date, max day increments only if it is below current day;
values outside 2–11 reset both to 1. Completion of selected story advances the
current day through `seg04:0861` and `seg04:0C1A`, with additional state flags
`DS:30EE/30F0`. This is calendar persistence, not simply every N animations.

The story catalogue in exact order:

| Day | ADS | Sequence | Record |
|---|---|---|---|
| 1 | MARY.ADS | 2 | DS:17EF |
| 2 | JOHNNY.ADS | 2 | DS:1BDA |
| 3 | SUZY.ADS | 1 | DS:1BEB |
| 4 | MARY.ADS | 3 | DS:1800 |
| 5 | MARY.ADS | 1 | DS:1811 |
| 6 | JOHNNY.ADS | 3 | DS:1BFC |
| 7 | MARY.ADS | 4 | DS:1822 |
| 8 | MARY.ADS | 5 | DS:1833 |
| 9 | SUZY.ADS | 2 | DS:1C0D |
| 10 | JOHNNY.ADS | 6 | DS:1C1E |
| 11 | JOHNNY.ADS | 1 | DS:1C2F |

Holiday mode `DS:30BC`: Oct 29–31 = 1; Dec 23–25 = 2; Dec 29–31 and
Jan 1 = 3; Mar 15–17 = 4; all other dates zero (`seg04:05A9`).
`seg03:1E50` draws HOLIDAY.BMP frames/offsets respectively:
0 at (411,298), 2 at (405,267), 3 at (362,155), 1 at (334,286), plus origin.

## Native walking

`DS:30E4` current location (1–6), `DS:30E2` target location;
`DS:30E0` current direction (0–7), `DS:30CA` next required direction;
`DS:30DE` final target direction. `seg04:0094` executes a native path one
frame per cooldown. `seg04:03EA` selects the 34 path arrays by a code jump table
at `seg04:04FB`. All arrays are extracted exactly, not geometrically recreated.

Each frame is `(u16 bitmap_with_flip, i16 x, i16 y)`, terminated by all zeros.
Bit 0x8000 means horizontal flip; low 15 bits index JOHNWALK.BMP. Coordinates
are absolute in the original scene coordinate space, then island origin is added.
Per-path metadata at `DS:02DE + pathID*3` is `(start direction,end direction,
end location)`.

Location-to-location route pointer is
`u16(DS:0A94 + currentLocation*12 + desiredLocation*2)`, decoded by
`seg04:03AC`. Same-location entries are zero; 30 other entries point to weighted
routes. Each route has negative location markers, `(pathID,weight)` pairs, and
final `-7`. A fresh leg finds `-currentLocation`, draws `random()%100`, subtracts
weights until <=0 (the boundary differs slightly from the scene selector).

Turning moves a single direction step modulo 8 toward the desired direction;
an exact 180-degree difference chooses either sign randomly. Standing tables
are `DS:0347`, turning tables `DS:034E`, each indexed by location. Each table
selects a path containing eight direction-specific frames. `direction*6` selects
the appropriate frame. All are exported in JSON.

## Background and island coordinates

`seg03:0136` loads BACKGRND.BMP and MRAFT.BMP, chooses an ocean screen, computes
island origin through `seg03:1B00`, and composes static sprites. Ocean screen
filenames are in `DS:0262`: OCEAN00.SCR, OCEAN01.SCR, OCEAN02.SCR.

Normal variant 0: choose island reference x=67+random()%226,
y=255+random()%129. Variant 1: x=168+random()%111, y=255+random()%59.
Further constraints split these ranges into halves (`seg03:1B7F`). Constraint
bit2 forces reference (289,299); bit1 forces reference (17,309).
Subtract `(289,279)` from the final reference to obtain `(originX,originY)`.
Variant is randomly 0/1 unless batch flags force zero.

Render BACKGRND.BMP in this order (add origin to all coordinates):

| Frame | x | y | Condition |
|---|---:|---:|---|
| 0 | 289 | 279 | Always |
| 1 | 250 | 303 | Variant 1 |
| 2 | 151 | 328 | Variant 1 |
| shore animations | see next section | | After base island |
| 14 | 397 | 279 | Always |
| 13 | 443 | 148 | Always |
| 12 | 366 | 122 | Always |

ADS drawing origin `seg03:00FC` is `(originX+1,originY)`, or
`(originX+273,originY)` for record flag0x400, or `(0,0)` for fullscreen mode.
Raft frame = clamp(maxStoryDay-1,1,5)-1 in MRAFT.BMP, at (513,266) variant0
or (530,281) variant1 plus origin; hidden for flag0x4000 (`seg03:1D69`).

## Shore, ocean particles and clouds

Shore waves `seg03:0E74` use three phase counters `DS:0282/84/86` starting
at 2,2,2. Every four clock callbacks: if A==C increment A, else if B!=A
increment B, else increment C; wrap each >2 to zero. Render original BMP frames:

| Variant | Frame base + phase | x | y | Phase |
|---|---|---:|---:|---|
| 0 | 3 | 271 | 306 | A |
| 0 | 6 | 365 | 319 | B |
| 0 | 9 | 519 | 303 | C |
| 1 | 30 | 234 | 323 | A |
| 1 | 33 | 368 | 356 | B |
| 1 | 36 | 559 | 323 | C |
| 1 | 39 | 130 | 340 | A |

Ocean particles are `seg03:0463/04A2`: 30 slots, four types, separate limits
30/4/2/1. Spawn check 35 percent plus performance metric >100. Type choice
weights 35/5/5/5 (remaining probability means no particle). One type is a
two-pixel white sparkle drawn as a line; three types animate original
BACKGRND frames from `DS:0268/0270/0278` (exported). Shared wind direction
`DS:0280` moves x by +/-1 every ten timer callbacks, and frame delays vary.
Exact clipping/dirty-region rendering remains in `seg03:06D8–0A27`.

Clouds `seg03:0A38/0B67` are BACKGRND frames 15,16,17, limits 8,4,2, across
15 slots. Initial occupancy attempt is 30 percent, size probabilities 15/10/5
percent (code call argument order yields large 5,medium10,small15). Initial
position fits within x=0..640 and y=1..140 using `seg03:14BF`, subtracting sprite
dimensions. Wind direction is randomly +/-1. Each cloud moves one x pixel
after a randomly chosen delay 6–10 update calls. At respawn, size weights are
small50/medium30/large20; clouds enter from an off-screen region of width1000.
Rightward clouds are horizontally flipped (`seg03:0DDD`).
`seg03:1551` repairs the static island and palm foreground clipped to the bounds
of an ambient sprite. Native JOHNWALK drawings call the same routine with the
ambient flag clear: if their bottom is above originY+293, only the palm trunk
is repaired (`seg03:198E`). These repairs are implemented in the director.

## Random generator

`seg04:1E86`: 56 u16 values at `DS:1CE6`; starting indices `DS:1CE2=24`,
`DS:1CE4=55`. Each call adds state[indexA] to state[indexB] modulo65536,
returns the sum, increments both indices modulo56. Initial values are exported.
`seg04:1EDC` advances N times; `seg04:1EFA` seeds by advancing from a time call.
That call is Borland `time(NULL)` (`seg01:082C`, date/time conversion
`seg01:1A3C`) in seconds, with only its low 16-bit word passed to the advance
loop. The browser director converts its millisecond timestamp to seconds first.
`seg04:1F1B(weights...,0)` implements percentage selection using threshold
`655 * weight`; it returns a one-based option, or zero for uncovered remainder.

## Limits of this research

All table values, walk paths, origins and listed addresses are verified against
the original disassembly. The native scene scheduler above is substantially
decoded; ADS/TT3 instruction execution is separate. Ocean particle clipping and
some placement combinations are documented by address rather than fully ported.
The extractor does not execute the historical screen saver and makes no claim
that a modern reconstruction has been runtime-equivalent yet.

The implementation in `web/dist/story.js` was subsequently exercised with
all 288 location/destination/direction combinations, 240 generated batches over
all 16 time slots, and all 79 usable catalogue entries through the real ADS,
TTM and Graphics modules. All scenes terminated. Original NULL-terminator and
out-of-range bitmap-index requests are retained as safe no-ops; the original TTM streams
and mutable-slot replay explain them (see `analysis/ttm-findings.md`). Any
additional missing resource fails verification. Calendar persistence and ADS
same-family versus changed-family lifetimes are also checked. Run
`node tools/story_verify.mjs`; details are written to
`analysis/story-runtime-verification.json`.
