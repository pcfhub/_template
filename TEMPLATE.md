# Using this template

This is the starting point for a PCF control published on
[PCFHub](https://pcfhub.dev). It is a working Power Apps component project plus
the three things the hub needs: `pcfhub.json`, a `docs/` directory, and a
release workflow that attaches assets under names the hub recognises.

`npm run setup` deletes this file, along with `variants/` and
`docs/migration.md` — a first release has nothing to migrate from. Everything
below is about adopting the template; everything in `README.md` is about the
component you are building, and `SPEC.md` is where you record what building it
taught you.

## Adopt it

```bash
npm run setup
```

You are asked for ten values, four of which offer a derived default. Then:

```bash
npm install
npm run build
```

**Commit the `package-lock.json` that `npm install` writes.** This template
ships none, and both workflows run `npm ci`, which fails outright without one —
so the first push of a freshly adopted repository fails for a reason that has
nothing to do with the control.

## Standard or React

The template scaffolds a standard DOM control. For a React (virtual) one:

```bash
node scripts/setup.mjs --framework react …
```

That switches `control-type` to `virtual`, adds the React and Fluent
`<platform-library>` entries, sets `pcfhub.json`'s `control.framework` to
`react_virtual`, swaps in a `ReactControl` entry point with a `components/`
directory, and adds the React devDependencies along with
`eslint-plugin-react-hooks` — without which an `eslint-disable
react-hooks/exhaustive-deps` comment fails the build for an unrelated-looking
reason.

The React version is `16.14.0` rather than `16.8.6`, and that is deliberate.
`pcf-scripts` maps any declared 16.8–16.14.0 onto the platform's 16.14.0 build,
so both work at runtime — but `@fluentui/react-components` requires
`react >=16.14.0`, and npm refuses to install the pair if the devDependency says
16.8.6.

Reach for `standard` more often than instinct suggests: one input and a button
does not earn a React tree.

## Field or dataset

The template scaffolds a control bound to one column. For one that binds a view:

```bash
node scripts/setup.mjs --type dataset …
```

That swaps in a `<data-set>` manifest and a dataset entry point, sets
`pcfhub.json`'s `control.type` to `dataset`, replaces `docs/api.md` with one
carrying `kind=dataset` instead of `kind=bound`, and drops a starter fixture in
`demo/` for the hub's demo harness to render.

It composes with `--framework`, and **all four combinations are supported** — a
plain DOM table is a perfectly reasonable dataset control. The two flags are not
two ways of asking the same question, and the combination people get wrong is
the React one: a React *dataset* control is `type: "dataset"` with
`framework: "react_virtual"`, because the hub's parser resolves
dataset → virtual → field in that order. `npm run check` enforces it.

### One decision the flag cannot make for you

The scaffolded manifest declares **no `property-set` roles**, and whether that
is right depends on the control:

- **Declare roles** when the control assigns meaning to specific columns — a
  chip has a label and a colour, a map pin has a latitude and a longitude. Each
  role is a named slot in the manifest, so the arity is fixed at whatever you
  write.
- **Declare none, and read `dataset.columns`,** when the control renders
  whatever it is given. A table is the clearest case: there is no way to declare
  "however many columns the view has", and the metadata a layout needs —
  `order`, `visualSizeFactor`, `isPrimary`, `disableSorting` — exists on real
  view columns and nowhere else.

If you add roles, add `::props-table{kind=dataset_column}` back to
`docs/api.md`; with none it renders an empty table, which reads as "this control
has no dataset columns" rather than as a section nobody wrote. The manifest's
own comments say this too, at the point where you would change it.

## Running it non-interactively

Every value must be answerable without a prompt under `--yes`, and `TAGLINE`,
`CATEGORY` and `OWNER` have no derived default. A short command does not fall
back to sensible values — it exits 1:

```bash
node scripts/setup.mjs --yes \
  --control ColorPicker --namespace PCFHub --slug pcf-color-picker \
  --title "Color Picker" --tagline "A WCAG-compliant colour picker." \
  --category pickers --owner pcfhub --repo pcf-color-picker \
  --publisher PCFHub --prefix pcfhu
```

Note `SLUG` derives from `CONTROL` as `color-picker`, not `pcf-color-picker`.

`npm run check` — which CI runs first, before the slow Windows build — fails
while any placeholder remains, so a half-adopted template cannot reach a
release. It also reads `pcfhub.json` structurally: that `control.type` and
`control.framework` are real values and agree with what the manifest actually
declares, that `demo.fidelity` is one of the four, and that a `limited` demo
lists its `demo.limitations`. It still does **not** check images referenced
from the docs — a broken one there ships silently.

The placeholder guard exists because two of the answers are permanent:

| Answer | Why it cannot change later |
| --- | --- |
| Publisher unique name | Every component carries it; changing it orphans installed solutions |
| Customization prefix | Baked into the logical name of everything in the solution |

The solution's `<UniqueName>` is nearly as sticky: change it after a release and
the next import creates a *second* solution instead of upgrading the first.

## Placeholders

| Token | Becomes | Example |
| --- | --- | --- |
| `__CONTROL__` | Constructor, directory and file names, CSS class | `ColorPicker` |
| `__NAMESPACE__` | PCF namespace | `PCFHub` |
| `__SLUG__` | Hub slug and npm package name | `pcf-color-picker` |
| `__TITLE__` | Display name | `Color Picker` |
| `__TAGLINE__` | One-line description | `A WCAG-compliant colour picker.` |
| `__CATEGORY__` | Hub category slug | `pickers` |
| `__OWNER__` / `__REPO__` | GitHub coordinates | `pcfhub` / `pcf-color-picker` |
| `__PUBLISHER__` / `__PREFIX__` | Dataverse publisher | `PCFHub` / `pcfh` |

Generated rather than asked for: both project GUIDs, and the publisher's
option-value prefix.

## What the hub reads, and when

| What | From | When |
| --- | --- | --- |
| Identity, links, docs path | `pcfhub.json` | Every sync, from the default branch |
| API reference | `ControlManifest.Input.xml` | Once per release, **at that release's tag** |
| Doc pages | `docs/*.md` | Every sync, from the default branch |
| Versions, release notes, downloads | GitHub Releases | Every sync |
| Changelog | Release notes | Built by the hub — do not write `docs/changelog.md` |

Docs come from the branch so a typo fix does not need a release. The API
reference comes from the tag so an old version is not described by the newest
control's property list.

## Things that surprise people

- **`docs/` filenames are a closed set.** `overview.md`, `installation.md`,
  `canvas.md`, `model-driven.md`, `api.md`, `examples.md`, `limitations.md`,
  `faq.md`, `migration.md`. Anything else is skipped — `npm run check` catches
  it before the hub does. Delete the pages that do not apply rather than
  shipping them empty.
- **Nothing here publishes the component.** A sync imports it as a draft; a
  person publishes it. That is deliberate — a mistake in a repository should not
  become a mistake on the public site.
- **The slug in `pcfhub.json` must equal the slug on the hub.** They are matched
  on every sync, and a mismatch fails the whole import rather than quietly
  moving one component's releases onto another. The usual cause is a
  `pcfhub.json` copied from another repository.
- **Fields a person edits in the hub's admin panel stop being overwritten.**
  Ingestion drops locked fields before it writes, so an operator's correction
  survives the next sweep. If a change in this repository does not show up, that
  is the first thing to check.
- **Release assets are matched by glob.** With no `release.artifacts` block, the
  hub looks for `*_managed.zip` and `*_unmanaged.zip`. The release workflow
  renames msbuild's unmanaged output to suit — which is why no artifact patterns
  are needed here. If you change the workflow, change them together.

## Demo

The release workflow already attaches a demo bundle to every release — the
same `bundle.js` `npm run build` produces under `out/controls/`, a standard
PCF control bundle that already calls
`window.ComponentFramework.registerControl` if the hub's demo harness has
defined it. There is nothing hub-specific to build; the workflow just finds
and attaches the file that is already there.

That bundle does nothing by itself. `pcfhub.json`'s `demo.fidelity` starts at
`"none"`, and at `"none"` the hub never even requests a manifest — the
component page shows the video/screenshot fallback instead, regardless of
whether a bundle is attached to the release. Turning the demo on is a
`pcfhub.json` edit, not a workflow change:

| `fidelity` | Means |
| --- | --- |
| `full` | Fully interactive — the control never reaches Dataverse, WebAPI, or anything else the harness cannot fake. |
| `mocked` | Interactive, but against simulated data instead of a real platform call. |
| `limited` | Partially interactive; `demo.limitations` must list what is stubbed. |
| `none` (default) | No demo — video/screenshots only. |

Only the author knows which applies; the hub cannot infer it from the code. Guess
`full` when unsure and you are wrong: a demo that silently falls back to
mocked data is worse than one that declines to run at all.

### Presets

`demo.presets` gives the demo named states — an empty one, a full one, one that
hits an overflow path. Each has a `slug`, `name`, `description` and a `props`
object keyed by property name; mark one `isDefault`. `props` covers **bound
properties as well as inputs**, and for a field control it is the only way to
give the demo any data at all.

**Set every input property in every preset**, including the ones whose manifest
`default-value` looks like it would cover them. A `default-value` reaches the
harness as the raw XML *string*, and `Boolean("false")` is `true` — so
`default-value="false"` arrives switched **on** in any preset that omits it.
Numeric types have the same problem. Do not work around this in the control by
coercing strings; that pollutes production code to suit a harness.

## Localisation

The template ships one `.resx`, at `1033` (English). Everything a user or a
maker can read belongs in it — the property display names and descriptions the
manifest points at, and any string `index.ts` renders, read back with
`context.resources.getString()`.

Prefer that over an input property a maker hand-types a translation into. An
input property makes each maker know and type the translation themselves, once
per instance, where the `.resx` lets the org’s provisioned language pick it up
automatically.

To add a language, copy the file and list it under `<resources>`:

```xml
<resx path="strings/__CONTROL__.1033.resx" version="1.0.0" />
<resx path="strings/__CONTROL__.3082.resx" version="1.0.0" />
```

Common LCIDs: `1031` German, `1033` English, `1036` French, `1041` Japanese,
`3082` Spanish.

Every file must carry the **same key set**. A key missing from one language
falls back to the key name in that language only, which nobody notices until a
customer does — so generate the files from one list rather than copying and
editing by hand.

## Wiring the webhook

Once per repository, so a tag publishes in seconds rather than within the hour:

**Settings → Webhooks → Add webhook**

| Field | Value |
| --- | --- |
| Payload URL | `https://pcfhub.dev/webhooks/github` |
| Content type | `application/json` |
| Secret | The shared secret from the hub |
| Events | Releases, Pushes |

The hub authenticates the delivery by HMAC over the raw body, which is why the
release workflow does not simply curl it.
