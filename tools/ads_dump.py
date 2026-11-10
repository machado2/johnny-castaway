"""Decode ADS instruction sizes exclusively from original SCRANTIC segment 10.

Inputs are original uncompressed ADS:SCR/RES/TAG chunks extracted under analysis.
This is a research listing helper, not a playback implementation.
"""
from pathlib import Path
import struct
import collections

ROOT = Path(__file__).resolve().parents[1]
u16 = lambda b,p: struct.unpack_from('<H', b, p)[0]
s16 = lambda b,p: struct.unpack_from('<h', b, p)[0]

def string_table(data):
    n = u16(data, 0)
    p = 2
    result = {}
    for _ in range(n):
        key = u16(data, p)
        p += 2
        end = data.index(0, p)
        result[key] = data[p:end].decode('latin1')
        p = end + 1
    return result

def sizes():
    b = (ROOT / 'analysis/raw/seg10.bin').read_bytes()
    target_size = {0x370:2,0x36a:4,0x364:6,0x35e:8,0x358:10}
    return {u16(b,0x383+i*2):target_size[u16(b,0x3c9+i*2)] for i in range(35)}

NAMES = {
    1:'NOP',5:'END_INIT',0xffff:'END_SCENE',
    0xf000:'STOP_THIS_ADS',0xf010:'STOP_ADS',0xf200:'START_ADS',0xf210:'RESET_START_ADS',
    0x1010:'WHILE_FROZEN',0x1020:'WHILE_NOT_FROZEN',0x1030:'WHILE_NEVER_STARTED',
    0x1040:'WHILE_STARTED',0x1050:'WHILE_JUST_FINISHED',0x1060:'WHILE_INACTIVE',
    0x1070:'WHILE_RUNNING',0x1080:'WHILE_COUNT_LE',
    0x1310:'IF_FROZEN',0x1320:'IF_NOT_FROZEN',0x1330:'IF_NEVER_STARTED',
    0x1340:'IF_STARTED',0x1350:'IF_JUST_FINISHED',0x1360:'IF_INACTIVE',
    0x1370:'IF_RUNNING',0x1380:'IF_GLOBAL_463C_LE',0x1390:'IF_GLOBAL_463C_GE',
    0x13a0:'IF_GLOBAL_4638_LE',0x13a1:'IF_GLOBAL_463A_LE',
    0x13b0:'IF_GLOBAL_4638_GE',0x13b1:'IF_GLOBAL_463A_GE',
    0x13c0:'IF_GLOBAL_4638_EQ',0x13c1:'IF_GLOBAL_463A_EQ',
    0x1420:'AND',0x1430:'OR',0x1500:'ELSE',0x1510:'ENDIF',0x1520:'ENDWHILE',
    0x2000:'RESTART_TTM',0x2005:'START_TTM',0x2010:'STOP_TTM',0x2015:'FREEZE_TTM',
    0x2020:'RESET_TTM',0x3010:'RANDOM',0x3020:'NO_CHOICE',0x30ff:'END_RANDOM',
    0x4000:'TTM_TO_TAIL',0x4010:'TTM_TO_HEAD',
}

def decode(path):
    size = sizes()
    b = path.read_bytes()
    p = 0
    scenes = []
    while p < len(b):
        scene_id = u16(b, p)
        p += 2
        scene = {'id':scene_id,'offset':p,'instructions':[]}
        scenes.append(scene)
        while p < len(b):
            op = u16(b,p)
            n = size.get(op,2)
            args = [s16(b,p+i) for i in range(2,n,2)]
            scene['instructions'].append((p,op,args))
            p += n
            if op == 0xffff:
                break
    return scenes

def main():
    out = ROOT / 'analysis/ads-listings'
    out.mkdir(exist_ok=True)
    counts = collections.Counter()
    for path in sorted((ROOT/'analysis/decoded').glob('*.ADS.SCR')):
        res = string_table(path.with_suffix('.RES').read_bytes())
        tags = string_table(path.with_suffix('.TAG').read_bytes())
        scenes = decode(path)
        lines = ['Original resource '+path.name, 'Resources: '+repr(res), '']
        for scene in scenes:
            lines += [f"SCENE {scene['id']}: {tags.get(scene['id'],'')} @ {scene['offset']:04x}"]
            for p,op,args in scene['instructions']:
                counts[op] += 1
                lines.append(f'  {p:04x}  {op:04x}  {NAMES.get(op,"UNKNOWN"):25} '+', '.join(map(str,args)))
            lines.append('')
        (out/(path.stem+'.txt')).write_text('\n'.join(lines))
        print(path.name, len(scenes), 'scenes', sum(len(x['instructions']) for x in scenes), 'instructions')
    print('Opcodes:', ', '.join(f'{op:04x}={n}' for op,n in sorted(counts.items())))

if __name__ == '__main__':
    main()
