# wp-gym Integrated Gap Report

Generated: 2026-05-20T16:45Z

Code branch: `rl-env-review-checkpoint-003-rebase-merge-conflict`
Code branch head: `21ab74c` (`Add no-model gate to smoke CI`)
Automattic trunk base: `ebaab5b` (`ci: expose agent runtime for live runs (#90)`)
Report branch: `rl-env-review-reports`

## What Changed Since The Previous Report

The previous progress report found that the continuous loop was stable after
retargeting, and that the bottleneck had shifted from loop liveness to integrating
high-value candidates and improving disk/monitor hygiene. I integrated the
highest-confidence code changes into the merge-clean branch, pushed the branch to
the `danluu` remote, and retargeted the Jetstream2 loop to the new branch head.

Implemented changes:

- Added stricter episode fixture validation for local, hashable replay evidence:
  remote artifact URLs are rejected, all artifact entries must declare hashes, and
  workspace episodes require tool-policy and bundle attestation hashes.
- Added terminal grader artifact validation: terminal grader steps must point to a
  local grade JSON artifact whose success/reward/score/max-score agrees with the
  episode result.
- Added invalid episode fixtures covering remote artifacts, missing hashes,
  missing workspace attestation, and grade artifact mismatch.
- Added a workspace policy checker improvement for unmerged Git index paths and
  cleaned up workspace policy test temp directories.
- Hardened block reward fixtures: freeform raw HTML is now preserved by the local
  block fixture parser, nested-layout grading requires meaningful service copy,
  and new positive/negative reward-hacking fixtures cover semantic keyword
  stuffing and shallow nested content.
- Added the no-model `npm test` gate to PR smoke CI, fixed README wording around
  what the gate actually runs, and ignored local `.remote-artifacts/` output.

Validation:

- Local `npm test` passes after the changes.
- The independent analysis cycle ran 27 xhigh Codex jobs in tmux: one primary
  pass and two cross-review passes. All jobs exited rc 0.
- The code branch was pushed to `danluu/wp-gym` at `21ab74c`.
- The remote loop was retargeted to `21ab74c`; the manager and reviewer sessions
  were observed starting a fresh cycle. Root disk was down to 78% used and the
  data volume remained about 72% used. The committed monitor story is still weak:
  the existing remote `monitor.sh` did not emit useful output within a 20s timeout.

## Gaps In Automattic Trunk

Trunk is still best described as a WordPress evaluation harness and pilot task
corpus, not a world-class RL environment for model training.

The main trunk gaps are:

- No stable RL API: no Gymnasium-style package, no `reset(seed)` / `step(action)`
  contract, no typed action/observation schema, and no replay loader that labs can
  plug directly into training loops.
- No repo-owned episode result contract in trunk: live run evidence is centered on
  runner PRs and artifacts, but trunk lacks a canonical local schema tying scenario
  hashes, environment, steps, reward, provenance, transcript, replay, grade, and
  artifact hashes together.
- Weak offline audit: trunk does not prove that replay evidence is local,
  hashable, complete, or consistent with terminal grader output.
- Workspace isolation is too declarative: scenario manifests list writable roots
  and hidden paths, but trunk lacks the stronger local checker and reward-time
  policy failure path now present on the branch.
- Reward-hacking coverage is narrow: known shortcuts are declared in manifests,
  but trunk has only a small fixture set and does not systematically test cheap
  high-score paths such as keyword stuffing, shallow block shells, clean-state API
  spoofing, or hidden-path manipulation.
- Difficulty calibration is absent: scenarios remain demo/pilot, with empty
  `baseline_result_sets`, uncalibrated difficulty, no no-op/heuristic/human/model
  baseline distributions, and no confidence intervals. This directly leaves the
  environment exposed to the common failure modes of being too easy, too hard, or
  separable only by reward hacks.
- Benchmark legitimacy is not established: the task set is pilot-scale, task
  diversity is small, there are no held-out/private variants or contamination
  controls, and there is no buyer-facing result registry with variance, cost, and
  artifact retention guarantees.
- Live execution remains dependent on mutable external refs and runner behavior,
  so benchmark reproducibility is not sealed.

## How The Branch Addresses Those Gaps

The branch materially improves the pilot harness, especially around honesty,
audit scaffolding, and reward-hacking checks.

What is substantially better:

- Benchmark claims fail closed. The repo and task set now explicitly say the
  current suite is pilot/non-headline, and `BENCHMARK_MODE=1` rejects non-ready
  rows instead of allowing accidental aggregate scores.
- Episode audit scaffolding exists. The new episode schema and validator check
  manifest/prompt/grader hashes, environment equality, reward normalization,
  success threshold consistency, failure reasons, actor/tool allowlists, required
  replay artifacts, local artifact paths, artifact hashes, terminal grader
  presence, and partial terminal grade artifact agreement.
- Remote/unverifiable artifacts are no longer accepted by fixture validation.
  This closes a concrete auditability hole where an episode could point to a URL
  rather than preserving local replay evidence.
- Workspace policy is much stronger locally. The checker catches non-writable and
  hidden path changes, symlinks, gitlinks, ignored files, nested Git metadata,
  special files, mode changes, and unmerged index states. Modern API graders also
  zero reward on workspace policy failure.
- Reward-hacking fixtures are more meaningful. The branch adds executable
  positive and adversarial fixtures for semantic block content and nested layout
  service copy, and the fixture parser now exposes freeform raw HTML to graders.
- PR smoke CI now runs the no-model validation gate before the Homeboy smoke task,
  so schema/fixture regressions are caught earlier.
- Runtime pinning is more consistent: the Playground blueprint now aligns to
  WordPress 6.9, although this is not enough to seal all external execution refs.

This is a real improvement over trunk. It makes it harder to fool the pilot
offline checks, harder to accidentally market pilot rows as benchmark scores, and
easier to reason about replay evidence.

## Remaining Gaps In The Branch

The branch should still be treated as pilot hardening, not benchmark readiness.
The biggest remaining gaps are:

- Live artifact validation is still missing. The validator exercises fixtures, not
  arbitrary Homeboy live-run outputs. A benchmark-grade run should export a
  canonical episode row and validate it in CI before the PR/report is trusted.
- Replay is not proven. The branch validates hashes and metadata, but does not
  rebuild state from reset plus actions or workspace diffs, boot the pinned
  WordPress/PHP runtime, rerun the terminal grader, and compare the full result.
- `expected_artifacts` are not fully enforced. The validator requires transcript,
  replay bundle, episode JSONL, and workspace diff for workspace tasks, but it
  does not yet map and require every scenario-declared artifact such as
  `wordpress_state`, `rendered_site`, `plugin_files`, and `grader_result`.
- Terminal grade agreement is partial. The branch checks success, reward, score,
  and max score, but not full `checks` identity, messages, or per-check evidence.
- The episode schema is permissive. Broad `additionalProperties` and hashed action
  args are useful while iterating, but they are not a strict replayable action and
  observation envelope.
- The strong JS workspace policy checker is not yet a required live-run
  attestation. PHP reward-time checks are useful but weaker and mainly inspect
  final changed path prefixes.
- Shortcut coverage is not systematic. Existing fixtures must reference declared
  shortcuts, but every declared `known_shortcuts` entry is not required to have an
  adversarial negative and nearby positive control. Site-building and modern API
  shortcuts still need comparable executable fixture runners.
- Content tasks remain reward-hackable. Some graders still rely on topic
  substrings, required block names, heading text, or simple structure checks; those
  are useful smoke signals but not enough for robust semantic evaluation.
- Non-workspace WordPress action replay is unresolved. WordPress-state tasks still
  have no first-class browser/editor action stream, despite relying on final-state
  grading.
- Calibration remains the central blocker. There are no repeated baseline runs,
  confidence intervals, human/reference rows, no-op/heuristic baselines, or
  pass-rate bands to show that tasks are neither trivial nor impossible.
- External execution is not sealed. The live workflow still depends on mutable
  external workflow/provider refs for actual runs. Benchmark mode should pin those
  by immutable SHA or digest and record exact provider/model/tool-policy metadata.
- Operational monitoring is not yet product-grade. The remote loop runs, but the
  monitor path needs a committed heartbeat/status contract, retention policy,
  stale-session detection, disk budget, and structured error reporting.

## Recommended Next Implementation Order

1. Add a live-artifact validator that ingests real Homeboy outputs and validates
   canonical episode rows, artifact locality, hashes, and terminal grade output.
2. Enforce every scenario `expected_artifacts` entry and compare full grade JSON,
   including the `checks` array.
3. Add replay/regrade verification from reset snapshot plus action/workspace
   artifacts.
4. Run `scripts/check-workspace-policy.mjs` in the live runner and export its
   policy result and hash as required episode evidence.
5. Add a shortcut coverage gate: every declared shortcut needs an adversarial
   negative fixture and a nearby positive control, including site-building and
   modern API tasks.
6. Build calibration baselines before promoting any score: no-op, heuristic or
   scripted reference, cheap model, frontier model, repeated attempts, and
   human/reference rows where practical.
7. Define the WordPress action/observation/replay contract before claiming a
   benchmark-grade RL interface; a Gymnasium wrapper should sit on top of that,
   not replace it.
8. Pin external workflow/action/provider refs for benchmark-mode runs, and record
   immutable runner, tool-policy, provider, model, cost, and runtime metadata.
9. Commit remote-loop operations hygiene: heartbeat JSON, disk retention policy,
   stale reviewer detection, artifact index, and clear monitor failure modes.

## Bottom Line

The branch is a substantial improvement over trunk for a pilot RL evaluation
harness. It closes several concrete audit and reward-hacking holes and makes the
project much more honest about benchmark readiness. It still should not be sold
or described as a world-class RL environment yet. The next threshold is not more
task volume; it is live-run audit ingestion, replay/regrade verification,
shortcut coverage, empirical calibration, and sealed operations.
