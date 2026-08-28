import { TestBed } from '@angular/core/testing';
import { formatPeso } from './format-peso';
import { PesoPipe } from './peso.pipe';

describe('formatPeso', () => {
  it('renders a positive amount with the peso sign and two decimals', () => {
    expect(formatPeso(1234.5)).toBe('₱1,234.50');
  });

  it('renders zero as ₱0.00 rather than a blank or a bare 0', () => {
    expect(formatPeso(0)).toBe('₱0.00');
  });

  it('keeps the sign on a negative balance — a card can owe money', () => {
    expect(formatPeso(-500)).toBe('-₱500.00');
  });

  it('groups thousands', () => {
    expect(formatPeso(1000000)).toBe('₱1,000,000.00');
  });
});

describe('PesoPipe', () => {
  it('formats through formatPeso so templates share the one token', () => {
    const pipe = TestBed.runInInjectionContext(() => new PesoPipe());

    expect(pipe.transform(1234.5)).toBe(formatPeso(1234.5));
    expect(pipe.transform(1234.5)).toBe('₱1,234.50');
  });
});
