import { describe, it, expect } from 'vitest';
import { HonestNoteSchema, QuoteLineSchema } from './schemas';

const SAMPLE_HONEST = `We don't own the trucks. We coordinate the people who do, and we're accountable for the outcome. Your dispatcher is Marcus Hall — he reads and responds himself.`;

describe('HonestNoteSchema', () => {
  it('accepts a well-formed note', () => {
    const result = HonestNoteSchema.safeParse({ text: SAMPLE_HONEST });
    expect(result.success).toBe(true);
  });

  it('rejects short notes', () => {
    const result = HonestNoteSchema.safeParse({ text: 'too short' });
    expect(result.success).toBe(false);
  });

  it('rejects notes with exclamation points', () => {
    const result = HonestNoteSchema.safeParse({
      text: SAMPLE_HONEST + ' This is great!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /exclamation/i.test(i.message))).toBe(true);
    }
  });

  const adjectives = ['excited', 'thrilled', 'delighted', 'EXCITED', 'Thrilled'];
  it.each(adjectives)('rejects the sales adjective %s', (word) => {
    const tainted = SAMPLE_HONEST.replace('coordinate', `${word} to coordinate`);
    const result = HonestNoteSchema.safeParse({ text: tainted });
    expect(result.success).toBe(false);
  });

  it('rejects notes that omit "dispatcher"', () => {
    const noDispatcher = SAMPLE_HONEST.replace(/dispatcher/gi, 'person');
    const result = HonestNoteSchema.safeParse({ text: noDispatcher });
    expect(result.success).toBe(false);
  });

  it('trims whitespace', () => {
    const padded = `   ${SAMPLE_HONEST}   `;
    const result = HonestNoteSchema.safeParse({ text: padded });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.text).toBe(SAMPLE_HONEST);
  });
});

describe('QuoteLineSchema', () => {
  it('accepts a valid line', () => {
    const line = { k: 'Line haul', sub: 'CONUS', qty: '2156', unit: '$0.78/mi', total: 1682 };
    expect(QuoteLineSchema.safeParse(line).success).toBe(true);
  });

  it('rejects negative totals', () => {
    const line = { k: 'Line haul', sub: '', qty: '1', unit: '', total: -1 };
    expect(QuoteLineSchema.safeParse(line).success).toBe(false);
  });

  it('rejects non-integer totals', () => {
    const line = { k: 'Line haul', sub: '', qty: '1', unit: '', total: 10.5 };
    expect(QuoteLineSchema.safeParse(line).success).toBe(false);
  });

  it('rejects empty `k`', () => {
    const line = { k: '', sub: '', qty: '1', unit: '', total: 0 };
    expect(QuoteLineSchema.safeParse(line).success).toBe(false);
  });
});
