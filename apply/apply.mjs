#!/usr/bin/env node
// apply.mjs — idempotent apply of an agent-config repo onto this machine.
//
//   node apply/apply.mjs [--repo <path>] [--profile <name>] [--source <owner/repo|path>]
//                        [--dry-run] [--no-third-party] [--skip skills,hooks,blocks,plugins]
//
// State and per-machine settings live OUTSIDE the repo in ~/.agents/agent-config/:
//   machine.json  per-machine vars (hook binary paths) — never committed
//   state.json    what this tool applied last time, per owner (used for safe re-apply)
//   backups/      copies of every file before it is rewritten

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------- args ----------
const argv = process.argv.slice(2);
const opt = { repo: null, profile: null, source: null, dryRun: false, thirdParty: true, skip: new Set() };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--repo') opt.repo = argv[++i];
  else if (a === '--profile') opt.profile = argv[++i];
  else if (a === '--source') opt.source = argv[++i];
  else if (a === '--dry-run' || a === '-n') opt.dryRun = true;
  else if (a === '--no-third-party') opt.thirdParty = false;
  else if (a === '--skip') argv[++i].split(',').forEach((s) => opt.skip.add(s.trim()));
  else if (a === '-h' || a === '--help') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n'));
    process.exit(0);
  } else fail(`unknown argument: ${a}`);
}

// ---------- paths ----------
const HOME = homedir();
const REPO = resolve(opt.repo ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const CFG = readJson(join(REPO, 'agent-config.json'));
const OWNER = CFG.owner;
const AGENTS_HOME = join(HOME, '.agents');
const TOOL_DIR = join(AGENTS_HOME, 'agent-config');
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(HOME, '.claude');
const CODEX_DIR = process.env.CODEX_HOME || join(HOME, '.codex');
const IS_WIN = process.platform === 'win32';

const machineFile = join(TOOL_DIR, 'machine.json');
const machine = existsSync(machineFile) ? readJson(machineFile) : { vars: {}, profiles: {} };
const stateFile = join(TOOL_DIR, 'state.json');
const state = existsSync(stateFile) ? readJson(stateFile) : { version: 1, skills: {}, hooks: {}, blocks: {} };
const stateBefore = JSON.parse(JSON.stringify(state));
const profile = opt.profile ?? machine.profiles?.[OWNER] ?? CFG.defaultProfile ?? 'core';

log(`repo=${REPO} owner=${OWNER} profile=${profile}${opt.dryRun ? ' (dry-run)' : ''}`);
if (!existsSync(machineFile)) warn(`no ${machineFile} — hooks that need machine vars will be skipped (see machine.local.example.json)`);

let changed = 0;
const notes = [];

// ---------- 1. skills ----------
if (!opt.skip.has('skills')) {
  const names = readList(join(REPO, 'profiles', `${profile}.txt`));
  const missing = names.filter((n) => !existsSync(join(REPO, 'skills', n, 'SKILL.md')));
  if (missing.length) warn(`profile ${profile} lists skills not in repo: ${missing.join(', ')}`);
  const own = names.filter((n) => !missing.includes(n));
  const thirdFile = join(REPO, 'profiles', 'third-party.txt');
  const third = opt.thirdParty && existsSync(thirdFile)
    ? readList(thirdFile).map((l) => { const [repo, ...skills] = l.split(/\s+/); return { repo, skills }; })
    : [];

  // name-collision check: the same skill name from a different source (in this plan or in the lock) is not installed
  const planned = new Map();
  const lock = readLock();
  const source = opt.source ?? CFG.source;
  const claim = (name, src) => {
    const lockSrc = lock.skills?.[name]?.source;
    const other = planned.get(name) ?? (lockSrc && lockSrc !== src ? lockSrc : null);
    if (other && other !== src) { warn(`skill "${name}" already comes from ${other}; not installing it from ${src}`); return false; }
    planned.set(name, src);
    return true;
  };
  const ownOk = own.filter((n) => claim(n, source));
  const thirdOk = third
    .map((t) => ({ repo: t.repo, skills: t.skills.filter((n) => claim(n, t.repo)) }))
    .filter((t) => t.skills.length);

  if (ownOk.length) skillsAdd(source, ownOk);
  for (const t of thirdOk) skillsAdd(t.repo, t.skills);

  state.skills[OWNER] = { source, profile, names: ownOk, thirdParty: thirdOk, appliedAt: new Date().toISOString() };

  // prune candidates: applied by any owner before, desired by no owner now, still present in the lock
  const allNames = (s) => [...(s.names ?? []), ...(s.thirdParty ?? []).flatMap((t) => t.skills)];
  const prevOwned = new Set(Object.values(stateBefore.skills ?? {}).flatMap(allNames));
  const desired = new Set(Object.values(state.skills).flatMap(allNames));
  const lockNow = readLock();
  const prune = [...prevOwned].filter((n) => !desired.has(n) && lockNow.skills?.[n]);
  if (prune.length) {
    notes.push(`prune candidates (not removed automatically): ${prune.map((n) => `npx -y ${CFG.skillsCli} remove ${n} -g`).join(' ; ')}`);
  }
}

// ---------- 2. hooks + statusLine ----------
if (!opt.skip.has('hooks')) {
  if (CFG.claude?.fragment) {
    const frag = readJson(join(REPO, CFG.claude.fragment));
    const file = join(CLAUDE_DIR, 'settings.json');
    const live = existsSync(file) ? readJson(file) : {};
    const before = JSON.stringify(live);
    mergeHookGroups(live, frag.hooks ?? {}, 'claude');
    if (frag.statusLine) mergeSingle(live, 'statusLine', frag.statusLine, 'claude');
    if (JSON.stringify(live) !== before) writeJsonFile(file, live);
    else log('claude settings.json: no change');
  }
  if (CFG.codex?.hooks) {
    const frag = readJson(join(REPO, CFG.codex.hooks));
    const file = join(CODEX_DIR, 'hooks.json');
    const live = existsSync(file) ? readJson(file) : {};
    const before = JSON.stringify(live);
    mergeHookGroups(live, frag.hooks ?? {}, 'codex');
    if (JSON.stringify(live) !== before) {
      writeJsonFile(file, live);
      notes.push('codex hooks changed: run /hooks inside Codex on this machine to trust them');
    } else log('codex hooks.json: no change');
  }
}

// ---------- 3. managed blocks in CLAUDE.md / AGENTS.md ----------
if (!opt.skip.has('blocks')) {
  if (CFG.claude?.managedMd) managedBlock(join(CLAUDE_DIR, 'CLAUDE.md'), readFileSync(join(REPO, CFG.claude.managedMd), 'utf8'));
  if (CFG.codex?.managedMd) managedBlock(join(CODEX_DIR, 'AGENTS.md'), readFileSync(join(REPO, CFG.codex.managedMd), 'utf8'));
}

// ---------- 4. Claude Code plugins (the CLI is the primary path) ----------
if (!opt.skip.has('plugins') && CFG.claude?.plugins && existsSync(join(REPO, CFG.claude.plugins))) {
  const p = readJson(join(REPO, CFG.claude.plugins));
  const knownFile = join(CLAUDE_DIR, 'plugins', 'known_marketplaces.json');
  const known = existsSync(knownFile) ? readJson(knownFile) : {};
  for (const [name, src] of Object.entries(p.marketplaces ?? {})) {
    if (known[name]) continue;
    run('claude', ['plugin', 'marketplace', 'add', src]);
  }
  const instFile = join(CLAUDE_DIR, 'plugins', 'installed_plugins.json');
  const installed = existsSync(instFile) ? readJson(instFile) : { plugins: {} };
  for (const id of p.plugins ?? []) {
    if (installed.plugins?.[id]) continue;
    run('claude', ['plugin', 'install', id, '-y']);
  }
}

// ---------- finish ----------
if (!opt.dryRun) {
  mkdirSync(TOOL_DIR, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
}
for (const n of notes) console.log(`NOTE ${n}`);
log(`${changed} file(s) ${opt.dryRun ? 'would be ' : ''}written`);

// =====================================================================
function skillsAdd(source, skills) {
  run('npx', ['-y', CFG.skillsCli, 'add', source, '-g', '-y', '-a', ...CFG.agents, '-s', ...skills]);
}

// Merge fragment hook groups into live.hooks[event], keyed by the object this tool applied last time.
function mergeHookGroups(live, fragHooks, target) {
  live.hooks ??= {};
  const st = ((state.hooks[target] ??= {})[OWNER] ??= {});
  const seen = new Set();
  for (const [event, groups] of Object.entries(fragHooks)) {
    groups.forEach((g, i) => {
      const id = `hook:${event}#${i}`;
      seen.add(id);
      live.hooks[event] ??= [];
      placeManaged(live.hooks[event], id, render(g), st, `${target} ${event}`);
      if (live.hooks[event].length === 0) delete live.hooks[event];
    });
  }
  // groups applied before that the fragment no longer defines: remove them if still untouched
  for (const id of Object.keys(st)) {
    if (seen.has(id) || !id.startsWith('hook:')) continue;
    const event = id.slice('hook:'.length).split('#')[0];
    const arr = live.hooks[event] ?? [];
    const idx = arr.findIndex((x) => deepEq(x, st[id].lastApplied));
    if (idx >= 0) { arr.splice(idx, 1); log(`${target} ${event}: removed stale managed hook`); }
    else warn(`${target} ${event}: stale managed hook was modified by user; left as is`);
    delete st[id];
    if (arr.length === 0) delete live.hooks[event];
  }
  if (Object.keys(live.hooks).length === 0) delete live.hooks;
}

function mergeSingle(live, key, frag, target) {
  const st = ((state.hooks[target] ??= {})[OWNER] ??= {});
  const arr = live[key] ? [live[key]] : [];
  placeManaged(arr, `key:${key}`, render(frag), st, `${target} ${key}`);
  if (arr.length) live[key] = arr[0];
  else delete live[key];
}

// arr: live array; next: rendered object or null (unresolved vars); st[id].lastApplied: what was written last time
function placeManaged(arr, id, next, st, label) {
  const prev = st[id]?.lastApplied;
  if (next === null) { warn(`${label}: skipped (machine var missing); existing entry left untouched`); return; }
  if (arr.some((x) => deepEq(x, next))) { st[id] = { lastApplied: next }; return; }
  const idx = prev ? arr.findIndex((x) => deepEq(x, prev)) : -1;
  if (idx >= 0) { arr[idx] = next; st[id] = { lastApplied: next }; log(`${label}: updated managed entry`); return; }
  if (prev) { warn(`${label}: managed entry was modified or removed by user; not touching it (delete it or restore it to re-manage)`); return; }
  arr.push(next);
  st[id] = { lastApplied: next };
  log(`${label}: added managed entry`);
}

// ${var} substitution from machine.json; null when a var is unresolved or its `requires` file is missing
function render(obj) {
  let ok = true;
  const out = JSON.parse(JSON.stringify(obj), (k, v) => {
    if (typeof v !== 'string') return v;
    return v.replace(/\$\{(\w+)\}/g, (_, name) => {
      const def = machine.vars?.[name];
      const val = typeof def === 'string' ? def : def?.value;
      if (val == null) { ok = false; return ''; }
      if (def?.requires && !existsSync(def.requires)) { ok = false; return ''; }
      return val;
    });
  });
  return ok ? out : null;
}

function managedBlock(file, content) {
  const begin = `<!-- BEGIN agent-config:${OWNER} -->`;
  const end = `<!-- END agent-config:${OWNER} -->`;
  const block = `${begin}\n${content.trim()}\n${end}`;
  const cur = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const re = new RegExp(`${esc(begin)}[\\s\\S]*?${esc(end)}`);
  let next;
  if (re.test(cur)) next = cur.replace(re, () => block);
  else next = cur ? `${cur.replace(/\s*$/, '')}\n\n${block}\n` : `${block}\n`;
  if (next === cur) { log(`${basename(file)}: block up to date`); return; }
  writeText(file, next);
}

// ---------- io helpers ----------
function run(cmd, args) {
  const shown = `${cmd} ${args.join(' ')}`;
  if (opt.dryRun) { log(`would run: ${shown}`); return; }
  log(`run: ${shown}`);
  // Windows: .cmd shims need a shell, so pass one quoted command line (args are plain tokens).
  const r = IS_WIN
    ? spawnSync([`${cmd}.cmd`, ...args].map(q).join(' '), { stdio: 'inherit', shell: true })
    : spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error || r.status !== 0) warn(`command failed (${r.status ?? r.error?.message}): ${shown}`);
}
function q(s) { return /^[\w@/.:=+-]+$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`; }
function readLock() {
  const f = join(AGENTS_HOME, '.skill-lock.json');
  return existsSync(f) ? readJson(f) : { skills: {} };
}
function readList(f) {
  return readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}
function readJson(f) { return JSON.parse(readFileSync(f, 'utf8')); }
function writeJsonFile(f, obj) { writeText(f, JSON.stringify(obj, null, 2) + '\n'); }
function writeText(f, text) {
  changed++;
  if (opt.dryRun) { log(`would write ${f}`); return; }
  mkdirSync(dirname(f), { recursive: true });
  if (existsSync(f)) {
    const b = join(TOOL_DIR, 'backups');
    mkdirSync(b, { recursive: true });
    copyFileSync(f, join(b, `${Date.now()}-${basename(f)}`));
  }
  writeFileSync(f, text);
  log(`wrote ${f}`);
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function log(m) { console.log(`[apply] ${m}`); }
function warn(m) { console.log(`[apply] WARN ${m}`); }
function fail(m) { console.error(`[apply] ERROR ${m}`); process.exit(1); }
