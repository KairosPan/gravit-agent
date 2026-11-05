// A value with every said in it read in the table that stands (plan 7 Task 2): the store keeps a line the face writes as a
// said, so a test that compares a slice, a write's answer or a returned record with its English reads it through this.
import { isSaid, sayOf } from '../../../client/js/i18n/words.js';

export function spoken(v) {
  if (isSaid(v)) return sayOf(v);
  if (Array.isArray(v)) return v.map(spoken);
  if (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, spoken(x)]));
  return v;
}
