import { sumPesos } from './sum-pesos';

describe('sumPesos', () => {
  it('adds amounts to an exact two-decimal total', () => {
    expect(sumPesos([1500, 8500, 300.5])).toBe(10300.5);
  });

  it('does not drift where a plain + would', () => {
    // 0.1 + 0.2 === 0.30000000000000004 with IEEE 754.
    expect(sumPesos([0.1, 0.2])).toBe(0.3);
  });

  it('is zero for no amounts', () => {
    expect(sumPesos([])).toBe(0);
  });

  it('handles a negative balance in the mix', () => {
    expect(sumPesos([1000, -250.25])).toBe(749.75);
  });
});
