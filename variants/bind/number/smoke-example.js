/* ======================================================================== *
 *  WORKED EXAMPLE — replace everything below with assertions about your own
 *  control. It exercises the scaffolded number control (`setup.mjs --bind
 *  number`): one box, typed in the user's format, committed on Enter or when
 *  it loses focus, refusing what the column cannot hold — and the states a
 *  form puts every field control into.
 *
 *  Every mount starts from COLUMN above: a Decimal column holding 1234.5,
 *  bound through the four-type group the manifest declares.
 * ======================================================================== */

/** The control's box. */
const box = (handle) => handle.find('input');

/** What the message line says. */
const message = (handle) => handle.find('.__CONTROL__-message').textContent;

/** Select everything in the box and type over it, as a user does. */
function retype(handle, text) {
    const input = box(handle);

    input.focus();
    input.setSelectionRange(0, input.value.length);

    if (input.value !== '') {
        dom.user.backspace(input);
    }

    dom.user.type(input, text);

    return input;
}

/** A key the box handles itself — Enter commits, Escape takes a refusal back. */
function press(handle, key) {
    box(handle).dispatchEvent({ type: 'keydown', key, target: box(handle), preventDefault() {} });
}

const plain = mount({});

check(
    "shows the platform's own formatted value at rest",
    box(plain).value === '1,234.50',
    box(plain).value,
);

check(
    "the box's accessible name is the form's own label, and the .resx is the fallback",
    box(plain).getAttribute('aria-label') === 'Account name'
        && box(mount({ label: '' })).getAttribute('aria-label') === 'resx:__CONTROL___Name',
);

box(plain).focus();

check(
    "focusing shows the number to edit — no grouping, the user's decimal separator",
    box(plain).value === '1234.5',
    box(plain).value,
);

box(plain).blur();

check('leaving the box unchanged writes nothing', plain.notifications() === 0);

/* -------------------------------------------------- typed, then committed */

const typed = mount({});

retype(typed, '2,500.75');

check('nothing is written while the user is still typing', typed.notifications() === 0);

box(typed).blur();

check(
    "a number typed in the user's format is written when the box loses focus",
    typed.outputs().value === 2500.75 && typed.notifications() === 1,
    JSON.stringify(typed.outputs()),
);

check(
    '…and the box goes back to the formatted number, through context.formatting',
    box(typed).value === '2,500.75' && typed.calls().some((call) => call.startsWith('formatting.formatDecimal')),
    box(typed).value,
);

const german = mount({ locale: 'de-DE' });

check("a German user sees the German form at rest", box(german).value === '1.234,50', box(german).value);

retype(german, '2.500,75');
press(german, 'Enter');

check(
    "a German user's 2.500,75 is 2500.75 — and Enter commits without leaving the box",
    german.outputs().value === 2500.75 && dom.document.activeElement === box(german),
    JSON.stringify(german.outputs()),
);

retype(german, '1.5');
press(german, 'Enter');

check(
    '…while 1.5 is not a number to a German user: a group separator is only taken where it groups',
    german.outputs().value === 2500.75 && message(german) === 'resx:__CONTROL___NotANumber',
    message(german),
);

/* ------------------------------------------------------------ refusals */

const wrong = mount({});

retype(wrong, 'abc');
box(wrong).blur();

check(
    'text that is not a number is refused — nothing written, the reason shown, the text kept to correct',
    wrong.notifications() === 0 && box(wrong).value === 'abc'
        && message(wrong) === 'resx:__CONTROL___NotANumber' && box(wrong).getAttribute('aria-invalid') === 'true',
    `${box(wrong).value} / ${message(wrong)}`,
);

wrong.update({});

check('…and a re-render does not throw the typed text away', box(wrong).value === 'abc', box(wrong).value);

box(wrong).focus();
press(wrong, 'Escape');

check(
    'Escape takes the refusal back: the column\'s number returns and the message goes',
    box(wrong).value === '1234.5' && message(wrong) === '' && box(wrong).getAttribute('aria-invalid') === 'false',
    box(wrong).value,
);

const ranged = mount({ value: 5, minValue: 0, maxValue: 10 });

retype(ranged, '11');
box(ranged).blur();

check(
    "a value outside the column's declared range is refused at the box, not at Save",
    ranged.notifications() === 0 && message(ranged).startsWith('resx:__CONTROL___OutOfRange'),
    message(ranged),
);

const whole = mount({ valueType: 'Whole.None', value: 3 });

retype(whole, '3.5');
box(whole).blur();

check(
    'a fraction in a whole-number column is refused, not rounded',
    whole.notifications() === 0 && message(whole) === 'resx:__CONTROL___WholeOnly',
    message(whole),
);

const reportsGroup = mount({ valueType: 'Whole.None', value: 3, typeReport: 'group' });

retype(reportsGroup, '3.5');
box(reportsGroup).blur();

check(
    '…on a host that reports the whole type group as `type` too — attributes are the evidence, not the type',
    reportsGroup.notifications() === 0 && message(reportsGroup) === 'resx:__CONTROL___WholeOnly',
);

const misreported = mount({ valueType: 'Decimal', value: 3, typeReport: 'wrong-member' });

retype(misreported, '3.5');
box(misreported).blur();

check(
    '…and a decimal column a host misreports as Whole.None still takes 3.5, because its Precision says so',
    misreported.outputs().value === 3.5,
    JSON.stringify(misreported.outputs()),
);

const canvas = mount({ valueType: 'Whole.None', value: 3, host: 'canvas', typeReport: 'group' });

retype(canvas, '3.5');
box(canvas).blur();

check(
    'in a canvas app — no column behind the value, a group string for `type` — the placeholder Precision of 0 is not believed, and the box takes a fraction',
    canvas.outputs().value === 3.5,
    JSON.stringify(canvas.outputs()),
);

const precise = mount({ value: 1, precision: 1 });

retype(precise, '1.26');
box(precise).blur();

check("a number is rounded to the column's precision before it is written", precise.outputs().value === 1.3, JSON.stringify(precise.outputs()));

/* ------------------------------------------------- the echo of a commit */

const echoed = mount({ value: 1 });

retype(echoed, '5');
press(echoed, 'Enter');
retype(echoed, '6');
press(echoed, 'Enter');
box(echoed).blur();

// The echoes arrive after the user has left the box — the newest first, then
// the late one, the order a form produced. Taken for the form's own change,
// the late 5 would be shown, and the user's 6 gone without a word.
echoed.update({ value: 6 });
echoed.update({ value: 5 });

check(
    'a late echo of an earlier commit does not put the older number back',
    echoed.outputs().value === 6 && box(echoed).value === '6.00' && echoed.notifications() === 2,
    `${box(echoed).value}, ${echoed.notifications()} write(s)`,
);

echoed.update({ value: 42 });

check('a value the control never wrote is taken from the form', box(echoed).value === '42.00', box(echoed).value);

const demo = mount({ value: 10 });

retype(demo, '20');
box(demo).blur();
demo.update({ value: 10 });

check(
    "a repeat of the host's last value is not news — the hub demo's re-render keeps what was committed",
    demo.outputs().value === 20 && box(demo).value === '20.00',
    box(demo).value,
);

/* ------------------------------------------------------ the form's states */

const denied = mount({ security: 'no-access', value: null });

check(
    'a column the user may not read says so, rather than showing an empty box',
    denied.find('.__CONTROL__-field').hidden === true && message(denied) === 'resx:__CONTROL___NoAccess',
);

check(
    'read-only for either reason — the form, or the column — disables the box',
    box(mount({ disabled: true })).disabled === true && box(mount({ security: 'read-only' })).disabled === true,
);

const invalid = mount({ error: true });

check(
    "the platform's own validation message is shown, and the box marked invalid",
    message(invalid) === 'Enter a value with at least three characters.' && box(invalid).getAttribute('aria-invalid') === 'true',
    message(invalid),
);

/* ------------------------------------------------------------ either way */

/*
 * **`null` is not `undefined`.** The assertion worth keeping when the rest of
 * the example goes: a cleared column has to travel back as `null`.
 */
const cleared = mount({});

retype(cleared, '');
box(cleared).blur();

check(
    'emptying the box writes null — a clear the platform can act on, not "no change"',
    cleared.outputs().value === null && cleared.notifications() === 1,
    `getOutputs() returned ${JSON.stringify(cleared.outputs())}`,
);

const sized = mount({ width: 320, formFactor: 'phone' });

check(
    'renders in a phone-sized container',
    Boolean(box(sized)),
    `trackContainerResize: ${sized.calls().some((call) => call.indexOf('trackContainerResize') === 0) ? 'called' : 'never called'}`,
);

check(
    'renders nothing visible when the host says it is hidden',
    mount({ visible: false }).container.classList.contains('__CONTROL__--hidden'),
);

