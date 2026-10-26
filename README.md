# agent-skills

Personal agent configuration for Claude Code and Codex, synced across machines (macOS, Windows) with one command.
This repo is the **source of truth**: `npx skills` installs the skills into each tool, and `apply.mjs` installs
Claude plugins, manages instruction blocks in `CLAUDE.md` / `AGENTS.md`, and merges any hooks you wrote yourself.

```bash
npx -y github:clunghues/agent-skills
```

## Layout

```
skills/<name>/SKILL.md          one folder per skill (standard SKILL.md format; skills.sh-compatible source)
profiles/core.txt               skills from this repo installed by default
profiles/all.txt                every skill in this repo
profiles/third-party.txt        skills from other repos, installed with `npx skills`: <owner/repo> <skill> [<skill> ...]
claude/plugins.json             Claude Code marketplaces + plugin ids, installed with the `claude plugin` CLI
claude/CLAUDE.md                managed block appended to ~/.claude/CLAUDE.md
claude/settings.fragment.json   hooks you wrote yourself, merged into ~/.claude/settings.json (empty by default)
codex/AGENTS.md                 managed block appended to ~/.codex/AGENTS.md
codex/hooks.fragment.json       hook groups you wrote yourself, merged into ~/.codex/hooks.json (empty by default)
apply/apply.mjs                 the only implementation (Node >= 22)
apply.ps1, apply.sh             thin wrappers around apply.mjs for a local checkout
package.json                    exposes apply.mjs as the `agent-config` bin, so `npx github:...` runs it
agent-config.json               owner, source repo, target agents, pinned skills CLI version
machine.local.example.json      template for ~/.agents/agent-config/machine.json (per-machine, never committed)
```

Per-machine files live outside the repo in `~/.agents/agent-config/`:
`machine.json` (values for hook placeholders), `state.json` (what apply wrote last time), `backups/`.

## What is recorded where

The unit of record is the unit of installation.

| Installed how | Recorded as | Example |
|---|---|---|
| Written by me | folder in `skills/` + name in `profiles/*.txt` | `sync-agent-config` |
| `npx skills add owner/repo -s name` | one line in `profiles/third-party.txt` | `vercel-labs/skills find-skills` |
| `claude plugin install id` | one id in `claude/plugins.json` (its skills, commands, agents and hooks come with it) | `codex@openai-codex` |

Not recorded, on purpose: skills synced from a claude.ai account (`~/.claude/skills/synced`), project-level
`.claude/skills` (owned by that project's git), hooks installed by apps such as terminal or IDE integrations,
Codex plugins (enabling them in `config.toml` does not install them), and all caches, sessions and trust state.

## New machine

Requirements: git, Node 22+, Claude Code logged in once (for the plugin step), `gh auth login` for private sources.
No checkout is needed; npx fetches this repo and runs `apply.mjs` from it.

```bash
mkdir -p ~/.agents/agent-config
curl -fsSL https://raw.githubusercontent.com/clunghues/agent-skills/main/machine.local.example.json -o ~/.agents/agent-config/machine.json
npx -y github:clunghues/agent-skills --dry-run
npx -y github:clunghues/agent-skills
```

Open a new `claude` / `codex` session afterwards. If you add Codex hooks to the fragment, run `/hooks` once inside
Codex to trust them on each machine.

Skills only, without the rest:

```bash
npx -y skills@1.7.4 add clunghues/agent-skills -g -a claude-code codex -s '*' -y
```

## Daily use

```bash
# other machines: refresh installed skills (changed content only)
npx -y skills@1.7.4 update -g

# other machines: pick up new profile entries, plugins, hooks or block changes
npx -y github:clunghues/agent-skills

# editing: clone once, change, publish
gh repo clone clunghues/agent-skills && cd agent-skills
mkdir -p skills/my-skill && $EDITOR skills/my-skill/SKILL.md
echo my-skill >> profiles/all.txt            # and core.txt if it should be installed everywhere
echo "owner/repo some-skill" >> profiles/third-party.txt   # a skill from another repo
./apply.sh --dry-run                         # apply from the checkout while iterating
git add -A && git commit -m "my-skill: ..." && git push
```

A Claude Code plugin is added by editing `claude/plugins.json` (marketplace source + plugin id).

## apply options

```
--dry-run, -n        print what would run or be written, change nothing
--profile <name>     profile from profiles/ (default: machine.json profiles.personal, else core)
--no-third-party     skip profiles/third-party.txt
--skip a,b           skip steps: skills, hooks, blocks, plugins
--source <src>       install own skills from another source, e.g. a local checkout path
--repo <path>        apply a different repo with the same layout
```

## How apply works

- **Skills** — runs `npx skills add ... -g` for the active profile and `third-party.txt`. The installed copy is
  `~/.agents/skills/<name>`; Claude Code gets a symlink (a junction on Windows) in `~/.claude/skills`, Codex reads
  `~/.agents/skills` directly. A skill name that already comes from a different source is not installed.
- **Prune** — skills this tool installed earlier that no active profile lists any more are **printed only**,
  with the `npx skills remove` command to run. Nothing is deleted automatically.
- **Hooks** — only hooks you wrote yourself belong here; hooks installed by apps are left alone and never synced.
  Fragment entries are rendered with `${var}` from `machine.json`. A var whose `requires` file is missing on this
  machine skips that entry. Each managed entry is matched against the object written last time (`state.json`):
  unchanged → replaced, user-modified → left alone with a warning, user-added entries are never touched.
  Hook trust in Codex is per machine and never synced.
- **Managed blocks** — `<!-- BEGIN agent-config:personal -->` … `<!-- END -->` in `~/.claude/CLAUDE.md` and
  `~/.codex/AGENTS.md`. Text outside the block is preserved.
- **Claude plugins** — marketplaces and plugin ids missing from `~/.claude/plugins/*.json` are installed with the
  `claude plugin` CLI. Already installed ones are skipped.
- Every rewritten file is backed up to `~/.agents/agent-config/backups/` first. A second run with the same inputs
  and unchanged upstream produces no diff.

## Rules

- Never edit `~/.agents/skills`, `~/.claude/skills` or `~/.codex/skills` directly. Change the repo and re-apply.
- Skill names must be unique across this repo, `third-party.txt` and any other repo you install; Codex shows duplicates twice.
- No secrets, tokens or environment-specific settings here. Those belong in a private repo or `machine.json`.
- Pinning a third-party skill to a version is done by vendoring it into `skills/` (keep its license), not by the CLI.
