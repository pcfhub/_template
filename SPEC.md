# __TITLE__

<!--
  SPEC.md is where findings that outlive a commit message go.

  It is not a design document written up front and it is not a changelog. It is
  what building this control taught you that the next person would otherwise
  rediscover: a platform API that turned out not to exist, a manifest shape that
  compiled but was wrong, a behaviour you observed rather than assumed.

  The test for whether something belongs here: would somebody starting the next
  control waste an afternoon without it?

  **Three things do not belong here, and each one is a trap that looks like
  diligence:**

  - **Measurements that a build reproduces.** Bundle sizes, zip sizes, whether
    lint passed. They are stale the moment anyone builds, and a number sitting
    in git that nobody re-runs is worse than no number, because it reads as
    authoritative. Quote them in the release notes or in the pull request, where
    they are dated by construction.
  - **Anything already explained in a comment beside the code.** The comment is
    better placed: it is read by whoever is about to change the thing.
  - **Anything already promoted to the skill.** Once a finding is general enough
    to live in `references/control-patterns.md`, this file should *link* to it
    rather than repeat it — see "Promoting a finding" below.

  What is left is usually short, and short is the point. A SPEC.md nobody
  maintains is one nobody trusts.

  Delete the headings that have nothing under them.
-->

__TAGLINE__

## What the build disagreed with

The draft that did not survive contact with `refreshTypes`, `tsc` or webpack.
This is usually the most valuable section, because it is the part no
documentation predicted.

## Platform behaviour worth knowing

Anything learned about `context` — an API that does not exist, metadata that is
absent in canvas, a property bag field that behaves unlike its neighbours.

**Say how you know**, in the sentence itself: read from the type definitions,
observed on a real form, or told to you by a failing import. A finding whose
provenance is missing gets re-verified by the next person anyway, which costs
them the afternoon this file was meant to save.

## Demo

Why this `fidelity` and not the next one up. If `limited`, what is stubbed and
how you confirmed it. If `full`, what you checked to be sure nothing leaves the
browser.

## Not verified

Claims this control rests on that have not been proven, and what would prove
them. Keep it specific enough to act on: "needs a real model-driven form" is a
task, "might not work" is not.

This is the section that stops a release going out on an assumption, so it is
worth more than everything above it. It should shrink as the control matures,
and a release with entries still in it is a decision rather than an oversight.

## Promoting a finding

When something here turns out to be general — true of PCF rather than true of
this control — move it to the skill's `references/control-patterns.md` and
replace it here with a line naming where it went.

Repeating it in both places is how the two drift, and the copy nothing executes
always loses. The rule is: one home, and a pointer from anywhere else.
