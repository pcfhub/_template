import * as React from 'react';
import { GridCustomizer, NoRowsOverlayConfig } from '../types';

/**
 * The *other* half of the customizer contract: the grid around the cells.
 *
 * **Not wired up by default.** `index.ts` fires `cellRendererOverrides` and
 * `cellEditorOverrides`, which is what most customizers want. To use this file
 * instead — or as well — see the comment beside the payload in `index.ts`.
 *
 * Everything below behaves unlike the two override maps, and the differences
 * are easy to miss because the two halves look alike:
 *
 *   1. **These members cannot decline.** `GetHeaderRenderer`,
 *      `GetLoadingRowRenderer` and `GetNoRowsOverlayConfiguration` return
 *      `ReactElement`, with no `undefined` in the type — unlike a cell
 *      override, where returning nothing means "the grid draws this one".
 *      Implementing one replaces the grid's version of that thing on every
 *      column of every view of the table, permanently. There is no per-column
 *      opt-out to add later.
 *   2. **They receive no context, and mostly no parameters.**
 *      `GetLoadingRowRenderer()` and `GetNoRowsOverlayConfiguration()` take
 *      none at all. Anything user-visible therefore cannot be read from the
 *      `.resx` inside them — it has to be closed over when the payload is
 *      built, which is why this is a factory taking `resources` rather than a
 *      constant.
 *   3. **The no-rows component must be a class.** See its own comment below;
 *      the type demands one and then refuses the props it is handed.
 *
 * Delete the members you do not implement. An empty implementation is not the
 * same as an absent one — an absent member leaves the grid's own, which is
 * almost always what you want for anything you have not deliberately designed.
 */
export function createGridCustomizer(
    resources: ComponentFramework.Resources,
): GridCustomizer {
    const loadingLabel = resources.getString('Loading_Label');

    return {
        /**
         * One placeholder row, drawn per row the grid is waiting on.
         *
         * No parameters means no row height, no column count and no column
         * widths, so a skeleton cannot mirror the row it stands in for.
         * Everything about its size has to come from CSS filling the container
         * the grid mounts it into — which is also why it survives row heights
         * this control never sees.
         *
         * Two things worth keeping if you rewrite this. **Gate the animation on
         * `prefers-reduced-motion`**: one skeleton per waiting row means a full
         * page is twenty-odd elements animating at once, which is the large
         * moving area that setting exists to suppress. And **give the row one
         * visually-hidden label with the bars marked `aria-hidden`**, or a
         * screen-reader user waiting on a slow view is told nothing at all.
         */
        GetLoadingRowRenderer: () => (
            <div className="__CONTROL__-loading" role="presentation">
                <span className="__CONTROL__-srOnly">{loadingLabel}</span>
                <span className="__CONTROL__-skeleton" aria-hidden="true" />
                <span className="__CONTROL__-skeleton" aria-hidden="true" />
            </div>
        ),

        /**
         * What fills the grid when the view returns nothing.
         *
         * Returns a component class and its props rather than an element, and
         * the class part is not a style preference: `component` is typed
         * `ComponentClass`, so a function component is a type error here. It is
         * the only place in this contract that demands one.
         *
         * The cast is required and is worth understanding before removing it.
         * Bare `ComponentClass` resolves to `ComponentClass<{}, any>` — a class
         * accepting *no* props — while the neighbouring `props?: unknown` field
         * exists to carry props to it. The two contradict each other, so any
         * class that uses what `props` delivers fails to assign, and a single
         * `as ComponentClass` fails too; TypeScript names the double cast
         * itself. Widening the component to `Partial<…>` typechecks instead, at
         * the cost of an in-code English default for every string.
         *
         * **On the copy**: this is called with no arguments, so it cannot know
         * whether the grid is empty because the table is, because a filter
         * matched nothing, because of a search term, or because of permissions.
         * Those want opposite messages. Resist the friendly default — telling
         * somebody no records exist when their filter is merely too narrow
         * sends them to create a duplicate of a record that is already there.
         */
        GetNoRowsOverlayConfiguration: (): NoRowsOverlayConfig => ({
            component: NoRowsOverlay as unknown as React.ComponentClass,
            props: {
                title: resources.getString('NoRows_Title'),
                body: resources.getString('NoRows_Body'),
            },
        }),
    };
}

interface NoRowsProps {
    readonly title: string;
    readonly body: string;
}

class NoRowsOverlay extends React.Component<NoRowsProps> {
    public render(): React.ReactElement {
        return (
            <div className="__CONTROL__-noRows" role="status">
                <p className="__CONTROL__-noRowsTitle">{this.props.title}</p>
                <p className="__CONTROL__-noRowsBody">{this.props.body}</p>
            </div>
        );
    }
}

/*
 * `GetHeaderRenderer` is not scaffolded above, and that is a recommendation
 * rather than an omission.
 *
 * It is the third member of this interface and the obvious thing to reach for.
 * But it cannot decline (rule 1 at the top of this file), so implementing it
 * means owning every header on every view of the table — and `GetHeaderParams`
 * carries `colDefs`, `columnIndex`, `isFirstVisualColumn`, `isLastVisualColumn`,
 * `rowData`, `isRTLMode` and `allowTabKeyNavigation`, with **no sort direction,
 * no filter state, and no callback to open the column menu**.
 *
 * So a replacement header can render a display name and little else, while
 * removing the sort indicator, the filter affordance and the menu that every
 * user of a model-driven grid reaches for. A grid whose columns cannot be
 * sorted is not a styled grid; it is a broken one.
 *
 * If you implement it anyway, know what you are taking away and say so in
 * `docs/limitations.md`. The signature, for when the parameters improve:
 *
 *     GetHeaderRenderer: (params: GetHeaderParams) => (
 *         <div className="__CONTROL__-header">
 *             {params.colDefs[params.columnIndex].displayName}
 *         </div>
 *     ),
 */
