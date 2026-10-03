import { IInputs, IOutputs } from './generated/ManifestTypes';

/**
 * A standard field control bound to a **yes/no** column — the scaffold
 * `setup.mjs --bind yesno` writes.
 *
 * **Rule out the platform before building on it.** A model-driven form already
 * offers a Toggle and a Checkbox for a yes/no column (Learn, *List of controls
 * available for model-driven apps*), so a control here earns its place by
 * doing what those cannot: a consent with its own wording, a flag drawn as an
 * icon, a choice that asks before it changes.
 *
 * Three things a yes/no column brings:
 *
 * - **It shows the column's own two labels.** A maker renames them — "Allow"
 *   and "Do Not Allow" on `donotemail` — and a control saying Yes and No over
 *   them contradicts the rest of the form. They come from
 *   `attributes.Options`, false first; a canvas app has no `attributes`, and
 *   the resx's Yes and No stand in.
 * - **`raw` is a boolean.** A readable yes/no column always holds one of its
 *   two values; `null` here means the user may not read it, or nothing was
 *   mapped, and is never written back.
 * - **Its echo guard is a window, not a list.** See `written`.
 */
interface YesNoAttributes {
    Options?: { Label?: string; Value?: number }[];
}

/**
 * How long a write stays "ours". The platform echoes a write back in 120 to
 * 430 ms, one of them out of order at typing speed (pcf-input-mask P2,
 * measured 2026-09-28); a second covers that with room to spare.
 */
const ECHO_WINDOW_MS = 1000;

export class __CONTROL__ implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container!: HTMLDivElement;
    private label!: HTMLLabelElement;
    private box!: HTMLInputElement;
    private text!: HTMLSpanElement;
    private message!: HTMLParagraphElement;
    private notifyOutputChanged!: () => void;
    private context!: ComponentFramework.Context<IInputs>;

    private value: boolean | null = null;

    /**
     * The writes still inside the echo window, with when each was made.
     *
     * The text scaffold keeps a list of recent values and ignores an incoming
     * one found in it. That cannot work for a column with two values: after
     * two clicks both are "recent", and a business rule setting the column
     * would be taken for an echo for ever. So a write is ours only for the
     * window an echo arrives in, and after it every incoming value is the
     * form's own.
     */
    private written: { value: boolean; at: number }[] = [];

    /** See the text scaffold: the host's last value; a repeat is not news. */
    private lastIncoming: boolean | null | undefined = undefined;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement,
    ): void {
        this.container = container;
        this.notifyOutputChanged = notifyOutputChanged;
        this.context = context;

        this.box = document.createElement('input');
        this.box.type = 'checkbox';
        this.box.className = '__CONTROL__-box';
        this.box.addEventListener('change', this.onChange);

        this.text = document.createElement('span');
        this.text.className = '__CONTROL__-text';

        // A <label> around both, so the words are a click target too.
        this.label = document.createElement('label');
        this.label.className = '__CONTROL__-check';
        this.label.append(this.box, this.text);

        this.message = document.createElement('p');
        this.message.className = '__CONTROL__-message';

        this.container.classList.add('__CONTROL__');
        this.container.append(this.label, this.message);

        this.render(context);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.render(context);
    }

    public getOutputs(): IOutputs {
        // Nothing to hand back is "no change" — a key left out, never a
        // `null` a yes/no column cannot hold.
        return this.value === null ? {} : { value: this.value };
    }

    public destroy(): void {
        this.box.removeEventListener('change', this.onChange);
    }

    private render(context: ComponentFramework.Context<IInputs>): void {
        this.context = context;

        const parameter = context.parameters.value;

        this.applyTheme(context);
        this.container.classList.toggle('__CONTROL__--hidden', !context.mode.isVisible);

        if (!context.mode.isVisible) {
            return;
        }

        const security = parameter.security;

        if (security?.readable === false) {
            this.label.hidden = true;
            this.message.hidden = false;
            this.message.textContent = context.resources.getString('__CONTROL___NoAccess');

            return;
        }

        this.label.hidden = false;

        const incoming = typeof parameter.raw === 'boolean' ? parameter.raw : null;
        const repeated = incoming === this.lastIncoming;

        this.lastIncoming = incoming;

        const now = Date.now();

        this.written = this.written.filter((write) => now - write.at < ECHO_WINDOW_MS);

        const echo = this.written.some((write) => write.value === incoming);

        if (!repeated && !echo && incoming !== this.value) {
            this.written = [];
            this.value = incoming;
        }

        this.box.checked = this.value === true;
        this.text.textContent = this.labelFor(this.value === true);
        this.box.disabled = context.mode.isControlDisabled || security?.editable === false;
        this.container.classList.toggle('__CONTROL__--disabled', this.box.disabled);
        this.box.setAttribute(
            'aria-label',
            context.mode.label || context.resources.getString('__CONTROL___Name'),
        );
        this.container.dir = context.userSettings.isRTL ? 'rtl' : 'ltr';
        this.container.classList.toggle('__CONTROL__--invalid', parameter.error);
        this.box.setAttribute('aria-invalid', String(parameter.error));
        this.message.hidden = !parameter.error;
        this.message.textContent = parameter.error ? parameter.errorMessage : '';
    }

    /** The column's label for a state, false first; the resx where there is no metadata. */
    private labelFor(state: boolean): string {
        const options = ((this.context.parameters.value.attributes ?? {}) as YesNoAttributes).Options;
        const option = options?.find((candidate) => candidate.Value === (state ? 1 : 0));

        return option?.Label || this.context.resources.getString(state ? '__CONTROL___Yes' : '__CONTROL___No');
    }

    private onChange = (): void => {
        this.value = this.box.checked;
        this.written.push({ value: this.value, at: Date.now() });
        this.text.textContent = this.labelFor(this.value);
        this.notifyOutputChanged();
    };

    /** See the text scaffold: only the fallbacks follow this; the tokens win where published. */
    private applyTheme(context: ComponentFramework.Context<IInputs>): void {
        const isDarkTheme = context.fluentDesignLanguage?.isDarkTheme;

        if (isDarkTheme === undefined) {
            return;
        }

        this.container.classList.toggle('__CONTROL__--dark', isDarkTheme);
    }
}
