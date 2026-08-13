---
title: Migrating to 1.0
description: What changed, and what a maker has to do about it.
appliesTo: ">=1.0.0"
order: 9
---

# Migrating to 1.0

<!--
  `appliesTo` is the only frontmatter key that changes how the page is stored.

  Without it, a page is unpinned: one row, shown for every version. With a
  semver range, the hub materialises the page once per release the range covers,
  so a reader on 0.9.0 never sees a migration note written for 1.0.

  Ranges: ">=1.0.0", "^1.2", "1.x", ">=1.0.0 <2.0.0".

  A range matching no released version is reported on the ingestion run and the
  page is skipped — which is what happens if you write this page before cutting
  the release it describes. Delete the file until then.
-->

## What changed

The breaking change, in one sentence.

## What to do

:::steps
1. The concrete step.
2. The next one.
:::

:::callout{type=warning}
If a change cannot be made safely without a data migration, say so here rather
than in the release notes — this page is what a reader lands on.
:::
