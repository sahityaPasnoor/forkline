# Documentation Style Guide

This project uses docs-as-code with versioned Markdown under `docs/`.

## Writing standards

- Use concise, direct language.
- Write task-first docs: setup, action, expected result.
- Prefer exact commands over abstract instructions.
- Include failure modes and troubleshooting for non-trivial flows.
- Keep examples safe for local execution.

## Required sections for new technical docs

- purpose and scope
- prerequisites
- commands/examples
- expected outputs or success criteria
- references to source files or implementation points

## API doc standards

For endpoint changes, update:

- method/path/auth requirements
- request schema and examples
- response schema and status codes
- error behavior and limits

## UX and information architecture

- Keep page titles specific.
- Keep nav stable and predictable.
- Group by user intent (`Guide`, `Architecture`, `API`, `Operations`, `Community`).

## Documentation update policy

If a PR changes runtime behavior and docs are not updated, request docs changes before merge.
