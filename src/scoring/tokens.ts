import type { SolutionFile, TokenResult, TokenAnalysis } from '../types.js';

function isRestStyleApi(api: string): boolean {
  return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//.test(api);
}

function matchRestApi(api: string, content: string): boolean {
  const match = api.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S+)/);
  if (!match) return false;
  const [, method, path] = match;
  const methodRegex = new RegExp(method, 'i');
  const pathRegex = new RegExp(escapeRegex(path));
  return methodRegex.test(content) && pathRegex.test(content);
}

export function analyzeTokens(
  solution: SolutionFile[],
  targetApis: string[],
  expectedTokens: string[],
  testId: string,
  target: string,
): TokenAnalysis {
  const allContent = solution.map((f) => f.content).join('\n');

  const apis: TokenResult[] = targetApis.map((api) => {
    let found: boolean;
    let foundFile: SolutionFile | undefined;

    if (isRestStyleApi(api)) {
      foundFile = solution.find((f) => matchRestApi(api, f.content));
      found = matchRestApi(api, allContent);
    } else {
      const regex = new RegExp(`\\b${escapeRegex(api)}\\b`);
      foundFile = solution.find((f) => regex.test(f.content));
      found = regex.test(allContent);
    }

    return {
      token: api,
      found,
      ...(foundFile ? { foundIn: foundFile.path } : {}),
    };
  });

  const tokens: TokenResult[] = expectedTokens.map((token) => {
    let regex: RegExp;
    try {
      regex = new RegExp(token, 's');
    } catch {
      regex = new RegExp(escapeRegex(token), 's');
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
