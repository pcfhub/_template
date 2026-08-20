# __TITLE__

__TAGLINE__

[![Build](https://github.com/__OWNER__/__REPO__/actions/workflows/build.yml/badge.svg)](https://github.com/__OWNER__/__REPO__/actions/workflows/build.yml)
[![Release](https://github.com/__OWNER__/__REPO__/actions/workflows/release.yml/badge.svg)](https://github.com/__OWNER__/__REPO__/actions/workflows/release.yml)

Documentation lives on [PCFHub](https://pcfhub.dev/components/__SLUG__), built
from the `docs/` directory in this repository. Edit the Markdown here; the hub
recompiles it.

<!--
  This README is for someone standing in the repository — a maintainer, or
  somebody deciding whether to install the control. The hub publishes `docs/`,
  not this file, so do not duplicate the documentation here.

  The three sections below are the ones worth writing by hand. Everything after
  them is the same in every repository and needs no edits.
-->

## What it does

<!--
  A few paragraphs, not a feature list. Answer what the built-in control does
  not do, then spend the rest on the one or two decisions a reader would
  otherwise question — the binding shape, a behaviour that looks like a bug
  until you know why, a constraint you chose to accept.

  This is the section that saves an issue being opened.
-->

## Properties

<!--
  The whole configuration surface, including the defaults. `docs/api.md`
  generates its tables from the manifest; this one is hand-written, so keep it
  short enough to stay true.

  Follow it with the notes that do not fit a table: which languages the .resx
  ship, whether the control bundles a framework or uses the platform's, and any
  property whose accepted values need spelling out.
-->

| Property | Type | Usage | Default | What it controls |
| --- | --- | --- | --- | --- |
| `value` | SingleLine.Text | bound, **required** | — | The column this control reads and writes |

## On the hub

<!--
  What `demo.fidelity` is, and *why* it is that and not the next one up. A
  `limited` demo should say which interactions do not work there; a `full` one
  is worth explaining, because it follows from the control not reaching Web API,
  device or navigation — which is also one fewer permission prompt for the maker
  installing it.

  Mention what the presets cover. Delete this section if fidelity is `none`.
-->

## Install

Download the managed solution from the
[latest release](https://github.com/__OWNER__/__REPO__/releases/latest), or from
the component's page on the hub, and import it into your environment.

## Develop

```bash
npm install
npm start          # the PCF test harness
npm run build
npm run lint
npm run check      # what CI runs first: placeholders, pcfhub.json, control shape
```

Run `npm run refreshTypes` after every manifest edit — until you do,
`context.parameters` is typed from the old manifest and `tsc` will accept code that
cannot work.

To pack the solution locally you need msbuild — either Visual Studio or the
Visual Studio Build Tools:

```bash
cd Solution
msbuild /t:build /restore /p:configuration=Release
```

Both zips land in `Solution/bin/Release`. This is the only local step that compiles
in **production** mode, so a green `npm run build` is not evidence the shipping
bundle compiles — and the pack is incremental, so delete `obj/`, `out/`,
`Solution/obj/` and `Solution/bin/` first if you intend to quote a bundle size from
it.

## Release

1. Bump the version in **three** places, in one commit — they are checked
   against each other in CI:
   - `__CONTROL__/ControlManifest.Input.xml` → `<control version="…">`
   - `Solution/src/Other/Solution.xml` → `<Version>`
   - `package.json` → `"version"`
2. Tag it: `git tag v1.2.3 && git push --tags`

The release workflow builds, packs both solution types, and attaches them to a
GitHub Release. PCFHub picks the release up from its webhook within seconds, or
from the hourly sweep otherwise. A sync imports a draft; a person publishes it.

## Repository layout

| Path | What it is |
| --- | --- |
| `__CONTROL__/` | The control: manifest, entry point, CSS, localised strings |
| `Solution/` | The Dataverse solution that packages it |
| `SPEC.md` | What building this corrected, and what is verified versus read |
| `docs/` | The pages PCFHub publishes — see the comments in each file |
| `media/` | Images and video referenced from the docs |
| `pcfhub.json` | The hub's manifest: identity, links, docs path, demo |
| `scripts/` | Template setup and the CI guard that keeps it adopted |

## Licence

[MIT](LICENSE)
