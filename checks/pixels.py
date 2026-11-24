"""pixels.py — pixel analysis for the headlight test.
Usage: python3 pixels.py <on.png> <off.png>
Patches (1280x800 frame, camera on the player car, zoom 1.2):
  lit     x 615..665, y 170..230 — asphalt ahead of the car, in the beam.
  control x  90..190, y 600..700 — far from the beam, same lighting.
  roof    x 632..648, y 150..170 — the white test car's roof, in the beam.
Pass: lit(on) - control(on) mean lift >= +20, >= 90% of lit pixels > +10
      vs the control patch, |control(on) - control(off)| <= 1,
      roof(on) - roof(off) >= +20 (the beam lights the car ahead),
      and lit(on) - lit(off) >= +20 (headlight-only delta).
"""
import sys
from PIL import Image


def patch_mean(img, x0, y0, x1, y1):
    px = img.load()
    vals = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = px[x, y][:3]
            vals.append(0.299 * r + 0.587 * g + 0.114 * b)
    return sum(vals) / len(vals), vals


def main():
    on = Image.open(sys.argv[1]).convert('RGB')
    off = Image.open(sys.argv[2]).convert('RGB')
    lit_on, lit_vals = patch_mean(on, 615, 170, 665, 230)
    ctrl_on, _ = patch_mean(on, 90, 600, 190, 700)
    lit_off, _ = patch_mean(off, 615, 170, 665, 230)
    ctrl_off, _ = patch_mean(off, 90, 600, 190, 700)
    roof_on, _ = patch_mean(on, 632, 150, 648, 170)
    roof_off, _ = patch_mean(off, 632, 150, 648, 170)
    lift = lit_on - ctrl_on
    above = sum(1 for v in lit_vals if v - ctrl_on > 10) / len(lit_vals) * 100
    ctrl_drift = abs(ctrl_on - ctrl_off)
    headlight_delta = lit_on - lit_off
    roof_gain = roof_on - roof_off
    print(f'lit(on) mean      {lit_on:.1f}')
    print(f'control(on) mean  {ctrl_on:.1f}')
    print(f'lit(off) mean     {lit_off:.1f}')
    print(f'control(off) mean {ctrl_off:.1f}')
    print(f'roof(on) mean     {roof_on:.1f}')
    print(f'roof(off) mean    {roof_off:.1f}')
    print(f'lift lit-control  {lift:+.1f} (need >= +20)')
    print(f'pixels > +10      {above:.1f}% (need >= 90%)')
    print(f'control drift     {ctrl_drift:.1f} (need <= 1)')
    print(f'headlight delta   {headlight_delta:+.1f} (lit on vs lit off, need >= +20)')
    print(f'roof gain         {roof_gain:+.1f} (car roof on vs off, need >= +20)')
    ok = lift >= 20 and above >= 90 and ctrl_drift <= 1 and headlight_delta >= 20 and roof_gain >= 20
    print('HEADLIGHT: ' + ('PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)


main()
