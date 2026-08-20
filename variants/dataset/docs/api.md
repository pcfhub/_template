---
title: API reference
description: Properties and outputs, generated from the control manifest.
order: 5
---

# API reference

<!--
  Do not write the property tables by hand.

  `props-table` renders from what the hub parsed out of
  ControlManifest.Input.xml at the release being viewed, so it cannot drift from
  the control. A hand-written table is wrong the first time somebody adds a
  property and forgets this file, and a reader has no way to tell.

  kind: input | bound | output | dataset | dataset_column
  Omit `kind` to render every property in one table.

  There is no `kind=bound` section here because a dataset control binds a
  collection, not a column.

  There is no `kind=dataset_column` section either, because the manifest this
  ships with declares no `property-set` roles — the directive would render an
  empty table, which reads as "this control has no dataset columns" rather than
  as a section nobody wrote. **If you add roles to the manifest, add the section
  back**, or the roles you declared are documented nowhere.
-->

## Input properties

::props-table{kind=input}

## Dataset

::props-table{kind=dataset}

## Outputs

::props-table{kind=output}

## Columns

<!--
  Delete this section if you declare property-set roles — the generated
  dataset_column table replaces it. Keep it if the control renders the view's
  own columns, because then there is nothing for a table to list and a reader
  needs telling why.
-->

The columns are the view's.

This control declares no `property-set` roles, so it renders whatever
`dataset.columns` reports — the columns the maker put in the view, in the view's
own `order`, at the view's own widths — and skips the ones marked hidden. There
is nothing to configure per column.

| Metadata | Effect |
| --- | --- |
| `isPrimary` | That cell becomes the open-record button, and its value names the row for a screen reader. Falls back to the first visible column. |
| `disableSorting` | No sort control on that column, and no `aria-sort`. |
| `visualSizeFactor` | Distributed as percentage widths. When every factor is 0 — which canvas reports — the browser lays the table out instead. |
