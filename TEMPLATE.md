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

## The dev rig

Every shape ships a `dev/` directory, and it is the only thing in the repository
that asserts anything about the control:

```bash
npm run build
npm run smoke          # assertions, with an exit code
# then open dev/harness.html in a browser
```

No bundler, no dev server, no test framework, no new dependencies. `smoke.js`
loads the bundle `npm run build` produced, drives the control through the states
a host can put it in, and prints a pass or a fail per decision. CI runs it
**after the msbuild pack**, so there it drives the production bundle rather than
the development one.

### What `npm start` already covers

**Use `npm start` for the happy path**, and know exactly what it is. Read off
the running harness (`pcf-start` 1.51.1), the whole of it is:

- **Context Inputs** — form factor (Web / Tablet / Phone / Unknown), component
  container width, component container height.
- **Data Inputs** — one text box per input and output property, and for a
  dataset, a CSV upload with a data-type picker per column.

That is the complete list. **Two of those the rig did not have and now does**,
because they are the platform surface `npm start` is genuinely best at:
`client.getFormFactor()` and `mode.allocatedWidth` / `allocatedHeight`. Use
whichever is in front of you.

Everything else a form can do to a control, `npm start` cannot. And its dataset
mock is thinner than it looks — from the harness source, and confirmed by
running the scaffolded control against it:

```
paging: { totalResultCount: n, hasNextPage: false, hasPreviousPage: false,
          loadNextPage: () => log(…), loadPreviousPage: () => log(…),
          reset: () => log(…), setPageSize: e => log("loadNextPage", …) },
sortedRecordIds: <every row in the CSV>,
sorting: undefined,
loading: false, error: false, errorMessage: undefined,
```

`hasNextPage` and `hasPreviousPage` are **hardcoded false**, so the CSV is
always exactly one page. The mutators are `console.log` and nothing else —
driving the scaffolded control produced `Invoked method loadNextPage on Paging
interface. Parameters: 25.` for its `setPageSize(25)` call (the harness logs
that one under the wrong name) and `Invoked method refresh on DataSet
interface.`, and no data moved. `sorting` is not even an array. `loading` and
`error` are hardcoded, so those states are unreachable too.

**`sorting: undefined` is the one that bites, and it bit this template.** The
type definitions declare `sorting` as a required array, so the obvious
`dataset.sorting.find(...)` in a sortable header throws a TypeError against
`npm start` — **and the harness swallows it.** No console error, no message: the
control renders as an empty box. A freshly scaffolded dataset control did
exactly that, which is the worst possible first impression, since `npm start` is
step three of the Develop section in `README.md`.

Both dataset variants now read through `(dataset.sorting ?? [])` and decline a
sort they have no array to express, and `npm run smoke` asserts both against a
`sortingAbsent` host. Verified against `pcf-start` 1.51.1 by instrumenting the
control: before the fix, a blank container with three columns and three records
sitting unused in the dataset; after it, a rendered table and a working pager.

So for a dataset control, `npm start` shows you one unsorted page and logs your
mutators into the console. That is the gap the rig exists to fill:

| Shape | What only the rig reaches |
| --- | --- |
| field | Field-level security (`security.readable` false is *not* an empty column), the platform's own `error`/`errorMessage`, a host that publishes no theme, a host that publishes no column metadata, and whether a cleared value comes back as `null` rather than `undefined`. |
| dataset | **More than one page.** Server-side sorting, a non-sortable column, a hidden column, columns out of order — and the three ways real paging misbehaves, as switches. |
| grid-customizer | The whole shape; see below. |

Both harness pages also carry the two switches `npm start` has — form factor and
allocated width — so a responsive control can be developed in one place. Note
that `getFormFactor()` is **0 unknown, 1 desktop, 2 tablet, 3 phone**: web is
`1`, and `3` is a phone, which is the comparison people get backwards. And
`allocatedWidth` is `-1` until the control calls
`mode.trackContainerResize(true)`, so a control that reflows on width without
asking lays out against `-1` on every host and silently picks its narrowest
branch forever.

The dataset rig is the one that changes what is possible rather than what is
convenient. PCFHub's demo harness seeds a single page and reports no next or
previous page, which is why every dataset control in the catalogue is published
at `demo.fidelity: "limited"` — so until this landed, the paging and sorting
code, which is most of the hard code in the shape, had never been exercised by
anything at all. `dev/host.js` ships twelve records and a page size of five,
because three pages is the smallest number that tells you whether page two came
from the platform or from a slice.

**Its `quirks` switches default to the platform's observed misbehaviour, not to
its documentation, and that is deliberate.** The scaffolded dataset control
carries three repairs — `loadNextPage(true)` ignoring its argument and
accumulating ids, `hasPreviousPage` never unlocking, `firstPageNumber`
disagreeing with the ids — each of which reads as superstition until you can
turn the behaviour off and watch the repair stop being needed. A harness that
modelled the platform as written down would pass a control that cannot page on a
real form, which is the failure the switches exist to prevent.

Three things to know before editing any of it:

- **`dev/host.js` withholds what the platform withholds.** `security` is
  `undefined` on a column with no field-level security, `attributes` is
  `undefined` on canvas, `fluentDesignLanguage` is `undefined` on a host that
  publishes no theme. Filling those in "so the control has something to read" is
  how a control that cannot work on a real form passes every local check — it
  has happened here before, in the grid rig, twice.
- **`dev/dom.js` is a DOM only in the parts that were needed**, and throws by
  name for anything else rather than quietly returning `undefined`. A missing
  piece should read as "add it to `dev/dom.js`", not as a mysterious failure.
- **The assertions below the divider in `smoke.js` are a worked example.**
  Replace them. Everything above the divider is plumbing that works for any
  control of that shape.

`npm run build` writes the development bundle over whatever the last msbuild
pack left, so locally the rig tests whichever bundle is on disk.

### What it deliberately does not do

`--framework react` **deletes `dev/harness.html` and `dev/harness.js`** and
keeps `smoke.js`. A virtual control's bundle expects Fluent under the global its
`<platform-library>` entry compiles it out to, and
`@fluentui/react-components` ships no UMD build — there is no file to put in a
`<script src>`, and adding a bundler to produce one would make the harness the
thing that needs building. Nothing is lost: unlike a customizer, a virtual field
or dataset control renders perfectly well under `npm start`, and `smoke.js`
works on it unchanged by reading the props it passed down instead of the DOM it
wrote. Grid customizers keep their harness because Fluent 8 does ship a UMD
build.

Nothing here proves the control works. Every value the rig supplies comes from
the rig. It cannot tell you that a real form hands down what these fixtures hand
down, that a save persists anything, that the stylesheet applies, or that focus
order is sane — those belong in `SPEC.md` under *Not verified*.

### Timers, and what `destroy` owes

`destroy` is the lifecycle method with nothing visible riding on it, so it is
the one that quietly does nothing. It matters for exactly three things, and none
of them shows up on a form:

- an interval or a `requestAnimationFrame` loop, which goes on firing against a
  container the platform has already thrown away;
- a listener on `document` or `window` — unlike one on an element inside
  `container`, it is not collected with the subtree, and it keeps the whole
  control reachable;
- anything else with a lifetime the DOM does not own: an `AbortController`, a
  `ResizeObserver`, a subscription.

On a form somebody leaves open all afternoon, or a subgrid re-rendering its
rows, these accumulate. **`dev/clock.js` and the assertions at the bottom of
`dev/smoke.js` exist to make that visible**, and they are written against no
particular control:

```js
disposeAll();

const timersBefore = time.pending();

mount({}).destroy();

check('destroy() releases every timer the control took', time.pending() === timersBefore);
```

`clock.js` installs a fake `Date`, `setInterval` and `setTimeout` onto the
global **before the bundle is evaluated** — `vm.runInThisContext` shares this
realm, so those are the ones the control closes over. That is deliberate, and it
is why there is no clock parameter threaded through the control's constructor:
production code should not carry a seam whose only purpose is a harness.

Four rules the assertions encode, worth knowing before writing the control
rather than after:

- **Arm in `init`, clear in `destroy`.** Never from `updateView` — it runs on
  every change to any bound value, so a `setInterval` reached from the render
  path adds a timer per render.
- **Clear before re-arming.** A control that changes its own tick rate has to
  replace the timer, not run a second one alongside it.
- **A tick must not call `notifyOutputChanged`.** It makes the form re-evaluate
  every rule on it at the tick rate, for a control that usually has nothing new
  to say.
- **A tick must not read `context`.** `updateView` is handed one for the
  duration of the call, and nothing promises the same object still describes the
  form thirty seconds later. Take a plain snapshot of what the repaint needs —
  including any string or date that needed `context` to produce — and let the
  tick render from that.

`pcf-sla-timer` is the worked example: a display-only countdown, and the first
control here with a teardown obligation. The general form of all of this lives
in the skill's `references/control-patterns.md` under *Timers and teardown*.

**The grid-customizer rig has none of this**, and the omission is deliberate:
a customizer hands the grid a set of overrides and the grid calls them, so there
is no container, no render loop, and no `dev/dom.js` in that variant's suite.

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
  Scaffolded, **not wired up, and it should stay that way.** Verified against a
  live environment on 2026-08-25: the shipping Power Apps grid reads
  `cellRendererOverrides` out of the payload and ignores `gridCustomizer`
  entirely, so a control built on these members does nothing. `pcf-grid-chrome`
  was built on them and withdrawn. Delete the file rather than wiring it; the
  header explains what the interface claims, and the rest of this bullet
  describes those claims. Those members behave unlike the
  override maps in a way that does not show up until it is too late: they return
  `ReactElement` with no `undefined` in the type, so **they cannot decline**.
  Implementing one replaces the grid's version for every column of every view of
  the table.
- **`dev/`** — a local stand-in for the grid; see below.

### Developing one

The same rig as every other shape — `dev/harness.html` and `npm run smoke` —
but for a different reason. Elsewhere it reaches states `npm start` cannot;
here it is the only way to see the control at all.

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
release.

It then **asks the hub** to validate `pcfhub.json`, rather than checking the
schema itself. There is no JSON Schema file to keep in step and no local copy of
the rules: `POST /api/v1/manifest/validate` runs the same validator ingestion
runs, so what passes here is what imports there. Errors and warnings come back
with a JSON Pointer at each one. A practical consequence worth knowing: rules
added to the hub reach your CI without you updating anything — the captions
warning that arrived with schema version 1's `media.captions` field started
appearing in repositories whose check script had not been touched in months.

If the hub cannot be reached the check **warns and carries on**. Failing a
release because someone else's website is briefly down is how a check gets
disabled, and the manifest is validated again at ingestion regardless. Point it
elsewhere with `PCFHUB_URL` when developing against a local hub.

What stays local is everything the hub cannot see from a manifest alone: that
`control.manifestPath` exists, that `control.type` and `control.framework` agree
with what `ControlManifest.Input.xml` actually declares, that a grid host
declares `<platform-library name="React">`, that declared `<uses-feature>`
entries are used, that docs filenames are sections the hub recognises, and that
every file named under `media` and `demo` is really there. It still does **not**
check images referenced from inside the docs — a broken one there ships
silently.

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

## The stylesheet

`css/__CONTROL__.css` is not neutral scaffolding to be replaced — it is Fluent's
`filled-darker` Input reproduced in plain CSS, and it is the reason a control
built from here looks like the form it lands on rather than like a widget
dropped onto one.

The premise: a standard control cannot mount a `FluentProvider`, since the
provider is React — but `FluentProvider` is what **emits** the theme as CSS
custom properties, and a model-driven form already mounts one above every code
component on the page. So the stylesheet *reads* the tokens, with Fluent's own
light-theme values as fallbacks:

```css
--__CONTROL__-background: var(--colorNeutralBackground3, #f5f5f5);
```

The token wins where the host publishes it, so the control follows the app's
theme and brand colour with no code at all. The fallback carries the hosts that
publish nothing — canvas apps, and PCFHub's own demo harness. `--dark` swaps
only the fallbacks, and it is driven by
`context.fluentDesignLanguage?.isDarkTheme` rather than
`prefers-color-scheme`, because a model-driven app carries its own theme and the
user's OS setting says nothing about it.

Three things in there are worth knowing before editing:

- **The input sits inside `.__CONTROL__-field`, which owns the border, the
  hover, the focus underline and the invalid state.** That is the shape the
  platform's own fields have, and it is what lets a trailing button or icon be
  added later without restyling anything.
- **The focus underline is a scaled `::after`, not a `border-bottom`.** A border
  that appears on focus adds 2px of height, so every field below it on the form
  nudges down as the user tabs through.
- **Disabled removes the fill and reveals the border.** It is a different
  surface, not `opacity` over the enabled one — which would drag the text below
  contrast along with the chrome.

Extend it rather than starting over. New values come from `@fluentui/tokens`,
which any control declaring Fluent already has transitively:

```bash
node --input-type=module -e "
import {webLightTheme as L, webDarkTheme as D} from '@fluentui/tokens';
console.log(L.colorNeutralBackground3, D.colorNeutralBackground3);
"
```

Nothing in the build checks a selector that matches nothing or a token name
spelled wrong — both render quietly and look fine on every host that publishes
no tokens. Read `getComputedStyle` back off the built CSS before believing it.

**`--type dataset` swaps in its own stylesheet**, built the same way: the same
token-with-fallback palette and the same `--dark` block, over Fluent DataGrid's
numbers rather than an Input's — 44px rows, semibold headers, a heavier border
under the header than between rows, 32px pager buttons. Its `--dark` class only
ever bites in the DOM variant; the React one mounts its own `FluentProvider`
with the host's `tokenTheme`, so every token resolves and no fallback is
reached, which is why only `index.ts` sets the class and the `react/` entry
point does not.

`--type grid-customizer` is the exception to all of it. A cell renderer is
mounted by the host's grid with nowhere to put a `FluentProvider` and declares
Fluent **8**, so the tokens are genuinely unavailable there — see *Grid
customizers* for what replaces them.

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

The template ships **five** `.resx` files: `1033` English, `3082` Spanish,
`1036` French, `1031` German and `1041` Japanese, for every variant. Everything
a user or a maker can read belongs in them — the property display names and
descriptions the manifest points at, and any string `index.ts` renders, read
back with `context.resources.getString()`.

Five rather than one because English-only is a decision nobody revisits: by the
time a second language is wanted, the strings that were never put in the `.resx`
have to be hunted out of the code first. Starting with five makes the `.resx`
the obvious place to put a string on the first day.

Two things to do before shipping:

- **Translate `__TITLE__` and `__TAGLINE__`.** `npm run setup` fills those with
  the English title and tagline you gave it, in every language, because the
  template cannot know them. They are the only two values in the translated
  files that are not already translated.
- **Delete the languages you will not maintain**, and their `<resx>` lines. A
  stale translation is worse than an honest fallback to English, because the
  fallback is at least current.

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

`npm run check` enforces that, and three neighbouring mistakes: a `.resx` on
disk that no `<resx>` line lists (never packed, so the locale falls back to
English while the repository looks translated), a `<resx>` line pointing at a
file that is not there, and a `{0}` dropped in translation.

Placeholders are compared as a **set**, not by position, because moving them is
correct: `"Copy {0}"` is `"{0} kopieren"` in German and `"{0} をコピー"` in
Japanese, and the dataset variant's `"{0}–{1} of {2}"` is `"{2} 件中 {0}–{1} 件"`.
That is also why these strings are single keys with placeholders rather than
sentences built up in code — `label + ' ' + getString('Copy')` cannot be
translated into either language, because the verb has to go last.

**`1033` is listed last in `<resources>`, on purpose.** `pcf-start` picks the
`.resx` by manifest order rather than by locale, reading whichever file is
listed *last* and ignoring the LCID and the browser language entirely. The
platform ignores the order completely — a real app resolves from the user's
provisioned language — so `npm start` is the only thing that reads it, and the
block is ordered for the only reader it has. With `1033` first, a freshly
scaffolded control renders entirely in Japanese the first time anyone runs
`npm start`, which reads as a broken build.

**So add a new language *above* the `1033` line, never below it.** Appending a
sixth file hands `npm start` to that language, and the symptom turns up in a
session nobody connects to a manifest edit. The manifest repeats this in
capitals right where somebody would append.

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
