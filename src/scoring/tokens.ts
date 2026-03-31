import type { SolutionFile, TokenResult, TokenAnalysis } from '../core/types.js';

export function analyzeTokens(
  solution: SolutionFile[],
  targetApis: string[],
  expectedTokens: string[],
  testId: string,
  target: string,
): TokenAnalysis {
  const allContent = solution.map((f) => f.content).join('\n');

  const apis: TokenResult[] = targetApis.map((api) => {
    const regex = new RegExp(`\\b${escapeRegex(api)}\\b`);
    const foundFile = solution.find((f) => regex.test(f.content));
    return {
      token: api,
      found: regex.test(allContent),
      ...(foundFile ? { foundIn: foundFile.path } : {}),
    };
  });

  const tokens: TokenResult[] = expectedTokens.map((token) => {
    let regex: RegExp;
    try {
      regex = new RegExp(token);
    } catch {
      regex = new RegExp(escapeRegex(token));
    }
    const foundFile = solution.find((f) => regex.test(f.content));
    return {
      token,
      found: regex.test(allContent),
      ...(foundFile ? { foundIn: foundFile.path } : {}),
    };
  });

  const apisFound = apis.filter((a) => a.found).length;
  const tokensFound = tokens.filter((t) => t.found).length;

  return {
    testId,
    target,
    apis,
    tokens,
    apiCoverage: targetApis.length > 0 ? (apisFound / targetApis.length) * 100 : 100,
    tokenCoverage: expectedTokens.length > 0 ? (tokensFound / expectedTokens.length) * 100 : 100,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
