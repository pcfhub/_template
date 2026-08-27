import { IInputs, IOutputs } from './generated/ManifestTypes';

/**
 * A standard (non-virtual) field control.
 *
 * The four lifecycle methods below are the whole contract with the platform.
 * The one thing worth knowing that the docs bury: `updateView` runs on every
 * change to *any* bound value, including ones this control caused itself, so
 * anything expensive belongs behind a comparison rather than at the top.
 *
 * `render()` below reads more of `context` than a first control usually does.
 * That is deliberate: every branch in it is a state a real form puts a control
 * into, and each one is invisible until a customer hits it. Delete the ones
 * that genuinely do not apply — but delete them knowingly.
 */
export class __CONTROL__ implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container!: HTMLDivElement;
    /** The filled surface the input sits in. See the stylesheet. */
    private field!: HTMLDivElement;
    private input!: HTMLInputElement;
    private message!: HTMLParagraphElement;
    private notifyOutputChanged!: () => void;
    private value = '';

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement,
    ): void {
        this.container = container;
        this.notifyOutputChanged = notifyOutputChanged;

        this.input = document.createElement('input');
        this.input.className = '__CONTROL__-input';
        this.input.type = 'text';
        this.input.addEventListener('input', this.onInput);

        // The platform's own validation message. Without somewhere to put it,
        // a failing business rule is silent inside a code component.
        this.message = document.createElement('p');
        this.message.className = '__CONTROL__-message';

        /*
         * The input lives inside a surface rather than being the surface.
         *
         * The platform's own fields are a single filled box that owns the
         * border, the hover and the focus underline — and anything trailing, a
         * button or an icon, goes *inside* it rather than beside it. Starting
         * with the wrapper costs one element now and saves restyling the whole
         * control the first time it grows an affordance.
         */
        this.field = document.createElement('div');
        this.field.className = '__CONTROL__-field';
        this.field.append(this.input);

        this.container.classList.add('__CONTROL__');
        this.container.append(this.field, this.message);

        this.render(context);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.render(context);
    }

    public getOutputs(): IOutputs {
        return { value: this.value };
    }

    public destroy(): void {
        this.input.removeEventListener('input', this.onInput);
    }

    private render(context: ComponentFramework.Context<IInputs>): void {
        const parameter = context.parameters.value;

        // Before the visibility guard, so the no-access message is themed too.
        this.applyTheme(context);

        // Canvas relies on this; a model-driven form hides the section itself.
        // Honouring it costs one class and covers both hosts.
        this.container.classList.toggle('__CONTROL__--hidden', !context.mode.isVisible);

        if (!context.mode.isVisible) {
            return;
        }

        // Field-level security is NOT the same as the form's read-only state,
        // and conflating them is a real information bug. A user denied read
        // access gets `raw === null` — indistinguishable from "empty" unless
        // `security.readable` is checked, so an unchecked control renders
        // "no value" where the truth is "not allowed to see it".
        const security = parameter.security;

        if (security !== undefined && !security.readable) {
            // The surface goes, not just the input inside it — otherwise the
            // form is left with an empty filled box above the message.
            this.field.hidden = true;
            this.message.hidden = false;
            this.message.textContent = context.resources.getString('__CONTROL___NoAccess');

            return;
        }

        this.field.hidden = false;

        const incoming = parameter.raw ?? '';

        // Guarded, not assigned unconditionally: writing `value` while the user
        // is typing moves the caret to the end of the field on every keystroke.
        if (incoming !== this.value) {
            this.value = incoming;
            this.input.value = incoming;
        }

        this.input.placeholder = context.parameters.placeholder.raw ?? '';

        // Two independent reasons to be read-only. `isControlDisabled` is the
        // form's; `security.editable` is the column's.
        this.input.disabled =
            context.mode.isControlDisabled || (security !== undefined && !security.editable);

        // The class is what the fill, the border and the underline key off.
        // Fluent's disabled field is a different surface rather than a dimmer
        // one, and `:disabled` on the input cannot reach the box around it.
        this.container.classList.toggle('__CONTROL__--disabled', this.input.disabled);

        // `attributes` is optional because a canvas app has no column metadata
        // at all. That single `?` is the whole canvas/model-driven difference:
        // narrow behaviour when it is present, do not require it.
        const maxLength = parameter.attributes?.MaxLength;

        if (maxLength !== undefined) {
            this.input.maxLength = maxLength;
        }

        // `mode.label` is the label the maker gave the field on this form,
        // which is a better accessible name than anything shipped in the .resx.
        // The resource string is the fallback, not the default.
        this.input.setAttribute(
            'aria-label',
            context.mode.label || context.resources.getString('__CONTROL___Name'),
        );

        this.container.dir = context.userSettings.isRTL ? 'rtl' : 'ltr';
        this.container.classList.toggle('__CONTROL__--invalid', parameter.error);
        this.input.setAttribute('aria-invalid', String(parameter.error));

        this.message.hidden = !parameter.error;
        this.message.textContent = parameter.error ? parameter.errorMessage : '';
    }

    /**
     * Picks which set of colour fallbacks the stylesheet uses.
     *
     * Only the fallbacks. Where the host publishes Fluent's design tokens — a
     * model-driven form does, via the `FluentProvider` it already mounts above
     * every code component — the CSS reads them straight through `var()` and
     * this changes nothing. That is what stops the control fighting a host that
     * knows its own theme better than this code does.
     *
     * `@media (prefers-color-scheme: dark)` is the obvious hook and it is the
     * wrong question: a model-driven app carries its own theme and the user's
     * OS setting says nothing about it, so an OS-dark machine on a light app
     * would render a dark control on a white form. Absent means absent — no
     * class, light fallbacks, the same guess the host made by not saying.
     */
    private applyTheme(context: ComponentFramework.Context<IInputs>): void {
        const isDarkTheme = context.fluentDesignLanguage?.isDarkTheme;

        if (isDarkTheme === undefined) {
            return;
        }

        this.container.classList.toggle('__CONTROL__--dark', isDarkTheme);
    }

    private onInput = (): void => {
        this.value = this.input.value;
        this.notifyOutputChanged();
    };
}
