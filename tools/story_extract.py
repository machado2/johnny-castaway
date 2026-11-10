"""Extract scheduler and walk tables from the supplied original Win16 binary.

No external implementation or reconstructed data is an input. Run
inspect_original.py first, then this script.
"""
from pathlib import Path
import hashlib
import json
import struct

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "analysis"
DATA = (OUT / "raw/seg14.bin").read_bytes()
CODE = (OUT / "raw/seg04.bin").read_bytes()


def u16(b, p):
    return struct.unpack_from("<H", b, p)[0]


def i16(b, p):
    return struct.unpack_from("<h", b, p)[0]


def extract():
    ads = []
    p = 0x166e
    while i16(DATA, p):
        ads.append({"address": f"DS:{p:04X}", "id": i16(DATA, p),
                    "file": DATA[p+2:p+15].split(b"\0")[0].decode("ascii") or None})
        p += 17
    names = {row["id"]: row["file"] for row in ads}

    scenes = []
    p = 0x1756
    fields = ["group", "weight", "start_position", "start_direction",
              "end_position", "end_direction", "duration_budget", "min_slot",
              "max_slot_exclusive", "story_day", "flags", "ads_id", "sequence"]
    while i16(DATA, p):
        row = dict(zip(fields, struct.unpack_from("<h9bI2b", DATA, p)))
        row.update(address=f"DS:{p:04X}", index=len(scenes),
                   ads_file=names.get(row["ads_id"]), flags_hex=f"0x{row['flags']:08X}")
        scenes.append(row)
        p += 17

    walks = []
    for n in range(1, 35):
        # seg04:03EA dispatch, jump table seg04:04FB, each case MOV AX,DS offset.
        target = u16(CODE, 0x4fb + (n-1)*2)
        assert CODE[target] == 0xb8
        p = start = u16(CODE, target+1)
        frames = []
        while True:
            bitmap, x, y = struct.unpack_from("<Hhh", DATA, p)
            if (bitmap, x, y) == (0, 0, 0):
                break
            frames.append({"frame": bitmap & 0x7fff, "flip_x": bool(bitmap & 0x8000),
                           "x": x, "y": y})
            p += 6
            assert p < 0x1660
        direction_in, direction_out, position_out = DATA[0x2de+n*3:0x2de+n*3+3]
        walks.append({"id": n, "address": f"DS:{start:04X}",
                      "start_direction": direction_in, "end_direction": direction_out,
                      "end_position": position_out, "frames": frames})

    routes = []
    for source in range(1, 7):
        for destination in range(1, 7):
            pointer_at = 0xa94 + source*12 + destination*2
            p = start = u16(DATA, pointer_at)
            if not p:
                continue
            states = []
            while i16(DATA, p) != -7:
                marker = i16(DATA, p)
                assert -6 <= marker <= -1, (hex(p), marker)
                p += 2
                choices = []
                while i16(DATA, p) >= 0:
                    choices.append({"walk": i16(DATA, p), "weight": i16(DATA, p+2)})
                    p += 4
                states.append({"position": -marker, "choices": choices})
            routes.append({"from": source, "to": destination,
                           "address": f"DS:{start:04X}", "steps": states})

    ambience = {
        "scene_origin_reference": [289, 279],
        "ads_origin_offset": [1, 0],
        "ads_shifted_origin_offset": [273, 0],
        "background_file": "BACKGRND.BMP",
        "background_layers": [
            {"frame": 0, "x": 289, "y": 279},
            {"frame": 1, "x": 250, "y": 303, "requires_variant": 1},
            {"frame": 2, "x": 151, "y": 328, "requires_variant": 1},
            {"frame": 14, "x": 397, "y": 279},
            {"frame": 13, "x": 443, "y": 148},
            {"frame": 12, "x": 366, "y": 122}],
        "ocean_files": [DATA[u16(DATA, 0x262+i*2):].split(b"\0")[0].decode("ascii") for i in range(3)],
        "night_file": "NIGHT.SCR",
        "cloud_frames": [15, 16, 17], "cloud_max_by_size": [8, 4, 2],
        "cloud_move_delay_range": [6, 10],
        "wave_sequences": [],
    }
    for p in [0x268, 0x270, 0x278]:
        frames = []
        while DATA[p] != 255:
            frames.append(DATA[p]); p += 1
        ambience["wave_sequences"].append(frames)

    result = {
        "provenance": {"input": "SCRANTIC.SCR", "sha256": hashlib.sha256((ROOT/"SCRANTIC.SCR").read_bytes()).hexdigest(),
                       "method": "Original DS tables and original seg04 dispatch; no external reimplementations.",
                       "scene_table": "DS:1756", "scene_record_bytes": 17,
                       "scene_terminator": "DS:1CA6"},
        "ads_files": ads, "scenes": scenes, "walks": walks, "routes": routes,
        "standing_walk_by_position": list(DATA[0x347:0x34e]),
        "turning_walk_by_position": list(DATA[0x34e:0x355]),
        "ambience": ambience,
        "random": {"source": "seg04:1E86", "state_u16": list(struct.unpack_from("<56H",DATA,0x1ce6)),
                   "index_a": u16(DATA,0x1ce2), "index_b": u16(DATA,0x1ce4)},
    }
    output = OUT / "story-tables.json"
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Extracted {len(scenes)} scene records, {len(walks)} walks, {len(routes)} routes to {output}")


if __name__ == "__main__":
    extract()
