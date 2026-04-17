import type { Config } from '../types.js';

/**
 * Build a bullet list of filesystem source paths with inline additionalContext.
 * Only includes local and git sources (not URL sources).
 */
export function buildSourceList(sourcePaths: string[], config: Config): string {
  // sourcePaths only contains local/git sources, so match them to non-url config entries
  const nonUrlSources = config.sources.filter((s) => s.type !== 'url');
  return sourcePaths.map((p, i) => {
    const ctx = nonUrlSources[i]?.additionalContext;
    return ctx ? `- ${p} — ${ctx}` : `- ${p}`;
  }).join('\n');
}

/**
 * Build a bullet list of URL sources for the agent to browse.
 */
export function buildUrlSourceList(urlSources: { url: string; additionalContext?: string }[]): string {
  if (!urlSources || urlSources.length === 0) return '';
  const lines = urlSources.map((s) =>
    s.additionalContext ? `- ${s.url} — ${s.additionalContext}` : `- ${s.url}`
  ).join('\n');
  return `\nAlso browse the following URLs for reference:\n${lines}`;
}

/** Difficulty rubric — single source of truth for generate + insights prompts. */
export const DIFFICULTY_RUBRIC = `\
  - "easy": A task directly demonstrated in public documentation, guides, or examples. The agent can copy/adapt an existing example with minimal changes.
  - "medium": Uses supported functions but with different configurations, parameters, or setups not directly shown in any guide. Requires combination and extrapolation at the single-function level (e.g., different input formats, non-default options, edge-case parameters).
  - "hard": Requires combining multiple SDK functions together in ways not directly documented. Tests combination and extrapolation at the multi-function level (e.g., chaining API calls, orchestrating multiple endpoints, building a workflow from several SDK features).`;

/** Judge scoring criteria with bands — single source of truth for judge + insights prompts. */
export const JUDGE_SCORING_CRITERIA = `\
1. **apiDiscovery** (0-100): Did the agent find and use the correct SDK endpoints/methods?
   - 0-20: Used completely wrong or unrelated APIs.
   - 21-40: Found some correct APIs but missed major ones.
   - 41-60: Found most APIs but used wrong alternatives for some.
   - 61-80: Found all major APIs, missed minor helper methods.
   - 81-100: Found exactly the right APIs matching the reference.

2. **callCorrectness** (0-100): Are the API calls constructed correctly (parameters, headers, body)?
   - 0-20: Wrong parameters, missing required fields, incorrect types.
   - 21-40: Some correct parameters but major issues (wrong field names, missing headers).
   - 41-60: Mostly correct but notable mistakes (wrong content type, incorrect body format).
   - 61-80: Correct parameters with minor issues (extra unnecessary fields, slightly different but valid options).
   - 81-100: Correct parameters, headers, request body, and call sequences.

3. **completeness** (0-100): Does the solution handle all requirements?
   - 0-20: Only addresses a fraction of the problem.
   - 21-40: Handles the main task but misses most secondary requirements.
   - 41-60: Covers the primary flow but skips error handling or edge cases.
   - 61-80: Handles most requirements including basic error paths.
   - 81-100: Fully complete — all requirements, edge cases, and error handling.

4. **functionalCorrectness** (0-100): Does the code actually run and produce correct output?
   - 0-20: Does not run — syntax errors, missing imports, crashes on start.
   - 21-40: Runs but produces mostly wrong output.
   - 41-60: Partially works — correct for some inputs, wrong for others.
   - 61-80: Works correctly for common cases, fails on edge cases.
   - 81-100: Runs correctly and produces expected output for all cases.

5. **overallVerdict** (boolean): Does the generated solution meet the core requirements? Set to true if it would pass acceptance tests, even if the implementation differs. Set to false if it fails to meet the core requirements.

6. **notes** (string): Brief explanation of your scoring. Mention which APIs were found/missed, any parameter issues, missing requirements, and functional problems.`;

/**
 * Extract JSON from agent output — tries fenced code block first,
 * then falls back to finding the outermost array or object delimiters.
 */
export function extractJson(text: string, delimiter: 'array' | 'object' = 'array'): string {
  const fencedMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const [open, close] = delimiter === 'array' ? ['[', ']'] : ['{', '}'];
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }

  return text.trim();
}
