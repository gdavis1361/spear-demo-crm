// Input schemas — single source of truth for every form the UI submits.
// Used by both the form (to validate before submit) and the mock server
// (to validate on receive), matching the contract-tests pattern.

import { z } from 'zod';

export const HonestNoteSchema = z.object({
  text: z
    .string()
    .trim()
    .min(30, 'Honest note should be at least 30 words')
    .max(2000, 'Honest note is too long')
    .refine((s) => !/!/.test(s), 'No exclamation points')
    .refine((s) => !/(excited|thrilled|delighted)/i.test(s), 'No sales adjectives')
    .refine((s) => /dispatcher/i.test(s), 'Must name a dispatcher'),
});

export type HonestNote = z.infer<typeof HonestNoteSchema>;

export const QuoteLineSchema = z.object({
  k: z.string().min(1),
  sub: z.string(),
  qty: z.string(),
  unit: z.string(),
  total: z.number().int().nonnegative(),
});

export type QuoteLine = z.infer<typeof QuoteLineSchema>;
