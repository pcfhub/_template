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

All four now have a repository behind them rather than an assurance:
`pcf-star-rating` (field, standard), `pcf-choices-picker` (field, react),
`pcf-data-table` (dataset, react) and `pcf-compact-list` (dataset, standard) —
which was the last to be built and needed no correction to the variant it came
from.

**Note what the dataset variant scaffolds, though: a table.** Sortable column
headers, a pager, an open-record button on the primary column. That is the right
default — it is the shape most dataset controls want, and the comments in it are
the traps that shape hits. But if you are building something that is not a table,
expect to replace most of `index.ts` rather than adjust it. `pcf-compact-list`
kept the lifecycle skeleton and the paging guard and threw the rest away, which
is the intended way to use it.

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

## Grid customizers

```bash
node scripts/setup.mjs --type grid-customizer …
```

The third shape, and the one that breaks the assumptions above: a control that
binds nothing, renders nothing, and whose entire output is other controls'
cells. It does not compose with `--framework` — the cells it returns are React
elements by contract, on **Fluent 8** rather than the Fluent 9 the other React
variants use, because a cell is mounted by the grid with nothing of the
customizer's above it and there is nowhere to put a `FluentProvider`.

Three things it scaffolds that the other shapes do not:

- **`customizers/`** — the two override maps, keyed by column data type, wired
  into the payload `index.ts` fires. This is what most customizers want.
- **`customizers/GridCustomizerOverrides.tsx`** — the *other* half of the
  contract: the loading row, the empty-state overlay, the column headers.
  Scaffolded but **not wired up**; `index.ts` carries the four lines that switch
  it on. Read its header before you do, because those members behave unlike the
  override maps in a way that does not show up until it is too late: they return
  `ReactElement` with no `undefined` in the type, so **they cannot decline**.
  Implementing one replaces the grid's version for every column of every view of
  the table.
- **`dev/`** — a local stand-in for the grid; see below.

### Developing one

`npm start` is no help here. It hosts the control the way a form would, and a
customizer correctly renders nothing on a form — so the harness that works for
every other shape shows a blank page for this one, accurately.

PCFHub's demo harness gets closer but stops short: it renders cell renderers and
editors over `demo.datasetFixture`, and it does **not** call the
`GridCustomizer` members or carry any attribute metadata. So a customizer that
implements the chrome, or that reads `MinValue`/`MaxValue`, has nothing there to
develop against either.

Hence `dev/`:

```bash
npm run build
# then open dev/harness.html in a browser
```

No bundler, no dev server, no new dependencies. It loads the bundle the build
already produced, plus React and Fluent from `node_modules` — the libraries the
platform would otherwise supply, which the manifest's `<platform-library>`
entries keep out of the bundle. It calls every override the way the grid does,
renders the `GridCustomizer` members, and has two switches: one for the host's
dark theme, one for whether columns declare a metadata range.

Two details in it are worth knowing before you edit it. It opens over `file://`,
so the fixture is a script rather than a `fetch` of `demo/` — `fetch` is blocked
there and `<script src>` is not. And the platform calls
`registerControl('Namespace.Control', ctor)` with **two** arguments, the
namespace and constructor already joined; reading the constructor from a third
parameter gets `undefined` and fails later as "registered is not a constructor".

**It is a stand-in, not the grid.** Virtualization, server-side sort and filter,
real validation state, selection and keyboard navigation are all absent, and
`validationError`, `secured` and `isRequired` are states it cannot produce —
which means the branches handling them are exactly the ones it cannot check.
Anything that works here still has to be confirmed on a real model-driven grid.

### Asserting what the harness can only show you

```bash
npm run smoke
```

`dev/smoke.js` loads the same built bundle from Node, fires the payload, calls
the overrides and asserts what comes back. It exists because the harness renders
a grid, and a customizer's real behaviour is a set of per-cell *decisions* —
which cells it declines, what geometry it computes, which class it puts on an
element. Those are invisible in a rendered grid unless you happen to be looking
at the right cell, and they are what regresses.

It ships with a worked example against the scaffolded `Text` override — replace
the block below the divider, keep the plumbing above it. If you delete the
scaffolded override, the example detects that and stops rather than failing.

Two things about how it is wired:

- **Fluent is stubbed, not loaded.** Every component resolves to its own name as
  an element type, so the props your override passed survive for inspection
  without dragging a browser-shaped library into Node. The assertions are about
  your decisions, not about how Fluent renders them.
- **CI runs it after the msbuild pack**, not after `npm run build` — the pack
  overwrites `out/controls` with the production bundle, so there it drives what
  actually ships. Minification does not disturb it: terser leaves string
  literals and React lifecycle names alone with property mangling off.

Locally it tests whichever bundle is on disk, so a `npm run build` after a pack
puts the development one back.

### The demo fixture

`demo/columns.json` ships with one row per interesting case across every column
type a customizer can key an override on, including a row of nulls and a row of
zeroes — the two that catch an override treating falsy as empty.
`demo.datasetFixture` already points at it.

`demo.fidelity` still starts at `none`, and raising it is your call rather than
the template's. A cell customizer can usually go to `mocked` the day it ships. A
customizer that depends on attribute metadata or implements the chrome members
may have to stay at `none` — not because the demo is unfinished, but because the
harness would show a grid with none of the control's work in it, which is worse
than showing nothing at all.

## Running it non-interactively

Every value must be answerable without a prompt under `--yes`, and `TAGLINE`,
`CATEGORY` and `OWNER` have no derived default. A short command does not fall
back to sensible values — it exits 1:

```bash
node scripts/setup.mjs --yes \
  --control ColorPicker --namespace PCFHub --slug pcf-color-picker \
  --title "Color Picker" --tagline "A WCAG-compliant colour picker." \
  --category pickers --owner pcfhub --repo pcf-color-picker \
  --publisher PCFHub --prefix pcfhub
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
