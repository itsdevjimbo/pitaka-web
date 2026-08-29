import chroma from 'chroma-js';
import { BRAND_ACCENT } from './brand';

describe('BRAND_ACCENT', () => {
  it('is a colour the palette generator can parse', () => {
    expect(chroma.valid(BRAND_ACCENT)).toBe(true);
  });

  it('is neither green nor red — those hues mean income and expense (ADR 0008)', () => {
    const hue = chroma(BRAND_ACCENT).get('hsl.h'); // degrees, 0–360

    // Generous bands around each reserved hue, so a future re-theme has room to
    // move but cannot drift into income-green or expense-red.
    const RED = (h: number) => h <= 20 || h >= 340;
    const GREEN = (h: number) => h >= 90 && h <= 165;

    expect(RED(hue)).toBe(false);
    expect(GREEN(hue)).toBe(false);
  });
});
