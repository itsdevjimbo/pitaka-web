import { TestBed } from '@angular/core/testing';
import { formatPeso } from './format-peso';
import { PesoPipe } from './peso.pipe';

describe('PesoPipe', () => {
  it('formats through formatPeso so every template shares the one token', () => {
    const pipe = TestBed.runInInjectionContext(() => new PesoPipe());

    expect(pipe.transform(1234.5)).toBe(formatPeso(1234.5));
    expect(pipe.transform(1234.5)).toBe('₱1,234.50');
  });
});
