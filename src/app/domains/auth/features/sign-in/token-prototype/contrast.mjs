// Reproduce with: node <path>/contrast.mjs
// Opaque sRGB foreground/background pairs only; not a page accessibility audit.
export const schemes = {
  light: {
    backgrounds: { canvas: '#F1F3FF', surface: '#FFFFFF', raised: '#FFFFFF', soft: '#E0E6FF', error: '#FEECEC', warning: '#FFF4DA', success: '#E6F5ED' },
    text: { text: '#1C2763', secondary: '#596189', primary: '#304BC6', income: '#047454', expense: '#B91C1C', transfer: '#525252', warning: '#855600' },
    outline: '#7681AF',
    decorativeBorder: '#CBD3F1',
    button: { text: '#FFFFFF', default: '#304BC6', hover: '#233899', pressed: '#17276F' },
  },
  dark: {
    backgrounds: { canvas: '#12172F', surface: '#1D2443', raised: '#283153', soft: '#303B66', error: '#442832', warning: '#3B3320', success: '#153B32' },
    text: { text: '#F0F2FF', secondary: '#B4BEDF', primary: '#BBC0F5', income: '#34D399', expense: '#FF8585', transfer: '#D4D4D4', warning: '#F8CB62' },
    outline: '#7E8CB8',
    decorativeBorder: '#43527E',
    button: { text: '#12172F', default: '#BBC0F5', hover: '#DFE1FA', pressed: '#EFF0FD' },
  },
};

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

let failures = 0;
for (const [name, scheme] of Object.entries(schemes)) {
  console.log(`\n${name}: foreground contrast on opaque backgrounds`);
  const rows = [];
  for (const [role, foreground] of Object.entries({ ...scheme.text, outline: scheme.outline })) {
    const minimum = role === 'outline' ? 3 : 4.5;
    const row = { role, foreground, required: minimum };
    for (const [backgroundRole, background] of Object.entries(scheme.backgrounds)) {
      const ratio = contrast(foreground, background);
      row[backgroundRole] = ratio.toFixed(2);
      if (ratio < minimum) failures++;
    }
    rows.push(row);
  }
  console.table(rows);
  const { text, ...states } = scheme.button;
  console.table(Object.entries(states).map(([state, fill]) => {
    const ratio = contrast(text, fill);
    if (ratio < 4.5) failures++;
    return { state, text, fill, contrast: ratio.toFixed(2) };
  }));
  console.log('Decorative border only:', Object.fromEntries(Object.entries(scheme.backgrounds).map(([role, bg]) => [role, contrast(scheme.decorativeBorder, bg).toFixed(2)])));
}
console.table([
 ['Light disabled text', '#596189', '#E6E9F3', 4.5],
 ['Dark disabled text', '#A6AFCB', '#303956', 4.5],
 ['Light destructive button', '#FFFFFF', '#B91C1C', 4.5],
 ['Dark destructive button', '#12172F', '#FF8585', 4.5],
].map(([role, foreground, background, required]) => {
 const ratio = contrast(foreground, background);
 if(ratio < required) failures++;
 return {role, foreground, background, required, ratio: ratio.toFixed(2)};
}));
console.log(`\n${failures} selected color-pair threshold failures. This is not a WCAG compliance claim.`);
process.exitCode = failures ? 1 : 0;
