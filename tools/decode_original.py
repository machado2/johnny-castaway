"""Convert supplied resource chunks, using layouts verified against original bytes.

No third-party game engine or recreation is imported.
"""
from pathlib import Path
import struct,json,collections
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
RAW=ROOT/'analysis/raw'
u16=lambda b,p:struct.unpack_from('<H',b,p)[0]
u32=lambda b,p:struct.unpack_from('<I',b,p)[0]

def chunks(b):
    p=0;out={}
    while p+8<=len(b):
        tag=b[p:p+4].decode('ascii');n=u32(b,p+4)
        part=b[p+8:p+8+(n&0x7fffffff)]
        if n&0x80000000:out.update(chunks(part))
        else:out[tag]=part
        p+=8+(n&0x7fffffff)
    return out

def unpack(b):
    typ=b[0];size=u32(b,1);b=b[5:]
    out=bytearray()
    if typ==0:out.extend(b)
    elif typ==1:
        p=0
        while p<len(b) and len(out)<size:
            cmd=b[p];p+=1
            if cmd&128:out.extend(bytes([b[p]])*(cmd&127));p+=1
            else:out.extend(b[p:p+cmd]);p+=cmd
    elif typ==2:
        bit=0;width=9;group_start=0;table=[bytes([i]) for i in range(256)]+[b''];prev=None
        while len(out)<size:
            pos=bit//8;shift=bit%8
            code=(int.from_bytes(b[pos:pos+3],'little')>>shift)&((1<<width)-1);bit+=width
            if code==256:
                # seg6:0fc1 reads width-byte groups (eight codes), discarding
                # the rest of the current group at a dictionary reset.
                group_bits=width*8
                bit=group_start+((bit-group_start+group_bits-1)//group_bits)*group_bits
                group_start=bit
                table=[bytes([i]) for i in range(256)]+[b''];width=9;prev=None
                continue
            if code<len(table):entry=table[code]
            elif code==len(table) and prev is not None:entry=prev+prev[:1]
            else:raise ValueError(f'LZW bad code {code}, table {len(table)}, bit {bit}, out {len(out)}/{size}')
            out.extend(entry)
            if prev is not None and len(table)<4096:
                table.append(prev+entry[:1])
                if len(table)==1<<width and width<12:
                    group_bits=width*8
                    bit=group_start+((bit-group_start+group_bits-1)//group_bits)*group_bits
                    group_start=bit;width+=1
            prev=entry
            if bit>len(b)*8+12:raise ValueError('LZW overrun')
    else:raise ValueError(f'compression {typ}')
    if len(out)!=size:raise ValueError(f'wrong size {len(out)} != {size}')
    return bytes(out)

def run():
    dec=ROOT/'analysis/decoded';dec.mkdir(exist_ok=True)
    manifest={};counts=collections.Counter();errors=[]
    for f in RAW.iterdir():
        if f.suffix.upper() not in ('.BMP','.SCR','.TTM','.ADS','.PAL'):continue
        c=chunks(f.read_bytes());info={}
        for tag,part in c.items():
            try:
                if tag in ['BIN:','VGA:','TT3:','SCR:'] and f.suffix!='.PAL':
                    counts[part[0]]+=1;part=unpack(part)
                (dec/(f.name+'.'+tag[:3])).write_bytes(part)
                info[tag]=len(part)
            except Exception as e:errors.append([f.name,tag,str(e)])
        manifest[f.name]=info
    (dec/'manifest.json').write_text(json.dumps(manifest,indent=2))
    print('Compression types',dict(counts),'resources',len(manifest),'errors',len(errors))
    for err in errors[:25]:print(err)
    if errors:raise RuntimeError(f'{len(errors)} resource chunks could not be decoded')

if __name__=='__main__':run()
