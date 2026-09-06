# Public Project Agent Rules

<!-- hackathon-project-setup:superpowers-boundary:start -->
## Internal Superpowers artifacts are forbidden

This directory is the public/submittable Git repository. Never create, copy, stage, or commit internal Superpowers-generated specs, implementation plans, brainstorming notes, verification plans/reports, or other agent-internal planning documents anywhere in this repository.

Write those artifacts only in the private parent workspace at `../superpowers/`. If any internal artifact appears here, move it to `../superpowers/recovered/<project-dir>/` while preserving its contents and relative path; do not delete it. Paths including `.superpowers/`, `superpowers/`, `docs/superpowers/`, `docs/plans/`, `docs/specs/`, `docs/brainstorming/`, and `docs/verification/` are forbidden here.

The public `docs/` directory is reserved exclusively for user-facing project documentation intended for publication or hosting (for example, Mintlify). `.gitignore` entries are defense in depth, not permission to place internal artifacts in this repo. Never force-add an ignored internal artifact.
<!-- hackathon-project-setup:superpowers-boundary:end -->
