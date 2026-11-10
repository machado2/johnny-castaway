"""Inspect original TT3 bytecode, based on SCRANTIC.SCR seg11/seg12 only.

No external implementation is used. Input streams are emitted by
decode_original.py. This script is an analysis aid, not an application runtime.
"""
from collections import Counter, defaultdict
from pathlib import Path
import json
import struct

ROOT = Path(__file__).resolve().parents[1]


def parse_stream(data):
    pos = frame = 0
    result = []
    while pos < len(data):
        start = pos
        opcode = struct.unpack_from('<H', data, pos)[0]
        pos += 2
        count = opcode & 15
        if count == 15:
            if opcode in (0xAF1F, 0xAF2F):
                points = struct.unpack_from('<H', data, pos)[0]
                args = list(struct.unpack_from('<' + 'h' * (points * 2 + 1), data, pos))
                pos += points * 4 + 2
            else:
                end = data.index(0, pos)
                args = data[pos:end].decode('latin1')
                pos = end + 1
                pos += pos & 1
        else:
            args = list(struct.unpack_from('<' + 'h' * count, data, pos))
            pos += count * 2
        result.append(dict(offset=start, frame=frame, op=f'0x{opcode:04x}', args=args))
        if opcode == 0x0FF0:
            frame += 1
    return result


def main():
    counts = Counter()
    examples = defaultdict(list)
    frames = {}
    for path in sorted((ROOT / 'analysis/decoded').glob('*.TTM.TT3')):
        ops = parse_stream(path.read_bytes())
        path.with_suffix(path.suffix + '.json').write_text(json.dumps(ops), encoding='utf-8')
        frames[path.name] = sum(op['op'] == '0x0ff0' for op in ops)
        for op in ops:
            counts[op['op']] += 1
            if len(examples[op['op']]) < 6:
                examples[op['op']].append(dict(file=path.name, **op))
    summary = dict(files=len(frames), frame_total=sum(frames.values()), frames=frames,
                   counts=dict(sorted(counts.items())), examples=examples)
    (ROOT / 'analysis/ttm-opcodes.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(f'{len(frames)} streams, {sum(frames.values())} frames, {len(counts)} opcodes')


if __name__ == '__main__':
    main()
