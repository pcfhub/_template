/* ======================================================================== *
 *  WORKED EXAMPLE — replace everything below with assertions about your own
 *  control. It exercises the scaffolded yes/no control (`setup.mjs --bind
 *  yesno`): a checkbox and the column's own label for its state — and the
 *  states a form puts every field control into.
 *
 *  Every mount starts from COLUMN above: a yes/no column holding false.
 * ======================================================================== */

/** The checkbox, and the words beside it. */
const box = (handle) => handle.find('input');
const words = (handle) => handle.find('.__CONTROL__-text').textContent;
const message = (handle) => handle.find('.__CONTROL__-message').textContent;

/** A click, as the browser reports one: the state flips, then `change`. */
function click(handle) {
    const input = box(handle);

    input.checked = !input.checked;
    input.dispatchEvent({ type: 'change', target: input, preventDefault() {} });
}

const plain = mount({});

check(
    "shows the column's state, with the column's own label for it",
    box(plain).checked === false && words(plain) === 'No',
    words(plain),
);

const renamed = mount({ value: true, optionLabels: ['Do Not Allow', 'Allow'] });

check(
    "a maker's own labels are the ones shown — never the control's Yes and No over them",
    box(renamed).checked === true && words(renamed) === 'Allow',
    words(renamed),
);

check(
    'a canvas app has no column: its placeholder No and Yes are not believed, and the .resx stands in for the labels',
    words(mount({ host: 'canvas', value: true })) === 'resx:__CONTROL___Yes',
);

check(
    "the checkbox's accessible name is the form's own label, and the .resx is the fallback",
    box(plain).getAttribute('aria-label') === 'Account name'
        && box(mount({ label: '' })).getAttribute('aria-label') === 'resx:__CONTROL___Name',
);

/* --------------------------------------------------- a click is a write */

const clicked = mount({});

click(clicked);

check(
    'a click writes the new state, once, and the words follow it',
    clicked.outputs().value === true && clicked.notifications() === 1 && words(clicked) === 'Yes',
    JSON.stringify(clicked.outputs()),
);

/*
 * The echo window. Two quick clicks leave both values "recent", so a list of
 * them — the text scaffold's guard — would take every later value for an echo.
 * Inside the window an echo is ignored in any order; after it, the form's own
 * value is taken.
 */
const quick = mount({});

click(quick);
time.advance(100);
click(quick);
time.advance(200);

// The first click's echo, arriving after the second click was made.
quick.update({ value: true });

check(
    'a late echo of an earlier click does not flip the box back',
    box(quick).checked === false && quick.outputs().value === false,
    String(box(quick).checked),
);

// The second click's echo, then — after the window — a business rule.
quick.update({ value: false });
time.advance(1500);
quick.update({ value: true });

check(
    '…and once the echo window has passed, a value from the form — a business rule — is taken',
    box(quick).checked === true && words(quick) === 'Yes',
    String(box(quick).checked),
);

const demo = mount({});

click(demo);
demo.update({ value: false });

check(
    "a repeat of the host's last value is not news — the hub demo's re-render with its preset keeps the click",
    box(demo).checked === true && demo.outputs().value === true,
    String(box(demo).checked),
);

/* ------------------------------------------------------ the form's states */

const denied = mount({ security: 'no-access', value: null });

check(
    'a column the user may not read says so, and nothing is handed back — not even false',
    denied.find('.__CONTROL__-check').hidden === true && message(denied) === 'resx:__CONTROL___NoAccess'
        && !('value' in denied.outputs()),
    JSON.stringify(denied.outputs()),
);

check(
    'read-only for either reason — the form, or the column — disables the checkbox',
    box(mount({ disabled: true })).disabled === true && box(mount({ security: 'read-only' })).disabled === true,
);

const invalid = mount({ error: true });

check(
    "the platform's own validation message is shown, and the checkbox marked invalid",
    message(invalid) === 'Enter a value with at least three characters.' && box(invalid).getAttribute('aria-invalid') === 'true',
);

/* ------------------------------------------------------------ either way */

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

