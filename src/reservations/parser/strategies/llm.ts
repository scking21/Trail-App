/* llm.ts — DEFERRED, INACTIVE in v1. Documented seam only.
 *
 * Per the product decision, no reservation data leaves the device in v1, so this
 * strategy is disabled (`enabled = false`) and the engine never calls it. If a
 * hosted-LLM fallback is enabled later it would:
 *   1. run ONLY when deterministic strategies fall below the confidence gate,
 *   2. require explicit per-parse user consent (it is the only path that would
 *      send extracted text off-device),
 *   3. post the text to a hosted model with a strict JSON schema and map the
 *      result through the same ParsedReservation shape the other strategies use.
 *
 * Keeping the interface here means turning it on is a config flip, not a rewrite. */

import type { ParseInput, ParseResult, ParserStrategy } from '../../types';

export const LLM_ENABLED = false;

export const llmStrategy: ParserStrategy = {
  name: 'llm-fallback',
  priority: 10, // above generic, below deterministic — only consulted on low confidence
  match: () => LLM_ENABLED,
  parse: (_i: ParseInput): ParseResult | null => {
    // Intentionally a no-op in v1. See file header.
    return null;
  },
};
