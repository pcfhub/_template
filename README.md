# __TITLE__

__TAGLINE__

[![Build](https://github.com/__OWNER__/__REPO__/actions/workflows/build.yml/badge.svg)](https://github.com/__OWNER__/__REPO__/actions/workflows/build.yml)

Documentation lives on [PCFHub](https://pcfhub.dev/components/__SLUG__), built
from the `docs/` directory in this repository. Edit the Markdown here; the hub
recompiles it.

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
```

To pack the solution locally you need msbuild — either Visual Studio or the
Visual Studio Build Tools:

```bash
cd Solution
msbuild /t:build /restore /p:configuration=Release
```

Both zips land in `Solution/bin/Release`.

## Release

1. Bump the version in **three** places, in one commit — they are checked
   against each other in CI:
   - `__CONTROL__/ControlManifest.Input.xml` → `<control version="…">`
   - `Solution/src/Other/Solution.xml` → `<Version>`
   - `package.json` → `"version"`
2. Tag it: `git tag v1.2.3 && git push --tags`

The release workflow builds, packs both solution types, and attaches them to a
GitHub Release. PCFHub picks the release up from its webhook within seconds, or
from the hourly sweep otherwise.

## Repository layout

| Path | What it is |
| --- | --- |
| `__CONTROL__/` | The control: manifest, entry point, CSS, localised strings |
| `Solution/` | The Dataverse solution that packages it |
| `docs/` | The pages PCFHub publishes — see the comments in each file |
| `media/` | Images and video referenced from the docs |
| `pcfhub.json` | The hub's manifest: identity, links, docs path, demo |
| `scripts/` | Template setup and the CI guard that keeps it adopted |

## Licence

[MIT](LICENSE)
