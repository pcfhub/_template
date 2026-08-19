import * as React from 'react';

export interface IProps {
    value: string;
    placeholder: string;
    disabled: boolean;
    onChange: (next: string) => void;
}

/**
 * Selection and edit state live here rather than on the control class.
 *
 * On a real form either would work, because the platform re-renders after
 * `notifyOutputChanged()`. PCFHub's demo harness does not: its
 * `notifyOutputChanged` posts the outputs to the parent window and neither
 * re-renders nor writes the value back. A component that rendered straight from
 * props would therefore look dead in the published demo — every keystroke
 * accepted, nothing changing.
 *
 * The effect resyncs when the platform hands down a genuinely different value,
 * so a form-driven change still wins over local state.
 */
export function __CONTROL__Control(props: IProps): React.ReactElement {
    const [value, setValue] = React.useState(props.value);

    React.useEffect(() => {
        setValue(props.value);
    }, [props.value]);

    return (
        <input
            className="__CONTROL__-input"
            type="text"
            value={value}
            placeholder={props.placeholder}
            disabled={props.disabled}
            onChange={(event) => {
                setValue(event.target.value);
                props.onChange(event.target.value);
            }}
        />
    );
}
