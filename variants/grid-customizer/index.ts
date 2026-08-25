import * as React from 'react';
import { IInputs, IOutputs } from './generated/ManifestTypes';
import { cellEditorOverrides } from './customizers/CellEditorOverrides';
import { cellRendererOverrides } from './customizers/CellRendererOverrides';
import { PAOneGridCustomizer } from './types';

/**
 * The attribute the stylesheet reads to pick its palette, and the number of
 * live controls publishing it.
 *
 * The slug rather than the control name, because this ends up as an HTML
 * attribute and a slug is lowercase by construction — and it is per control, so
 * two customizers on one page do not fight over it.
 *
 * The count is what makes `destroy` safe. A page can hold more than one
 * customized grid, each instantiating this control, and the attribute is global
 * to the document — so an instance that cleared it on the way out would strip
 * the theme from grids still on screen. The last one to leave clears it.
 */
const THEME_ATTRIBUTE = 'data-__SLUG__-theme';

let publishers = 0;

/**
 * A grid customizer: a control whose entire output is other controls' cells.
 *
 * Nothing here renders. `updateView` returns an empty fragment on purpose, and
 * the control's whole contribution is the payload fired below — the Power Apps
 * grid holds the renderers and editors and calls them per cell, for as long as
 * the grid is on screen.
 *
 * Assigned to a grid rather than dropped on a form: Settings → Customizations →
 * the table → Controls → Power Apps grid control → *Customizer control* =
 * `{prefix}___NAMESPACE__.__CONTROL__`. See docs/installation.md — a customizer
 * that is built and imported but never named on a grid is silently inert, which
 * is the single most common way this kind of control appears broken.
 *
 * https://learn.microsoft.com/en-us/power-apps/developer/component-framework/customize-editable-grid-control
 */
export class __CONTROL__
    implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
    /**
     * Whether the payload has reached the grid.
     *
     * The grid registers one customizer per grid and this control has exactly
     * one payload to give it, so firing twice would re-register the same
     * overrides against a host that never asked for them again.
     */
    private fired = false;

    public init(context: ComponentFramework.Context<IInputs>): void {
        publishers++;
        this.fire(context);
        this.publishTheme(context);
    }

    /**
     * Empty, and it has to stay that way.
     *
     * The grid is already rendering this control's work through the payload
     * fired below. Anything returned here would be drawn *beside* the grid, in
     * whatever container the host gave the customizer — which on a real grid is
     * a zero-size element nobody can see, and on a preview surface is a second
     * thing on screen competing with the cells.
     *
     * It still calls `fire`, because the event name is a *bound* property and a
     * bound property is not guaranteed to carry its value by the time `init`
     * runs. Firing only from `init` — which is what Microsoft's own template
     * does — means a name that arrives one render later is dropped permanently
     * and the control is inert for the life of the grid, with nothing logged,
     * on the one surface where it was supposed to work. The latch is what makes
     * calling it from both places safe.
     */
    public updateView(
        context: ComponentFramework.Context<IInputs>,
    ): React.ReactElement {
        this.fire(context);
        this.publishTheme(context);

        return React.createElement(React.Fragment);
    }

    public getOutputs(): IOutputs {
        // `EventName` is bound, but the host writes it and this control never
        // does. An empty object is "no change to anything", which is the truth
        // here — not the usual bound-property case where omitting a value
        // silently refuses a clear.
        return {};
    }

    public destroy(): void {
        // The grid disposes the elements it mounted; the only thing held here
        // is the document-level theme attribute, and only until the last
        // customized grid on the page goes with it.
        publishers = Math.max(publishers - 1, 0);

        if (publishers === 0) {
            document.documentElement.removeAttribute(THEME_ATTRIBUTE);
        }
    }

    /**
     * Tell the stylesheet which theme the host is drawing in.
     *
     * The cells a customizer styles are mounted per cell with no provider and
     * no context above them, so a renderer cannot read the theme — but the
     * control can, and `:root` is the one element every cell of every grid
     * reliably inherits from. The stylesheet keys its dark palette off this
     * attribute.
     *
     * Do not reach for `@media (prefers-color-scheme: dark)` instead. It is the
     * obvious hook and it is the wrong question: a model-driven app carries its
     * own theme, independent of the operating system, so a user on an OS-dark
     * machine looking at a light app gets the dark palette — which for anything
     * painted straight onto the cell background, an empty-value dash or a
     * coloured number, means light grey text on white. No palette dodges this
     * either: nothing clears 4.5:1 against both #ffffff and Fluent's dark
     * #292827, so a customizer that colours text has to know its surface.
     *
     * `fluentDesignLanguage` is typed as Fluent v9 theming data and a
     * customizer declares the Fluent 8 platform library, so the platform may
     * simply not populate it here. That is why an absent value writes nothing
     * rather than assuming light: leaving the attribute off hands the decision
     * to the media-query fallback in the CSS, and assuming would be the same
     * guess this method exists to stop.
     */
    private publishTheme(context: ComponentFramework.Context<IInputs>): void {
        const isDarkTheme = context.fluentDesignLanguage?.isDarkTheme;

        if (isDarkTheme === undefined) {
            return;
        }

        document.documentElement.setAttribute(
            THEME_ATTRIBUTE,
            isDarkTheme ? 'dark' : 'light',
        );
    }

    /**
     * Hand the grid its renderers and editors, once.
     *
     * The event *name* comes from the host — the grid generates it and passes
     * it in through the bound property — so this control never invents one, and
     * an empty value means the grid is not listening and there is nothing to
     * fire at. That guard is not defensive coding: on any surface that is not a
     * customized grid (a form, a preview harness, a canvas app) this control is
     * a no-op by design, and firing a made-up event there would be noise.
     *
     * `factory.fireEvent` is cast through, because
     * `@types/powerapps-component-framework` does not declare it —
     * `interface Factory` has exactly `getPopupService` and `requestRender`.
     * The platform has it; the type package has never caught up, and
     * Microsoft's own template does exactly this.
     */
    private fire(context: ComponentFramework.Context<IInputs>): void {
        if (this.fired) {
            return;
        }

        const eventName = context.parameters.EventName.raw;

        if (!eventName) {
            return;
        }

        // The payload has three channels and this fires two of them. The third,
        // `gridCustomizer`, describes the grid *around* the cells — the loading
        // row, the empty-state overlay, the column headers — and is scaffolded,
        // unwired, in `customizers/GridCustomizerOverrides.tsx`. To use it:
        //
        //     import { createGridCustomizer } from './customizers/GridCustomizerOverrides';
        //
        //     const customizer: PAOneGridCustomizer = {
        //         cellRendererOverrides,
        //         cellEditorOverrides,
        //         gridCustomizer: createGridCustomizer(context.resources),
        //     };
        //
        // A factory rather than a constant because those members are called with
        // no context and no parameters, so anything they display has to be
        // closed over here, where a context still exists. Read that file's
        // header before wiring it: its members cannot decline the way a cell
        // override can, so implementing one replaces the grid's version for
        // every column of every view of the table.
        const customizer: PAOneGridCustomizer = {
            cellRendererOverrides,
            cellEditorOverrides,
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (context as any).factory.fireEvent(eventName, customizer);

        this.fired = true;
    }
}
