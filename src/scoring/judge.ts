import type { SolutionFile, JudgeScore, TestCase, AgentConfig, TargetConfig, Config, ProjectPaths } from '../types.js';
import { createAdapter } from '../agents/adapter.js';
import { JUDGE_SCORING_CRITERIA, extractJson } from '../commands/prompt-helpers.js';
import { SandboxClient } from '../sandbox/opensandbox.js';
import { scaffoldWorkspace, uploadSources } from '../sandbox/scaffolding.js';
import { loadBinaryResult, saveResult } from '../core/suite-io.js';
import { stampProxyTag } from '../proxy/env-rewriter.js';
import type { AuthProxyHandle } from '../proxy/auth-proxy.js';
import type { WorkerPool } from '../sandbox/worker-pool.js';

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    apiDiscovery: { type: 'number', minimum: 0, maximum: 100 },
    callCorrectness: { type: 'number', minimum: 0, maximum: 100 },
    completeness: { type: 'number', minimum: 0, maximum: 100 },
    functionalCorrectness: { type: 'number', minimum: 0, maximum: 100 },
    overallVerdict: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['apiDiscovery', 'callCorrectness', 'completeness', 'functionalCorrectness', 'overallVerdict', 'notes'],
  additionalProperties: false,
};

const SCHEMA_DESCRIPTION = `
Output ONLY a valid JSON object matching this schema:
${JSON.stringify(JUDGE_SCHEMA, null, 2)}

No markdown fences, no explanation — just the raw JSON object.`;

export function formatSolution(files: SolutionFile[]): string {
  return files
    .map((f) => `--- File: ${f.path} ---\n${f.content}`)
    .join('\n\n');
}


function validateJudgeScore(obj: unknown): string[] {
  const errors: string[] = [];
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return ['Judge output is not a JSON object'];
  }

  const score = obj as Record<string, unknown>;

  for (const field of ['apiDiscovery', 'callCorrectness', 'completeness', 'functionalCorrectness']) {
    if (typeof score[field] !== 'number' || score[field] < 0 || score[field] > 100) {
      errors.push(`${field} must be a number between 0 and 100`);
    }
  }

  if (typeof score.overallVerdict !== 'boolean') {
    errors.push('overallVerdict must be a boolean');
  }

  if (typeof score.notes !== 'string') {
    errors.push('notes must be a string');
  }

  return errors;
}


function buildSandboxedJudgePrompt(
  testCase: TestCase,
  sourceDirs: string[],
  agentNotes?: string,
): string {
  const agentNotesSection = agentNotes
    ? `\n## Agent Self-Report\nThe agent left the following notes about its process:\n\n---BEGIN AGENT NOTES---\n${agentNotes}\n---END AGENT NOTES---\n\nConsider these notes when writing your evaluation — they may explain gaps in the solution.\n`
    : '';

  const sourceSection = sourceDirs.length > 0
    ? `\n## Source Code\nThe SDK/API source code is available at:\n${sourceDirs.map((d) => `- ${d}`).join('\n')}\n\nUse these files as ground truth. When you find a difference between the generated and reference solutions, look up the relevant source code to determine whether the difference actually matters. Do not speculate — read the implementation to prove or disprove your hypothesis.\n`
    : '';

  return `You are an expert code reviewer judging an AI-generated solution's use of an SDK/API compared to a reference solution.

You are running inside a sandbox with full access to the workspace. You can and SHOULD run the generated solution to verify it actually works.

IMPORTANT:
- Focus your evaluation on SDK/API usage. Ignore cosmetic differences in variable naming, code formatting, comment style, import ordering, and output formatting.
- apiDiscovery measures whether the agent found the same APIs as the reference solution. If the agent used a different API to achieve the same goal, apiDiscovery should be scored low (different APIs were discovered), but overallVerdict can still be true if the solution actually works correctly.
- When there is a difference, do not speculate about whether it matters. Read the SDK/API source code to verify.

## Problem Statement
${testCase.problemStatement}

## Reference Solution
${formatSolution(testCase.referenceSolution)}

## Generated Solution
The generated solution files are at /workspace/solution/. Inspect and run them.
${sourceSection}${agentNotesSection}
## Your Task
1. Read the generated solution files at /workspace/solution/
2. Try to run the solution and observe the output
3. For any differences between generated and reference solutions, read the SDK/API source code to determine whether the difference is functionally significant. Do not guess — verify by reading the implementation.
4. Score on the following criteria:

${JUDGE_SCORING_CRITERIA}
${SCHEMA_DESCRIPTION}`;
}

export async function runSandboxedJudge(
  testCase: TestCase,
  generatedSolution: SolutionFile[],
  judgeConfig: AgentConfig,
  target: TargetConfig,
  config: Config,
  paths: ProjectPaths,
  agentNotes?: string,
  proxyEnv?: Record<string, string>,
  proxyHandle?: AuthProxyHandle,
  pool?: WorkerPool,
): Promise<JudgeScore> {
  const client = new SandboxClient(config.sandbox);
  const unregisterAbort = pool?.onAbort(async () => {
    await client.destroy();
  });

  try {
    const tcEnv = proxyEnv ? stampProxyTag(proxyEnv, `judge-${testCase.id}`) : undefined;
    const containerEnv = tcEnv && Object.keys(tcEnv).length > 0 ? tcEnv : undefined;
    await client.create(
      target.image,
      containerEnv,
      target.timeout ?? config.sandbox.defaultTimeout,
    );

    // Always run scaffolding first — this installs system-level deps (apt-get, global
    // pip packages, etc.) that the tarball can't capture since it only covers /workspace/.
    await scaffoldWorkspace(client, config, testCase);

    // Restore workspace files: tarball overlay if available, otherwise upload solution files
    const snapshot = await loadBinaryResult(paths, testCase.id, 'workspace-snapshot.tar.gz', target.name);
    if (snapshot) {
      // Tarball overwrites /workspace/ with the post-executor state (includes agent-created files)
      await client.uploadBinaryFile('/tmp/workspace-snapshot.tar.gz', snapshot);
      await client.runCommand('tar xzf /tmp/workspace-snapshot.tar.gz -C / && rm -f /tmp/workspace-snapshot.tar.gz');
    } else {
      // No snapshot — upload just the solution files and problem statement
      await client.uploadFiles([
        { path: '/workspace/PROBLEM.md', data: testCase.problemStatement },
      ]);
      if (generatedSolution.length > 0) {
        const solutionFiles = generatedSolution.map((f) => ({
          path: `/workspace/solution/solution__${f.path.split('/').pop()}`,
          data: f.content,
        }));
        await client.uploadFiles(solutionFiles);
      }
    }

    // Upload source code into /workspace/sources/
    const sourceDirs = await uploadSources(client, config, paths.cacheRepos);

    // Install judge agent CLI
    const adapter = createAdapter(judgeConfig);
    const installCmd = adapter.installCommand;
    if (installCmd) {
      const installResult = await client.runCommand(installCmd);
      if (installResult.exitCode !== 0) {
        throw new Error(`Judge agent install failed (exit ${installResult.exitCode}): ${installResult.stderr || installResult.stdout}`);
      }
    }

    // Build and upload the judge prompt
    const judgePrompt = buildSandboxedJudgePrompt(testCase, sourceDirs, agentNotes);
    await client.uploadFiles([
      { path: '/workspace/JUDGE_PROMPT.md', data: judgePrompt },
    ]);

    // Run judge agent in sandbox
    const agentPrompt = 'Read /workspace/JUDGE_PROMPT.md and follow its instructions exactly. Output ONLY a valid JSON object with your scores — no other text.';
    const agentCmd = adapter.sandboxCommand(agentPrompt, undefined, JUDGE_SCHEMA);
    await saveResult(paths, testCase.id, 'judge-cmd.log', agentCmd, target.name);
    const agentResult = await client.runCommandTimed(agentCmd);

    // Save judge output log
    const judgeLog = [
      `Exit code: ${agentResult.exitCode}`,
      `Duration: ${agentResult.durationMs}ms`,
      '',
      '=== STDOUT ===',
      agentResult.stdout,
      '',
      '=== STDERR ===',
      agentResult.stderr,
    ].join('\n');
    await saveResult(paths, testCase.id, 'judge-output.log', judgeLog, target.name);

    // Parse judge output — unwrap agent-specific envelope first (e.g. Claude's
    // structured_output, Gemini's response field), then extract the JSON object.
    const unwrapped = adapter.extractResult(agentResult.stdout);
    const extracted = extractJson(unwrapped, 'object');
    let parsed: unknown;
    try {
      parsed = JSON.parse(extracted);
    } catch (err) {
      throw new Error(`Judge output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    const validationErrors = validateJudgeScore(parsed);
    if (validationErrors.length > 0) {
      throw new Error(`Judge output validation failed:\n${validationErrors.join('\n')}`);
    }

    const score = parsed as Record<string, unknown>;

    return {
      testId: testCase.id,
      target: target.name,
      apiDiscovery: score.apiDiscovery as number,
      callCorrectness: score.callCorrectness as number,
      completeness: score.completeness as number,
      functionalCorrectness: score.functionalCorrectness as number,
      overallVerdict: score.overallVerdict as boolean,
      notes: score.notes as string,
    };
  } finally {
    // Save proxy logs for this test case
    if (proxyHandle) {
      const tcLogs = proxyHandle.getLogsForTestCase(`judge-${testCase.id}`);
      if (tcLogs.length > 0) {
        await saveResult(paths, testCase.id, 'judge-proxy.log.json', JSON.stringify(tcLogs, null, 2), target.name);
      }
    }
    unregisterAbort?.();
    await client.destroy();
  }
}
