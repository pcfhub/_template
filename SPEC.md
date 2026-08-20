# __TITLE__

<!--
  SPEC.md is where findings that outlive a commit message go.

  It is not a design document written up front and it is not a changelog. It is
  what building this control taught you that the next person would otherwise
  rediscover: a platform API that turned out not to exist, a manifest shape that
  compiled but was wrong, a number you measured rather than guessed.

  The test for whether something belongs here: would somebody starting the next
  control waste an afternoon without it?

  Keep verified and unverified apart, explicitly. "The bundle is 8,773 bytes
  after the production pack" and "the harness probably reports the column type"
  are different kinds of sentence and should read differently.

  Delete the headings that have nothing under them.
-->

__TAGLINE__

## What it does

One paragraph. What it binds to, what the user can do with it, and the one
decision that shaped the implementation.

## What was verified

The commands that were actually run, and what they produced. Numbers, not
adjectives.

| Step | Result |
| --- | --- |
| `npm run check` | |
| `npm run lint` | |
| `npm run build` | `out/controls/__CONTROL__/bundle.js`, ? KiB |
| `msbuild` Release pack | production rebuild, ? bytes |

Remember that `npm run build` and the msbuild pack produce *different* bundles —
only the pack compiles in production mode. Record both sizes if you have them.

## What the build disagreed with

The draft that did not survive contact with `refreshTypes`, `tsc` or webpack.
This is usually the most valuable section, because it is the part no
documentation predicted.

## Platform behaviour worth knowing

Anything learned about `context` — an API that does not exist, metadata that is
absent in canvas, a property bag field that behaves unlike its neighbours.
Say how you know: read from the type definitions, observed in a build, or told
to you by a failing import.

## Demo

Why this `fidelity` and not the next one up. If `limited`, what is stubbed and
how you confirmed it. If `full`, what you checked to be sure nothing leaves the
browser.

## Still open

Honest list. Missing media, an environment it has not been imported into, a
claim that has not been verified. This section ageing badly is the point — it is
the to-do list the next release works from.
