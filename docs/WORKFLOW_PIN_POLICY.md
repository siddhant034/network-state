# GitHub Actions pin policy

Network State's workflow pin checker intentionally accepts only a small, auditable YAML subset for action references.

- Third-party actions must use a full 40-character commit SHA.
- Local actions may use safe `./path/to/action` references.
- Action references must be plain or quoted single-line scalars.
- YAML aliases, anchors, block scalars, and flow-style mappings for `uses` are rejected rather than skipped. Rewrite these as ordinary block-style workflow steps with a literal pin.
- Keep release tags in comments for human traceability; the SHA is the actual security boundary.

The checker is dependency-free, so it does not implement the entire YAML specification. Unsupported syntax fails closed with a file and line number. When changing workflow structure, run:

```sh
npm run test:workflow-pins
node scripts/check-workflow-pins.mjs
```

CI runs both checks on pull requests and before the Pages build. This policy is a guardrail, not a substitute for reviewing an action's source, permissions, and upstream release.
