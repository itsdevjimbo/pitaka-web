import { Pipe, PipeTransform } from '@angular/core';
import { formatPeso } from './format-peso';

/**
 * Template sugar for {@link formatPeso}: `{{ account.currentBalance | peso }}`.
 * The pipe carries no logic of its own — it exists so templates have one token
 * to reach for and `formatPeso` stays the single place currency rendering lives
 * (ADR 0005).
 */
@Pipe({ name: 'peso' })
export class PesoPipe implements PipeTransform {
  transform(amount: number): string {
    return formatPeso(amount);
  }
}
