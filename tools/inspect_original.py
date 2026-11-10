"""Inspect only the supplied Win16 executable and its resource volumes."""
from pathlib import Path
import struct, json, re, hashlib

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'analysis'
OUT.mkdir(exist_ok=True)
u16 = lambda b,p: struct.unpack_from('<H',b,p)[0]
u32 = lambda b,p: struct.unpack_from('<I',b,p)[0]

def chunks(data, base=0):
    p=0
    result=[]
    while p+8<=len(data):
        tag=data[p:p+4].decode('ascii',errors='replace')
        size=u32(data,p+4); n=size&0x7fffffff
        if n>len(data)-p-8:
            result.append({'offset':base+p,'tag':tag,'size':n,'invalid':True});break
        item={'offset':base+p,'tag':tag,'size':n}
        if size&0x80000000:
            item['children']=chunks(data[p+8:p+8+n],base+p+8)
        else:
            item['head']=data[p+8:p+8+min(n,32)].hex(' ')
        result.append(item);p+=8+n
    return result

def run():
    b=(ROOT/'SCRANTIC.SCR').read_bytes(); ne=u32(b,0x3c)
    assert b[ne:ne+2]==b'NE'
    shift=u16(b,ne+0x32); n=u16(b,ne+0x1c); st=ne+u16(b,ne+0x22)
    segs=[]
    raw=OUT/'raw';raw.mkdir(exist_ok=True)
    ds=u16(b,ne+0x0e)
    for i in range(n):
        p=st+8*i;off=u16(b,p)<<shift;length=u16(b,p+2) or 65536
        flags=u16(b,p+4)
        seg={'id':i+1,'offset':off,'size':length,'flags':flags,'data':bool(flags&1),'relocations':[]}
        (raw/f'seg{i+1:02}.bin').write_bytes(b[off:off+length])
        if flags&0x100:
            rp=off+length; count=u16(b,rp)
            for j in range(count):
                q=rp+2+j*8
                seg['relocations'].append({'type':b[q],'flags':b[q+1],'source':u16(b,q+2),'target1':u16(b,q+4),'target2':u16(b,q+6)})
        segs.append(seg)
    report={'sha256':hashlib.sha256(b).hexdigest(),'ne_offset':ne,'data_segment':ds,'segments':segs}
    resources=[];v=(ROOT/'RESOURCE.001').read_bytes();p=0
    while p+17<=len(v):
        name=v[p:p+13].split(b'\0')[0].decode('ascii');size=u32(v,p+13)
        data=v[p+17:p+17+size]
        (raw/name).write_bytes(data)
        resources.append({'name':name,'offset':p,'size':size,'chunks':chunks(data)})
        p+=17+size
    report['resources']=resources
    index=(ROOT/'RESOURCE.MAP').read_bytes()
    assert u16(index,4)==1
    assert index[6:19].split(b'\0')[0]==b'RESOURCE.001'
    assert u16(index,19)==len(resources)
    assert len(index)==21+8*len(resources)
    indexed={u32(index,25+8*i) for i in range(len(resources))}
    assert indexed=={r['offset'] for r in resources}, 'RESOURCE.MAP/volume mismatch'
    assert p==len(v), 'Unparsed volume bytes'
    # NE named and numeric resources, including the original PCM sounds.
    rt=ne+u16(b,ne+0x24);align=u16(b,rt);p=rt+2; nr=[]
    def rid(x):
        if x&0x8000:return x&0x7fff
        o=rt+x;return b[o+1:o+1+b[o]].decode('latin1')
    while u16(b,p):
        typ=u16(b,p);count=u16(b,p+2);p+=8
        for j in range(count):
            off=u16(b,p)<<align;ln=u16(b,p+2)<<align;ident=rid(u16(b,p+6))
            nr.append({'type':rid(typ),'id':ident,'offset':off,'size':ln})
            if b[off:off+4]==b'RIFF':
                (raw/f'{ident}.wav').write_bytes(b[off:off+u32(b,off+4)+8])
            p+=12
    report['ne_resources']=nr
    (OUT/'original-inventory.json').write_text(json.dumps(report,indent=2))
    db=(raw/f'seg{ds:02}.bin').read_bytes()
    (OUT/'data-strings.txt').write_text('\n'.join(f'{m.start():04x}: {m.group().decode("ascii")}' for m in re.finditer(rb'[ -~]{4,}',db)))
    print('NE',hex(ne),'data segment',ds)
    print('Segments:',[(x['id'],hex(x['offset']),x['size'],x['data']) for x in segs])
    print('Resources:',len(resources),{ext:sum(x['name'].endswith(ext) for x in resources) for ext in sorted({x['name'].split('.')[-1] for x in resources})})
    print('\n'.join(f"{r['name']:15} {r['size']:6} "+' '.join(c['tag'] for c in r['chunks']) for r in resources))
    print('NE resources',nr)

if __name__=='__main__':run()
