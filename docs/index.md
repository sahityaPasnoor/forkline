---
layout: home

hero:
  name: "Forkline"
  text: "Orchestrate agents. Do not replace them."
  tagline: "Forkline is a local control plane for running many coding agents in isolated Git worktrees."
  image:
    src: /logo.svg
    alt: Forkline logo
  actions:
    - theme: brand
      text: Why Forkline
      link: /#why-forkline
    - theme: alt
      text: Install + Launch
      link: /guide/getting-started
    - theme: alt
      text: Core API
      link: /reference/core-api
---

<div id="why-forkline" class="why-focus">
  <p class="why-kicker">Why Forkline</p>
  <h2>Forkline is not another agent app.</h2>
  <p>
    Keep your existing agent CLI, model choice, and Git workflow. Forkline adds the operator layer for parallel
    execution, approvals, blocked-task handling, and persistent runtime state.
  </p>
</div>

<div class="why-grid">
  <article class="why-card">
    <h3>What stays the same</h3>
    <p>Your agent commands, your repository, your local machine, your Git branching model.</p>
  </article>
  <article class="why-card">
    <h3>What Forkline adds</h3>
    <p>Spawn, monitor, approve, merge, delete, and restore many tasks in one place.</p>
  </article>
  <article class="why-card">
    <h3>Supported CLI agents</h3>
    <p>Auto-detected commands: <code>claude</code>, <code>gemini</code>, <code>codex</code>, <code>aider</code>, <code>amp</code>.</p>
    <p>Only these commands appear in the Forkline agent selector.</p>
  </article>
</div>

## Why This Is Different

<div class="diff-stack">
  <article class="diff-row">
    <h3>Agent app or plugin</h3>
    <p><strong>Best at:</strong> one active coding loop.</p>
    <p><strong>Forkline adds:</strong> multi-agent orchestration across isolated worktrees with one operator view.</p>
  </article>
  <article class="diff-row">
    <h3>Raw terminal + <code>git worktree</code></h3>
    <p><strong>Best at:</strong> manual flexibility.</p>
    <p><strong>Forkline adds:</strong> structured task lifecycle, approval inbox, and persistent fleet/session state.</p>
  </article>
  <article class="diff-row">
    <h3>Agent framework/SDK</h3>
    <p><strong>Best at:</strong> building custom agent systems.</p>
    <p><strong>Forkline adds:</strong> ready local operator runtime for day-to-day coding operations.</p>
  </article>
</div>

## Install + Launch

Package status (as of February 25, 2026): the `forkline` npm package is not published yet.

Use source mode:

```bash
npm ci
npm run dev
```

Use a local npm tarball build (production-style simulation):

```bash
npm ci
npm pack
npm install -g --offline ./forkline-<version>.tgz
forkline-core
forkline
```

## Start Here

- Install and run: [/guide/getting-started](/guide/getting-started)
- Daily workflow: [/guide/how-to-use](/guide/how-to-use)
- Full technical dossier: [/guide/project-dossier](/guide/project-dossier)
- API contract: [/reference/core-api](/reference/core-api)
