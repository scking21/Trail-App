/* engine.ts — runs the registered strategies and returns the best candidate.
 *
 * "Best-confidence-wins": every matching strategy gets a shot; the one with the
 * highest confidence is returned. Strategies are pure, so this is deterministic
 * and unit-testable without any browser/native deps. The deferred LLM strategy
 * is only consulted when the best deterministic result is below CONFIDENCE_GATE
 * (and it is a no-op in v1, so nothing actually happens off-device). */

import type { ParseInput, ParseResult, ParserStrategy } from '../types';
import { jsonLdStrategy, icsStrategy } from './strategies/structured';
import {
  flightStrategy, hotelStrategy, carStrategy, trainStrategy,
} from './strategies/providers';
import { genericStrategy } from './strategies/generic';
import { llmStrategy } from './strategies/llm';

/** Below this, the UI strongly flags fields and (if ever enabled) the LLM
 * fallback would be offered. */
export const CONFIDENCE_GATE = 0.5;

export const DEFAULT_STRATEGIES: ParserStrategy[] = [
  jsonLdStrategy,
  icsStrategy,
  flightStrategy,
  hotelStrategy,
  carStrategy,
  trainStrategy,
  llmStrategy,
  genericStrategy,
];

export interface EngineResult extends ParseResult {
  /** True when the winning confidence cleared the gate. */
  passedGate: boolean;
  /** Every candidate, best-first, for debugging / "try another reading". */
  candidates: ParseResult[];
}

export function runParser(
  input: ParseInput,
  strategies: ParserStrategy[] = DEFAULT_STRATEGIES,
): EngineResult {
  const ordered = [...strategies].sort((a, b) => b.priority - a.priority);
  const candidates: ParseResult[] = [];

  for (const s of ordered) {
    let matched = false;
    try {
      matched = s.match(input);
    } catch {
      matched = false;
    }
    if (!matched) continue;
    let r: ParseResult | null = null;
    try {
      r = s.parse(input);
    } catch {
      r = null;
    }
    if (r) candidates.push(r);
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  // generic always matches, so candidates is never empty.
  const best = candidates[0];
  return {
    ...best,
    passedGate: best.confidence >= CONFIDENCE_GATE,
    candidates,
  };
}
