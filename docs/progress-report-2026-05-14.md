# WP Gym RL Environment Progress Report - 2026-05-14

This report summarizes the evaluation, implementation work, remote experiment
workflow, and continuing analysis loop for `wp-gym` as of 2026-05-14 15:44 UTC
(2026-05-14 08:44 America/Vancouver).

## Executive Summary

`wp-gym` is now a stronger WordPress task-evaluation harness than it was at the
start of this review. The main progress is not that it is benchmark-ready, but
that it now fails closed more reliably, exposes calibration and reward-hacking
risks more explicitly, and has a remote continuous reviewer loop producing
repeatable evidence and patches without requiring GitHub write access from the
remote machine.

The current branch is:

- Branch: `danluu/rl-env-review-checkpoint-003`
- Latest reviewed commit: `3e51aef9521963eef133cce4a03f4d6002061138`
- Remote host: `danluu-fuzzer.cis251402.projects.jetstream-cloud.org`
- Remote checkout: `/home/exouser/dev/rl/wp-gym`
- Continuous loop root: `/home/exouser/wp-gym-continuous`

The strongest conclusion from the reviewer loops remains: `wp-gym` is useful as
a pilot harness and corpus, but should not be presented as a world-class
benchmark or headline RL environment until it has calibrated baselines, live
replay evidence, runner attestations, broader adversarial fixtures, and a
well-defined offline/local experiment path.

## Implemented Changes

Two local commits were produced and pushed to `danluu/wp-gym` during this
review sequence.

### `26a1772` - Fail-Closed Benchmark And Fixture Integrity Gates

This checkpoint added the first major set of benchmark-safety gates:

- Added fail-closed benchmark behavior for pilot/demo task sets.
- Added episode artifact validation and hash checks.
- Hardened workspace policy validation.
- Added an executable reward-hacking fixture for the pricing task.
- Fixed workflow setup for `setup-node` and `npm ci`.

The important behavior is that `BENCHMARK_MODE=1 TASK_SET=first-live-run
node scripts/resolve-live-run-matrix.mjs --check` exits nonzero while the task
set is still pilot/demo and uncalibrated.

### `3e51aef` - Offline Artifact And Reward Validation Hardening

The second checkpoint integrated the best patches from the no-write remote
review loop:

- Fixed stale `homeboy.json` self-check fixture paths.
- Added a positive control reward fixture for the pricing task, so the offline
  harness proves both that a shortcut fails and that meaningful editable content
  passes.
- Tied adversarial reward fixtures to declared `calibration.known_shortcuts`.
- Made declared known shortcuts block benchmark eligibility.
- Hardened episode artifact validation against path traversal.
- Required replayable top-level artifacts in episode results:
  `transcript`, `replay_bundle`, and `episode_jsonl`, with `workspace_diff`
  required for workspace tasks.
- Required terminal-grader scenarios to end with a grader step.
- Tightened `schemas/episode-result.schema.json` around artifact hashes and
  replay artifact presence.

Verification after this commit:

- `npm test`: pass
- `npm run reward-fixtures:validate`: pass with 2 reward-hacking fixtures
- `npm run episode:validate`: pass with 1 valid and 7 invalid fixtures
- Homeboy JSON self-check command: pass

## Remote Machine Setup

The remote machine was configured as a sustained experiment host.

Installed or verified:

- `tmux` 3.4
- `git`
- `gh` (not authenticated)
- Node.js and `npm`
- `ripgrep`, `jq`, `python3`, `pipx`
- PHP CLI and required PHP extensions
- Codex CLI under `~/.npm-global/bin/codex`

Remote Codex smoke tests passed:

- A single Codex run returned expected output.
- 15 independent Codex sessions launched under tmux, ran independently, and
  wrote reports with return code 0.

## Live GitHub Actions Attempt

The first live-run workflow was launched under:

- Loop root: `/tmp/wp-gym-live-loop-001`
- Experiment artifacts: `/tmp/wp-gym-live-loop-001/experiments`
- Reviewer artifacts: `/tmp/wp-gym-live-loop-001/reviews`

Results:

- `npm test`: pass
- `first-live-run` matrix: 6 rows
- Benchmark mode: failed closed with rc 1, as expected
- Reviewer split: 15 reports, 0 reviewer failures
- Remaining `wpgym-live-*` sessions: 0

The true GitHub Actions live dispatch did not occur because `gh` was not
authenticated on the remote:

```text
blocked: gh is not authenticated on remote; live workflow dispatch was not attempted
```

This is not a blocker for remote experimentation in general. It is only a
blocker for the path that creates GitHub workflow runs and runner-owned PRs from
the remote. The remote now uses a no-write policy: run experiments and produce
patches on the remote, then fetch and push from the local trusted checkout.

## No-Remote-Write Review Loop

After determining that remote GitHub write access was unnecessary for continued
progress, a no-write loop was run under:

- Loop root: `/tmp/wp-gym-nowrite-loop-001`
- Archive: `/tmp/wp-gym-nowrite-loop-001.tar.gz`
- Local fetched copy: `.remote-artifacts/wp-gym-nowrite-loop-001.tar.gz`

Each reviewer got its own temporary clone and wrote:

- `reviews/logs/<persona>.log`
- `reviews/reports/<persona>.md`
- `reviews/reports/<persona>.rc`
- `reviews/reports/<persona>.status`
- `reviews/patches/<persona>.patch`

Results:

- 15/15 xhigh Codex reviewer/workers completed.
- 0 reviewer failures.
- 15 nonempty patch files.
- The coherent subset was integrated locally and pushed as `3e51aef`.

The no-write loop found several useful issues:

- `homeboy.json` self-checks referenced deleted invalid fixtures.
- The reward-hacking fixture harness only tested a bad shortcut and lacked a
  positive solvability control.
- Known reward shortcuts were metadata-only and did not automatically block
  benchmark eligibility.
- Episode artifacts needed path-traversal protection.
- Terminal-grader episodes needed to prove that the grader was actually the
  terminal step.
- Replay and JSONL artifacts needed stronger schema and validator requirements.

## Continuous Remote Loop

A continuous loop is now running on the remote machine.

Supervisor:

- `tmux` session: `wpgym-loop-manager`
- Script: `/home/exouser/wp-gym-continuous/bin/manager.sh`

Monitor:

- `tmux` session: `wpgym-monitor`
- Script: `/home/exouser/wp-gym-continuous/bin/monitor.sh`
- Latest status: `/home/exouser/wp-gym-continuous/state/monitor-latest.txt`
- JSONL history: `/home/exouser/wp-gym-continuous/state/monitor.jsonl`

Cycle runner:

- Script: `/home/exouser/wp-gym-continuous/bin/run-cycle.sh`
- Run directories: `/home/exouser/wp-gym-continuous/runs/<cycle-id>/`
- Archives: `/home/exouser/wp-gym-continuous/runs/<cycle-id>.tar.gz`

Each cycle:

1. Fast-forwards the remote checkout when clean.
2. Runs `npm ci`.
3. Runs `npm test`.
4. Resolves and checks the `first-live-run` matrix.
5. Runs benchmark-mode check and expects nonzero while pilot/demo.
6. Runs reward fixture validation.
7. Runs episode validation.
8. Launches 15 independent xhigh Codex reviewer/workers in tmux.
9. Writes logs, reports, status files, and patches.
10. Archives the cycle.
11. Waits five minutes and starts the next cycle.

Fault recovery that has been verified:

- The monitor restarts the manager if the manager tmux session dies.
- A deliberate manager-kill test was performed; the monitor restarted it at
  `2026-05-14T08:50:33Z` and the next cycle launched correctly.
- The manager times out long cycles and kills orphaned `wpgym-cycle-*` sessions.
- `npm ci` failure triggers an `npm cache verify` retry.
- Gate failures are fed into the next reviewer prompts.

As of 2026-05-14 15:44 UTC:

- Completed continuous cycles: 41
- Completed archives: 41
- Latest completed cycle: `20260514T153555Z`
- Latest archive:
  `/home/exouser/wp-gym-continuous/runs/20260514T153555Z.tar.gz`
- Latest cycle status:
  - `npm test rc`: 0
  - reward fixture rc: 0
  - episode validation rc: 0
  - benchmark mode rc: 1, expected while pilot/demo
  - reviewer reports: 15 / 15
  - reviewer failures: 0
  - nonempty patches: 15

The latest 12 completed cycles all had:

- `npm test rc`: 0
- reviewer reports: 15 / 15
- reviewer failures: 0
- nonempty patches: 15

## Reviewer Split

The recurring reviewer set is:

- `rich-sutton`
- `sergey-levine`
- `pieter-abbeel`
- `costa-huang`
- `david-silver`
- `stefano-albrecht`
- `michael-littman`
- `dan-luu`
- `contrarian`
- `contrarian-minimalist`
- `contrarian-adversarial`
- `contrarian-ops`
- `contrarian-product`
- `contrarian-calibration`
- `contrarian-reward-hacking`

These jobs run on the remote box, not locally. For cycle `20260514T153555Z`,
the latest run wrote:

- Prompts:
  `/home/exouser/wp-gym-continuous/runs/20260514T153555Z/reviews/prompts/`
- Logs:
  `/home/exouser/wp-gym-continuous/runs/20260514T153555Z/reviews/logs/`
- Reports:
  `/home/exouser/wp-gym-continuous/runs/20260514T153555Z/reviews/reports/`
- Patches:
  `/home/exouser/wp-gym-continuous/runs/20260514T153555Z/reviews/patches/`
- Temporary worktrees:
  `/home/exouser/wp-gym-continuous/runs/20260514T153555Z/reviews/workdirs/`

The loop does not currently auto-sync these archives back to local. Earlier
archives were fetched manually with `scp`. The next operational improvement
should be a local pull job that periodically copies new remote archives into
`.remote-artifacts/continuous/` for triage.

## Analysis Themes From Reviewers

The persona and contrarian reviews converged on a few major themes.

### Difficulty Calibration

The environment should not be trusted as an RL benchmark unless tasks are in a
useful difficulty band. Too-easy tasks can be solved by weak models or shortcuts;
too-hard tasks produce little learning signal. Current manifests expose
`difficulty_band`, `baseline_result_sets`, and benchmark blockers, but the first
task set is still deliberately pilot/demo.

Progress:

- Benchmark mode now fails closed.
- Missing baselines and uncalibrated difficulty remain explicit blockers.
- Known shortcuts now block benchmark eligibility.

Still missing:

- Multi-model baseline result sets.
- Repeated-run variance measurements.
- Success-rate bands by task and model tier.
- Promotion criteria for moving from demo/pilot to benchmark-ready.

### Reward Hacking

Reviewers repeatedly flagged reward hacking as the biggest risk. The current
environment now has executable adversarial fixtures and positive controls, but
coverage is still narrow.

Progress:

- Pricing empty-block-skeleton shortcut fails as an executable fixture.
- Meaningful pricing content passes as a positive control.
- Adversarial fixtures are tied to `calibration.known_shortcuts`.
- Known shortcuts block benchmark eligibility.

Still missing:

- Keyword-stuffing fixtures for site and block tasks.
- Hard-coded clean-site-state fixtures for API tasks.
- Source-string lifecycle spoofing fixtures.
- Broader negative controls for visual/editability quality.

### Replay And Attestation

Reviewers were consistent that model output is not enough. A useful RL/eval
environment must preserve replayable evidence of actions, observations, hidden
grading, runner policy, and workspace diffs.

Progress:

- Episode validation now requires replay-oriented artifacts.
- Artifact hashes are checked.
- Local artifact path traversal is rejected.
- Terminal grader must be the terminal step for terminal-grader tasks.

Still missing:

- Live runner attestation from GitHub Actions / Homeboy.
- Non-workspace action replay evidence.
- Provider-call metadata and failure modes.
- Automated sync of remote archives into local triage.

### Offline And No-Write Workflow

The initial assumption that the remote needed GitHub write access was wrong.
Remote write access is only required for the GitHub Actions / generated-PR
surface. The no-write loop is effective for continuous analysis and patch
generation.

Progress:

- Remote workers run without GitHub auth.
- Artifacts and patches are archived per cycle.
- Local checkout remains the trusted place for applying patches and pushing.

Still missing:

- Automated local archive sync.
- Automated patch deduplication and ranking.
- A stable local audit command that summarizes a remote cycle archive.

## Latest Patch Directions

The latest cycle produced patches in these areas:

- Remote artifact URI handling in episode validation.
- JSONL artifact validation.
- Keyword/block-stuffing adversarial fixtures for pricing tasks.
- Stronger block-markup graders for semantic content and pricing content.
- Workspace policy hardening.
- Additional invalid episode fixtures for wrong artifact roots and missing
  summaries.

These patches have not yet been triaged or integrated. They should be fetched,
deduplicated against prior changes, and applied selectively with local tests.

## Findings From Latest Completed Review Cycle

The latest completed cycle inspected for this report was
`20260514T153555Z`. It produced 15 reviewer reports, 0 reviewer failures, and
15 nonempty patches. The findings below are from those reviewer reports and
patches.

### Replay Artifacts Can Still Be Too Weak

Multiple reviewers independently found variants of the same offline auditability
problem: required artifacts can be shaped in ways that satisfy high-level fields
without guaranteeing local replay evidence.

Concrete findings:

- Required audit artifacts such as `transcript`, `replay_bundle`, and
  `episode_jsonl` can be remote URLs in some proposed paths unless the validator
  rejects URI schemes for required artifacts.
- Some validators skipped URI-like artifacts during local path/hash checks,
  which makes the artifact envelope look complete while leaving the actual
  replay evidence outside the archive.
- `transcript` and `episode_jsonl` were existence/hash checked, but not always
  parsed as JSONL. A hash-valid but malformed JSONL artifact could still be
  useless for replay or downstream analysis.
- Reviewers proposed negative fixtures such as `remote-artifact-uri`,
  `remote-required-replay-artifact`, `remote-replay-artifact`,
  `invalid-jsonl-artifact`, and `missing-episode-jsonl-summary`.

Implication:

The current `3e51aef` hardening is a good step, but the next patch batch should
make required replay artifacts strictly local, hash-checked, and parseable. Once
the row contract is stable, `episode_jsonl` rows should also be schema-checked
against the episode envelope rather than only parsed as JSON objects.

### Reward-Hacking Fixture Coverage Is Still Expanding

Reviewers found that declared known shortcuts still outnumber executable
fixtures. The latest cycle added concrete proposals for additional adversarial
and positive-control fixtures.

Concrete findings:

- `block-markup-no-fallback-pricing-section` declares
  `keyword_and_block_count_stuffing`, but the integrated fixture set only covers
  `empty_block_skeleton`.
- A proposed `no-fallback-pricing-keyword-block-stuffing` fixture includes the
  expected heading, block types, three columns, and buttons, while omitting
  meaningful plan content. It fails as intended with
  `missing_required_plan_content` and reward around `0.862`.
- Another proposal tightens the pricing grader with a varied-word check so
  repetitive keyword-stuffed plan copy cannot satisfy the meaningful content
  check.
- `block-markup-valid-semantic-blocks` has known shortcuts but no executable
  reward-hacking fixture coverage. One reviewer proposed a keyword-stuffing
  fixture plus a meaningful-content positive control, and tightened the grader
  to require a meaningful cookout paragraph, three preparation list items, and a
  `View menu` CTA.

Implication:

The next integration pass should prioritize one fixture per declared
`known_shortcuts` entry, plus positive controls that prove each grader is still
solvable by legitimate content. This directly addresses the "too easy / reward
hacking" failure mode raised during the review.

### Workspace Policy Has Another Potential Escape Hatch

One reviewer found a workspace-policy bypass class not covered by the current
tests: hard links.

Concrete finding:

- A writable-root file can be a hard link to a hidden/tracked file. Existing
  checks covered symlinks, special files, and path containment, but did not flag
  regular files with link count greater than one.
- The proposed patch flags `lstat.nlink > 1` as `hardlink` and adds a
  `hardlink to hidden path` regression case.

Implication:

Workspace policy should reject hard links. They are difficult to audit by path
containment alone and could let hidden grader/source content appear under an
allowed writable root.

### Current Gates Are Healthy But Not Sufficient

The latest completed cycle confirmed that the current branch is operationally
healthy:

- `npm test`: rc 0
- `npm run reward-fixtures:validate`: rc 0
- `npm run episode:validate`: rc 0
- benchmark-mode check: rc 1, expected while the task set is pilot/demo

But the reviewer patches show the gates are still incomplete. They are now good
enough to support continuous hardening, not good enough to claim the environment
is benchmark-ready.

## Current Limitations

`wp-gym` should still be described as a prototype / pilot harness, not a
world-class RL environment.

Main remaining gaps:

- No authenticated live GitHub Actions run has completed from the remote.
- No generated runner-owned PRs from live model runs are available from this
  review session.
- No calibrated task difficulty bands with baseline result distributions.
- Reward-hacking fixture coverage is still sparse relative to declared shortcuts.
- No automatic local sync of continuous-loop archives.
- No Gymnasium-style `reset`/`step` package yet.
- No large-scale score stability or inter-run variance analysis.

## Recommended Next Steps

1. Add a local archive-sync job from
   `/home/exouser/wp-gym-continuous/runs/*.tar.gz` into
   `.remote-artifacts/continuous/`.
2. Triage the latest continuous-cycle patches, starting with JSONL validation,
   remote artifact URI handling, and keyword-stuffing fixtures.
3. Add a repo-native `audit:local` command that summarizes a remote cycle
   archive without requiring GitHub auth.
4. Add adversarial fixtures for every declared `known_shortcuts` entry.
5. Run a small authenticated `dry_run=true` GitHub Actions dispatch once
   GitHub credentials are intentionally configured.
6. Only after dry-run artifacts look correct, run one constrained `dry_run=false`
   live row and inspect transcript, replay, PR body, hidden checks, and provider
   status.
7. Start collecting baseline success distributions across model tiers before
   promoting any task to benchmark-ready.
