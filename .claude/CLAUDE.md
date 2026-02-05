# Claude Configuration

This directory manages configuration and documentation for Claude Code integration.

## Directory Structure

```
.claude/
├── CLAUDE.md           # This file - project instructions
├── TODO.md             # Structured task management
├── settings.local.json # Local settings (git-ignored)
├── specs/              # Design specifications
│   ├── README.md
│   └── templates/      # Spec templates
├── bugs/               # Bug tracking
│   └── *.md           # Active bug reports
└── solutions/          # Resolved bug documentation
    └── *-fix.md       # Solution records
```

## specs/ Directory

Contains design specifications and architectural decisions.

### Purpose
- Feature specifications
- Design decisions (ADR format)
- Technical requirements

### Naming Convention
- `{feature-name}-spec.md` for feature specs
- `{topic}-decision.md` for design decisions

## bugs/ Directory

Tracks active bugs and issues.

### Purpose
- Document bug symptoms
- Track reproduction steps
- Record investigation notes

### Naming Convention
- `{descriptive-name}.md`

## solutions/ Directory

Records solutions for resolved bugs.

### Purpose
- Document fix details
- Explain root cause
- Serve as reference for similar issues

### Naming Convention
- `{problem-description}-fix.md`

## TODO.md

Centralized task management with priority levels:
- P0: Critical (blocking issues)
- P1: High (important features/fixes)
- P2: Medium (normal priority)
- P3: Low (nice to have)

Categories: feature | bugfix | refactor | docs | test | chore
