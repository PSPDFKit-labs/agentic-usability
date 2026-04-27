# Contributing

## Prerequisites

- **Node.js >= 20**

## Setup

```bash
git clone https://github.com/PSPDFKit-labs/agentic-usability.git
cd agentic-usability
npm install
npm install --prefix ui
```

## Development

```bash
# Build everything (UI + server)
npm run build

# Run server tests
npm test

# Run UI tests
npm test --prefix ui

# Typecheck server
npx tsc --noEmit

# Typecheck UI
npx tsc --noEmit --project ui/tsconfig.json

# Lint
npm run lint
```

## Before Submitting a PR

Please ensure all checks pass:

1. `npm run build` completes without errors
2. `npm test` and `npm test --prefix ui` pass
3. `npx tsc --noEmit` and `npx tsc --noEmit --project ui/tsconfig.json` pass
4. `npm run lint` passes

The CI workflow (`.github/workflows/check.yml`) runs all of these automatically on PRs.
