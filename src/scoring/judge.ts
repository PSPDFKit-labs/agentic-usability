import type { SolutionFile, JudgeScore, TestCase, SandboxAgentConfig, TargetConfig, Config, ProjectPaths, SourceConfig } from '../types.js';
import { createAdapter } from '../agents/adapter.js';
import { JUDGE_SCORING_CRITERIA, extractJson } from '../commands/prompt-helpers.js';
import { MicrosandboxClient, buildSecrets, buildAgentSecret, resolveEnv } from '../sandbox/microsandbox.js';
import { createEgressLockdownLogger } from '../sandbox/egress-logger.js';
import { scaffoldWorkspace, uploadSources } from '../sandbox/scaffolding.js';
import { deduplicateSources } from '../core/source-resolver.js';
import { loadBinaryResult, saveResult } from '../core/suite-io.js';
import type { WorkerPool } from '../sandbox/worker-pool.js';

/**
 * Hardcoded infrastructure domains the judge is always allowed to reach.
 * Modeled after the Claude Code cloud environment's trusted default allowlist.
 * See: https://docs.anthropic.com/en/docs/claude-code/cloud#default-allowed-domains
 */
const INFRA_ALLOWLIST = [
  // ── Version control ──
  'github.com', '*.github.com', '*.githubusercontent.com',
  'gitlab.com', '*.gitlab.com',
  'bitbucket.org', '*.bitbucket.org',

  // ── Container registries ──
  '*.docker.io', '*.docker.com', 'production.cloudflare.docker.com',
  'ghcr.io', 'gcr.io', '*.gcr.io',
  'mcr.microsoft.com', '*.data.mcr.microsoft.com',
  'public.ecr.aws', 'quay.io',

  // ── JavaScript / Node ──
  'registry.npmjs.org', 'npmjs.com', '*.npmjs.com', 'npmjs.org', '*.npmjs.org',
  'yarnpkg.com', 'registry.yarnpkg.com',
  'nodejs.org', '*.nodejs.org',
  'bower.io',

  // ── Python ──
  'pypi.org', '*.pypi.org', 'files.pythonhosted.org', 'pythonhosted.org',
  'pypi.python.org', 'pypa.io', '*.pypa.io',

  // ── Ruby ──
  'rubygems.org', '*.rubygems.org',
  'ruby-lang.org', '*.ruby-lang.org',
  'rubyforge.org', '*.rubyforge.org',
  'rubyonrails.org', '*.rubyonrails.org',
  'rvm.io', 'get.rvm.io',

  // ── Rust ──
  'crates.io', '*.crates.io',
  'rustup.rs', 'static.rust-lang.org', '*.rust-lang.org',

  // ── Go ──
  'proxy.golang.org', 'sum.golang.org', 'index.golang.org',
  'golang.org', '*.golang.org', 'goproxy.io', 'pkg.go.dev',

  // ── JVM (Maven, Gradle, Kotlin, Spring) ──
  'maven.org', '*.maven.org', 'repo.maven.apache.org',
  'jcenter.bintray.com',
  'gradle.org', '*.gradle.org',
  'kotlinlang.org', '*.kotlinlang.org',
  'spring.io', 'repo.spring.io',

  // ── PHP ──
  'packagist.org', '*.packagist.org',

  // ── .NET / NuGet ──
  'nuget.org', '*.nuget.org',
  'dot.net', 'dotnet.microsoft.com', 'packages.microsoft.com',
  'visualstudio.com', 'dev.azure.com',

  // ── Dart / Flutter ──
  'pub.dev', 'api.pub.dev',

  // ── Elixir / Erlang ──
  'hex.pm', '*.hex.pm',

  // ── Swift / CocoaPods ──
  'swift.org', '*.swift.org',
  'cocoapods.org', '*.cocoapods.org',

  // ── Haskell ──
  'haskell.org', '*.haskell.org',

  // ── Perl ──
  'cpan.org', '*.cpan.org',
  'metacpan.org', '*.metacpan.org',

  // ── Conda / Anaconda ──
  'repo.anaconda.com', 'conda.anaconda.org',
  'anaconda.org', 'anaconda.com', '*.anaconda.com',
  'continuum.io',

  // ── Linux distributions ──
  '*.ubuntu.com', 'ppa.launchpad.net', 'launchpad.net', '*.launchpad.net',
  '*.debian.org',
  '*.centos.org',
  '*.fedoraproject.org',
  '*.archlinux.org',
  '*.alpinelinux.org',
  '*.nixos.org',
  'apt.llvm.org',

  // ── Cloud platforms ──
  '*.googleapis.com', '*.google.com',
  '*.amazonaws.com', '*.api.aws',
  'azure.com', '*.azure.com', '*.microsoftonline.com',
  'microsoft.com', '*.microsoft.com',
  'oracle.com', '*.oracle.com',
  'java.com', '*.java.com', 'java.net', '*.java.net',

  // ── Kubernetes / HashiCorp / Apache / Eclipse ──
  'k8s.io', '*.k8s.io',
  'hashicorp.com', '*.hashicorp.com',
  'apache.org', '*.apache.org',
  'eclipse.org', '*.eclipse.org',

  // ── Dev tools ──
  'developer.apple.com', 'developer.android.com',
  'pkg.stainless.com', 'binaries.prisma.sh',

  // ── CDN / mirrors / misc ──
  'sourceforge.net', '*.sourceforge.net',
  'packagecloud.io', '*.packagecloud.io',
  'fonts.googleapis.com', 'fonts.gstatic.com',
  'json-schema.org', '*.json-schema.org',
  'json.schemastore.org', '*.schemastore.org',

  //  ── Claude Code ──
  'api.anthropic.com', 'statsig.anthropic.com',
  'docs.claude.com', 'platform.claude.com',
  'code.claude.com', 'claude.ai',
];

/**
 * Build the network allowlist for judge lockdown.
 * Combines: agent endpoint, secrets allowHosts, source URL/git hostnames, and hardcoded infra.
 */
export function buildJudgeAllowlist(judgeConfig: SandboxAgentConfig, config: Config): string[] {
  const hosts = new Set<string>();

  // 1. Agent API endpoint from secret's baseUrl
  if (judgeConfig.secret.baseUrl) {
    try { hosts.add(new URL(judgeConfig.secret.baseUrl).hostname); } catch { /* skip malformed */ }
  }

  // 2. Secrets allowHosts
  if (config.sandbox?.secrets) {
    for (const sec of Object.values(config.sandbox.secrets)) {
      for (const h of sec.allowHosts) hosts.add(h);
    }
  }

  // 3. Hostnames from URL and git sources in publicInfo + privateInfo
  const allInfoSources: SourceConfig[] = [
    ...(config.publicInfo ?? []),
    ...config.privateInfo,
  ];
  for (const src of allInfoSources) {
    if (src.type === 'url') {
      try { hosts.add(new URL(src.url).hostname); } catch { /* skip malformed */ }
    } else if (src.type === 'git') {
      try { hosts.add(new URL(src.url).hostname); } catch { /* skip malformed */ }
    }
  }

  // 4. Hardcoded infra domains
  for (const h of INFRA_ALLOWLIST) hosts.add(h);

  return [...hosts];
}

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

/** Generate a unique sandbox name for a judge run. */
function sandboxName(testId: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `au-judge-${testId}-${suffix}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
}

export async function runSandboxedJudge(
  testCase: TestCase,
  generatedSolution: SolutionFile[],
  judgeConfig: SandboxAgentConfig,
  target: TargetConfig,
  config: Config,
  paths: ProjectPaths,
  agentNotes?: string,
  pool?: WorkerPool,
): Promise<JudgeScore> {
  const client = new MicrosandboxClient(config.sandbox);
  const unregisterAbort = pool?.onAbort(async () => {
    await client.destroy();
  });

  try {
    const secrets = buildSecrets(config.sandbox?.secrets);
    const env = resolveEnv(config.sandbox?.env);
    const timeoutSecs = target.timeout ?? config.sandbox.defaultTimeout ?? 600;

    // Merge agent secret into sandbox secrets and set base URL env var
    secrets.push(buildAgentSecret(judgeConfig.secret));
    const judgeAdapter = createAdapter(judgeConfig);
    const baseUrlVar = judgeConfig.secret.baseUrlEnvVar ?? judgeAdapter.baseUrlEnvVar;
    if (baseUrlVar && judgeConfig.secret.baseUrl) {
      env[baseUrlVar] = judgeConfig.secret.baseUrl;
    }

    await client.create(
      sandboxName(testCase.id),
      target.image,
      env,
      secrets,
      timeoutSecs,
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

    // Upload source code into /workspace/sources/ — judge sees both private and public sources
    const allSources = deduplicateSources(config.privateInfo, config.publicInfo ?? []);
    const sourceDirs = await uploadSources(client, allSources, paths.cacheRepos);

    // Install judge agent CLI
    const adapter = createAdapter(judgeConfig);
    const installCmd = adapter.installCommand;
    if (installCmd) {
      const installResult = await client.runCommand(installCmd);
      if (installResult.exitCode !== 0) {
        throw new Error(`Judge agent install failed (exit ${installResult.exitCode}): ${installResult.stderr || installResult.stdout}`);
      }
    }

    // Start egress interception with allowlist enforcement — only allow judge agent's
    // API endpoint and trusted domains
    const allowedHosts = buildJudgeAllowlist(judgeConfig, config);
    const egressLogger = await createEgressLockdownLogger(client.getSandbox(), allowedHosts);

    // Build and upload the judge prompt
    const judgePrompt = buildSandboxedJudgePrompt(testCase, sourceDirs, agentNotes);
    await client.uploadFiles([
      { path: '/workspace/JUDGE_PROMPT.md', data: judgePrompt },
    ]);

    // Run judge agent in sandbox
    const agentPrompt = 'Read /workspace/JUDGE_PROMPT.md and follow its instructions exactly. Output ONLY a valid JSON object with your scores — no other text.';
    const agentCmd = adapter.sandboxCommand(agentPrompt, undefined, JUDGE_SCHEMA);
    await saveResult(paths, testCase.id, 'judge-cmd.log', agentCmd, target.name);
    const agentResult = await client.runCommandTimed(agentCmd, {
      timeoutMs: timeoutSecs * 1000,
    });

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

    // Extract judge session log
    try {
      const sessionLog = await adapter.extractLog(client);
      if (sessionLog) {
        await saveResult(paths, testCase.id, 'judge-session.jsonl', sessionLog, target.name);
      }
    } catch {
      // Non-critical — log extraction is best-effort
    }

    // Save egress logs
    const egressLogs = egressLogger.getLogs();
    if (egressLogs.length > 0) {
      await saveResult(paths, testCase.id, 'judge-egress.log.json', JSON.stringify(egressLogs, null, 2), target.name);
    }

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
    unregisterAbort?.();
    await client.destroy();
  }
}
