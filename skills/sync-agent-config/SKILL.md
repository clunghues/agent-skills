---
name: sync-agent-config
description: Sync the user's personal agent configuration (skills, hooks, status line, CLAUDE.md/AGENTS.md blocks, Claude plugins) across machines from the agent-skills repo. Use when the user asks to apply, sync, update, bootstrap or check their Claude Code / Codex setup on this machine, or asks why a skill or hook is missing here.
---

# Sync agent config

The source of truth is the git repo `clunghues/agent-skills`. Other repos with the same layout can be applied with `--repo <path>`.

## Apply on this machine

1. Locate the checkout of `clunghues/agent-skills` on this machine (ask the user if unknown). If absent, clone it with `gh repo clone clunghues/agent-skills`.
2. Make sure `~/.agents/agent-config/machine.json` exists. If not, copy `machine.local.example.json` there and fill in the hook binary paths for this machine. Hooks whose `requires` file is missing are skipped, never written.
3. Preview, then apply:

```bash
node apply/apply.mjs --dry-run
node apply/apply.mjs
```

   On Windows `.\apply.ps1`, on macOS/Linux `./apply.sh` wrap the same script.
4. If Codex hooks changed, tell the user to run `/hooks` inside Codex on this machine to trust them. Trust state is per machine and is never synced.

## Update skills only

```bash
npx -y skills@1.7.4 update -g
```

Skills newly added to a profile need a full apply, not just `update`.

## Rules

- Never edit files under `~/.agents/skills`, `~/.claude/skills` or `~/.codex/skills`; change the repo and re-apply.
- `apply.mjs` only prints prune candidates (installed but no longer in any active profile). Removal is a manual `npx skills remove <name> -g`.
- Do not put secrets, tokens or company-specific config in this public repo.
