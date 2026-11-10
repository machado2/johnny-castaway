from pathlib import Path
import json,struct
from capstone import Cs,CS_ARCH_X86,CS_MODE_16
ROOT=Path(__file__).resolve().parents[1]
meta=json.loads((ROOT/'analysis/original-inventory.json').read_text())
exe=(ROOT/'SCRANTIC.SCR').read_bytes();ne=meta['ne_offset']
u16=lambda b,p:struct.unpack_from('<H',b,p)[0]
imp=ne+u16(exe,ne+0x2a);mod=ne+u16(exe,ne+0x28)
def name(off):
    p=imp+off;return exe[p+1:p+1+exe[p]].decode('latin1')
mods=[name(u16(exe,mod+i*2)) for i in range(u16(exe,ne+0x1e))]
out=ROOT/'analysis/disasm';out.mkdir(exist_ok=True)
for s in meta['segments']:
    if s['data']:continue
    data=(ROOT/f'analysis/raw/seg{s["id"]:02}.bin').read_bytes()
    rel={}
    for r in s['relocations']:
        typ=r['flags']&3
        target=f"seg{r['target1']:02}:{r['target2']:04x}" if typ==0 else f"{mods[r['target1']-1]}.{name(r['target2']) if typ==2 else '#'+str(r['target2'])}" if typ in [1,2] else str(r)
        p=r['source'];seen=set()
        while p!=0xffff and p not in seen and p+2<=len(data):
            seen.add(p);rel[p]=target
            if r['flags']&4:break
            p=u16(data,p)
    md=Cs(CS_ARCH_X86,CS_MODE_16);md.skipdata=True
    lines=[]
    for ins in md.disasm(data,0):
        refs=[rel[p] for p in range(ins.address,ins.address+ins.size) if p in rel]
        lines.append(f'{ins.address:04x}  {ins.bytes.hex():18} {ins.mnemonic:7} {ins.op_str}'+(' ; '+', '.join(refs) if refs else ''))
    (out/f'seg{s["id"]:02}.asm').write_text('\n'.join(lines))
print('Disassembled',len(list(out.glob('*.asm'))),'segments. Imports:',mods)
