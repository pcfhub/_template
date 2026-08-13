# Using this template

This is the starting point for a PCF control published on
[PCFHub](https://pcfhub.dev). It is a working Power Apps component project plus
the three things the hub needs: `pcfhub.json`, a `docs/` directory, and a
release workflow that attaches assets under names the hub recognises.

`npm run setup` deletes this file. Everything below is about adopting the
template; everything in `README.md` is about the component you are building.

## Adopt it

```bash
npm run setup
```

You are asked for eight values; the rest are derived or generated. Then:

```bash
npm install
npm run build
```

`npm run check` — which CI runs first, before the slow Windows build — fails
while any placeholder remains, so a half-adopted template cannot reach a
release. That guard exists because two of the answers are permanent:

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
