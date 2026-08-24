---
title: API reference
description: Properties and outputs, generated from the control manifest.
order: 5
---

# API reference

## Bound properties

::props-table{kind=bound}

## Notes

`EventName` is the control's only property, and it is not configuration. The
Power Apps grid generates an event name, passes it in, and listens on it for the
cell renderers and editors this control fires during startup. A maker never sets
it; an empty value means nothing is listening, and the control returns without
firing.

There is no `kind=input` section, and no `kind=output` one, because a grid
customizer has neither. Both directives would render an empty table, which reads
as "nobody wrote this section" rather than as "this control has none" — so they
are omitted rather than shipped empty. Add `::props-table{kind=input}` back if
you give the control real input properties, and read the manifest's comment on
why that is usually the wrong instinct first.

The customizer payload itself has no manifest representation. It is a runtime
object handed to the grid, so what this control actually does to a cell is
documented in [Examples](examples.md) and in the source under `customizers/`,
not here.
