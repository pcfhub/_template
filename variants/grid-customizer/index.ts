import * as React from 'react';
import { IInputs, IOutputs } from './generated/ManifestTypes';
import { cellEditorOverrides } from './customizers/CellEditorOverrides';
import { cellRendererOverrides } from './customizers/CellRendererOverrides';
import { PAOneGridCustomizer } from './types';

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
        this.fire(context);
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
        // The grid disposes the elements it mounted; nothing is held here.
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

        const customizer: PAOneGridCustomizer = {
            cellRendererOverrides,
            cellEditorOverrides,
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (context as any).factory.fireEvent(eventName, customizer);

        this.fired = true;
    }
}
