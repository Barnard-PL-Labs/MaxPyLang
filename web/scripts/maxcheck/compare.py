"""Browser minus Max, test by test, from two folders of WAVs rendered from the same
patches and signal. Usage: compare.py <max dir> <web dir> [name prefixes]"""
import numpy as np, sys, os
import analyze as A
def run(dm, dw, only=None):
    om=A.offset(dm+'/init.wav'); ow=A.offset(dw+'/init.wav')
    print('offsets max=%d web=%d'%(om,ow))
    print('%-22s  %s   | sweep diff @ %s'%('web minus max (dB)',' '.join('%6s'%k for k in ('s-12','s-3','noise','tail','thd3M','thd3W')),' '.join(str(b) for b in A.BANDS)))
    worst=[]
    for f in sorted(os.listdir(dm)):
        if not f.endswith('.wav'): continue
        n=f[:-4]
        if only and not any(n.startswith(p) for p in only): continue
        if not os.path.exists(dw+'/'+f): print(n,'MISSING in web'); continue
        m=A.analyze(dm+'/'+f,om); w=A.analyze(dw+'/'+f,ow)
        for c in ('L','R'):
            a,b=m[c],w[c]
            tail=(b['tail']-a['tail']) if max(a['tail'],b['tail'])>-70 else 0.0
            d=[b['s12']-a['s12'], b['s3']-a['s3'], b['noise']-a['noise'], tail]
            sw=b['sweep']-a['sweep']; sw=np.where(np.maximum(a['sweep'],b['sweep'])>-60, sw, 0)
            if c=='R' and n not in('trem_pan','delay_ping') and 'reverb' not in n and 'chorus' not in n and 'flanger' not in n and 'chain' not in n: continue
            big=max(max(abs(v) for v in d), float(np.max(np.abs(sw))))
            worst.append((big,n,c))
            print('%-20s %s %s %6.1f %6.1f | %s%s'%(n,c,' '.join('%6.1f'%v for v in d),a['thd3'],b['thd3'],' '.join('%5.1f'%v for v in sw),'   <<<' if big>1.5 else ''))
    return worst
if __name__=='__main__':
    run(sys.argv[1], sys.argv[2], sys.argv[3:] or None)
