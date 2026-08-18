import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toErrorToolResult } from './tool-result.util';

/**
 * Generic per-field validators for tools with many action-specific constraints
 * (ranges, enums, "exactly one of X/Y", placeholder-hallucination guards) —
 * pulled out once `places.lookup`'s 11 actions made repeating this inline in
 * every `switch` branch unreadable. Each returns `null` when the value is
 * absent-or-valid, or a ready-to-return `CallToolResult` on rejection, so a
 * call site can just do `const err = validateX(...); if (err) return err;`.
 */

export function validateNumberInRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
  context: string,
): CallToolResult | null {
  if (value === undefined) {
    return null;
  }
  return typeof value === 'number' && value >= min && value <= max
    ? null
    : toErrorToolResult({
        error: `${field} must be between ${min} and ${max}${context}.`,
      });
}

export function validateEnum(
  value: unknown,
  field: string,
  allowed: readonly string[],
  context: string,
): CallToolResult | null {
  if (value === undefined) {
    return null;
  }
  return typeof value === 'string' && allowed.includes(value)
    ? null
    : toErrorToolResult({
        error: `${field} must be one of: ${allowed.join(', ')}${context}.`,
      });
}

export function validateArrayLength(
  value: unknown,
  field: string,
  maxItems: number,
  context: string,
): CallToolResult | null {
  if (value === undefined) {
    return null;
  }
  return Array.isArray(value) && value.length <= maxItems
    ? null
    : toErrorToolResult({
        error: `${field} must be an array with at most ${maxItems} items${context}.`,
      });
}

export function validateExactlyOneOf(
  fields: Array<{ name: string; present: boolean }>,
  context: string,
): CallToolResult | null {
  const presentCount = fields.filter((f) => f.present).length;
  return presentCount === 1
    ? null
    : toErrorToolResult({
        error: `Provide exactly one of ${fields.map((f) => f.name).join('/')}${context}, not both.`,
      });
}

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /placeholder/i,
  /\bexample\b/i,
  /\byour[-_]/i,
  /\binsert[-_]/i,
  /\bdummy\b/i,
  /\bfake\b/i,
  /\bsample\b/i,
  /\btodo\b/i,
  /\bfixme\b/i,
  /^<.*>$/,
  /^\{\{.*\}\}$/,
  /^n\/a$/i,
  /^unknown$/i,
];

/**
 * Rejects values that look like an LLM-invented placeholder rather than a
 * real opaque id returned by an earlier call (e.g. "PLACEHOLDER_ID",
 * "<geotiff-id>", "your-video-id-here"). Pattern-based, not a format check —
 * accepts any real-looking opaque string and only rejects conspicuously fake
 * ones. `value` must already be a non-empty trimmed string.
 */
export function validateNotPlaceholder(
  value: string,
  field: string,
  context: string,
): CallToolResult | null {
  if (/\s/.test(value) || PLACEHOLDER_PATTERNS.some((p) => p.test(value))) {
    return toErrorToolResult({
      error:
        `${field} looks like a placeholder or invented value${context} — it must be the exact ` +
        'opaque id returned by an earlier result, not something guessed or invented.',
    });
  }
  return null;
}
