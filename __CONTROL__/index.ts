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

        this.container.classList.add('__CONTROL__');
        this.container.append(this.input, this.message);

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
            this.input.hidden = true;
            this.message.hidden = false;
            this.message.textContent = context.resources.getString('__CONTROL___NoAccess');

            return;
        }

        this.input.hidden = false;

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

    private onInput = (): void => {
        this.value = this.input.value;
        this.notifyOutputChanged();
    };
}
