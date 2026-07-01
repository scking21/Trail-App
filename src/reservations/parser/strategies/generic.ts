/* generic.ts — last-resort extraction. Always matches, always returns a low
 * confidence record so the engine never comes back empty: the review screen
 * then opens as a mostly-blank, pre-filled manual form. */

import type { ParseInput, ParseResult, ParserStrategy } from '../../types';
import { findConfirmation, findMoney, findPNR } from '../extractors';

export const genericStrategy: ParserStrategy = {
  name: 'generic',
  priority: 0,
  match: () => true,
  parse: (i: ParseInput): ParseResult => {
    const text = i.text || '';
    const kind = /flight|airlines/i.test(text) ? 'flight'
      : /hotel|inn|resort/i.test(text) ? 'hotel'
      : /rental|car/i.test(text) ? 'car'
      : /train|rail/i.test(text) ? 'train' : 'flight';
    return {
      reservation: {
        kind, tripId: null, provider: null,
        confirmation: findConfirmation(text) || findPNR(text),
        status: 'confirmed', cost: findMoney(text), notes: null,
        source: 'upload', parseConfidence: null, attachments: [],
        segments: [{ seq: 0, from: { name: null }, to: null, extra: {} }],
      },
      confidence: 0.15,
      strategy: 'generic',
    };
  },
};
