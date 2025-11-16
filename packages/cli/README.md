# CLI

Proof of concept:

- Uses tsx
- Only resolves openworkflow.config.ts from project root

Production:

- Should compile with tsc
- Robustly resolve config
- Use esbuild internally to compile and then load openworkflow.config.ts
