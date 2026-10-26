# agent-skills

Personal agent configuration, synced across machines (macOS, Windows) for Claude Code and Codex.
This repo is the **source of truth**; `npx skills` projects the skills into each tool, and `apply.mjs`
merges managed instruction blocks, Claude plugins and any hooks you wrote yourself into this machine.

## Layout

```
skills/<name>/SKILL.md          one folder per skill (standard SKILL.md format; skills.sh-compatible source)
profiles/core.txt               default subset installed everywhere
profiles/all.txt                every skill in this repo
profiles/third-party.txt        external skills installed alongside: <owner/repo> <skill> [<skill> ...]
claude/settings.fragment.json   hooks you wrote yourself, merged into ~/.claude/settings.json (empty by default)
claude/CLAUDE.md                managed block appended to ~/.claude/CLAUDE.md
claude/plugins.json             marketplaces + plugin ids installed with the `claude plugin` CLI
codex/hooks.fragment.json       hook groups you wrote yourself, merged into ~/.codex/hooks.json (empty by default)
codex/AGENTS.md                 managed block appended to ~/.codex/AGENTS.md
apply/apply.mjs                 the only implementation (Node >= 22); apply.ps1 / apply.sh just call it
agent-config.json               owner, source, target agents, pinned skills CLI version
machine.local.example.json      template for ~/.agents/agent-config/machine.json (per-machine, never committed)
```

Per-machine files live outside the repo in `~/.agents/agent-config/`:
`machine.json` (per-machine values for hook placeholders), `state.json` (what apply wrote last time), `backups/`.

## New machine

Requirements: git, Node 22+, `gh auth login` for private sources.

```bash
gh repo clone clunghues/agent-skills <checkout-dir>
cd <checkout-dir>
cp machine.local.example.json ~/.agents/agent-config/machine.json          # then edit the paths
./apply.sh --dry-run        # Windows: .\apply.ps1 --dry-run
./apply.sh
```

If you add Codex hooks to the fragment, run `/hooks` once inside Codex to trust them on each machine.

Skills only, without the rest:

```bash
npx -y skills@1.7.4 add clunghues/agent-skills -g -a claude-code codex -s '*' -y
```

## Daily use

```bash
# edit in the checkout, then publish
git add -A && git commit -m "<skill>: ..." && git push

# other machines: refresh installed skills (changed content only)
npx -y skills@1.7.4 update -g

# other machines: pick up new profile entries, hook or block changes
git pull && ./apply.sh

# add a skill
mkdir -p skills/my-skill && $EDITOR skills/my-skill/SKILL.md
echo my-skill >> profiles/all.txt   # and core.txt if it should be installed everywhere
```

## How apply works

- **Skills** — runs `npx skills add ... -g` for the active profile and `third-party.txt`. The installed copy is
  `~/.agents/skills/<name>`; Claude Code gets a symlink in `~/.claude/skills`, Codex reads `~/.agents/skills`
  directly. A skill name that already comes from a different source is not installed (collision guard).
- **Prune** — skills this tool installed earlier that no active profile lists any more are **printed only**,
  with the `npx skills remove` command to run. Nothing is deleted automatically.
- **Hooks** — only hooks you wrote yourself belong here; hooks installed by apps (terminal or IDE integrations) are
  left alone and never synced. Fragment entries are rendered with `${var}` from `machine.json`. A var whose
  `requires` file is missing on this machine skips that entry. Each managed entry is matched against the object
  written last time (`state.json`): unchanged → replaced, user-modified → left alone with a warning,
  user-added entries are never touched. Hook trust in Codex is per machine and never synced.
- **Managed blocks** — `<!-- BEGIN agent-config:personal -->` … `<!-- END -->` in `~/.claude/CLAUDE.md` and
  `~/.codex/AGENTS.md`. Text outside the block is preserved.
- **Claude plugins** — marketplaces and plugin ids missing from `~/.claude/plugins/*.json` are installed with the
  `claude plugin` CLI. Codex plugins are not automated (enabling in config.toml does not install them).
- Second run with the same inputs and unchanged upstream produces no diff.

## Rules

- Never edit `~/.agents/skills`, `~/.claude/skills` or `~/.codex/skills` directly. Change the repo and re-apply.
- Skill names must be unique across this repo, `third-party.txt` and any other repo you install; Codex shows duplicates twice.
- No secrets, tokens or environment-specific settings here. Those belong in a private repo or `machine.json`.
- Pinning a third-party skill to a version is done by vendoring it into `skills/` (keep its license), not by the CLI.

