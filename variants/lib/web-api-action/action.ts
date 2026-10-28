/*
 * _template/variants/lib/web-api-action — calling a Web API action
 *
 * SHARED. Copied into a control as <Control>/lib/web-api-action/ and kept
 * current by `node ../_template/scripts/sync-rig.mjs --into .`. Edit the
 * template's copy and sync, never this one: an edited copy stops syncing.
 * Lifted 2026-10-28 from pcf-row-commands' RowCommands/action.ts (0.4.0) for
 * pcf-form-action-button 0.2.0, so a button on a form and a command on a row
 * make the same call.
 */

/**
 * A Web API action — a decision module: the address, the body and what the
 * answer means, with the one `fetch` kept to a function the suite hands a
 * stub. `context.webAPI` cannot make the call (it has the five CRUD methods
 * and nothing else), so it is a same-origin POST, which the session cookie
 * authorises.
 *
 * What it rests on was measured on a real form before a line of it existed:
 * pcf-hierarchy-view's 0.2.9 probe on a form (2026-10-15, A1–A4), and
 * pcf-row-commands' 0.3.4 probe on a subgrid and a main grid (SPEC.md, *0.4.0,
 * measured before it is written*, 2026-10-16):
 *
 *   - **P1** the entity set and the id column come from metadata
 *     (`keys.ts`): `cll_accounts`/`cll_accountid` on a subgrid,
 *     `accounts`/`accountid` on the main grid.
 *   - **P2** a bound action answers 200 with its response properties, in
 *     76–272 ms, and **its name is case-sensitive** — any other spelling is a
 *     404 on the action's own segment, which is why the refusal says so.
 *   - **P3** an entity reference is refused without its `@odata.type` and
 *     accepted with the *wrong* one, so the reference is always built here
 *     and never spelled by a maker.
 *   - **P4** an action with no response properties answers **204**.
 *   - **P5** the platform's own refusal is short and whole (*Entity
 *     'systemuser' With Id = … Does Not Exist*); a refused payload is
 *     1.5–3.6 KB with the server's stack after *InnerException :*. And a
 *     no-plug-in action on a record deleted meanwhile answers 200 — nothing
 *     here can tell, so a caller re-reads what it shows afterwards.
 */

/** Where the record's GUID goes in a parameter's text. */
export const TOKEN_ID = '{id}';

/** A whole parameter value that becomes a typed reference to the record. */
export const TOKEN_RECORD = '{record}';

/** A Web API action to call. */
export interface ActionDef {
    /** The message's unique name, as written — the server is case-sensitive about it. */
    name: string;
    /** Bound to the record's table (`<set>(<id>)/Microsoft.Dynamics.CRM.<name>`), or unbound. */
    bound: boolean;
    /** The body, as written; `{id}` and `{record}` are filled in per record. */
    parameters: Record<string, unknown>;
    /** A response property whose value is said after the call, or `null`. */
    result: string | null;
}

/** How a record of a table is addressed: its entity set and its id column. */
export interface RecordKeys {
    table: string;
    set: string;
    primaryId: string;
}

export interface Refusal {
    status: number;
    code: string | null;
    /** What the user is shown: the server's own words, without its exception type or stack. */
    sentence: string;
    /** A 404 on the action's own segment — a name the environment does not have, or spelled another way. */
    nameWrong: boolean;
}

export type ActionOutcome =
    | { ok: true; status: number; result: string | null }
    | { ok: false; refusal: Refusal };

export type ActionFetch = (url: string, init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    credentials: 'same-origin';
}) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * `Content-Type` is the header that matters — without it the server answers
 * 415 before it reads anything (measured 2026-10-15). The OData pair is not
 * required and is sent anyway, as every other Web API call sends it.
 */
const HEADERS: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
};

const INNER = 'InnerException : ';

/** A record id as a bare GUID — the server takes braces too (P3), but a URL segment is cleaner without. */
function bare(id: string): string {
    return id.replace(/^\{|\}$/g, '');
}

/** The path under `/api/data/v9.2/`: `<set>(<id>)/Microsoft.Dynamics.CRM.<name>` bound, `<name>` unbound. */
export function actionPath(action: ActionDef, keys: RecordKeys, id: string): string {
    return action.bound ? `${keys.set}(${bare(id)})/Microsoft.Dynamics.CRM.${action.name}` : action.name;
}

/** The reference `{record}` becomes: the record as an entity reference, typed, because untyped is refused (P3). */
export function recordReference(keys: RecordKeys, id: string): Record<string, string> {
    return { '@odata.type': `Microsoft.Dynamics.CRM.${keys.table}`, [keys.primaryId]: bare(id) };
}

/**
 * The body: the maker's parameters with the record filled in. A value that is
 * exactly `{record}` becomes the reference; `{id}` anywhere in a string
 * becomes the record's GUID (so `"/cll_accounts({id})"` works too). Deep,
 * through objects and arrays; anything else is sent as written.
 */
export function actionBody(parameters: Record<string, unknown>, keys: RecordKeys, id: string): Record<string, unknown> {
    const fill = (value: unknown): unknown => {
        if (value === TOKEN_RECORD) {
            return recordReference(keys, id);
        }

        if (typeof value === 'string') {
            return value.split(TOKEN_ID).join(bare(id));
        }

        if (Array.isArray(value)) {
            return value.map(fill);
        }

        if (value !== null && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fill(inner)]));
        }

        return value;
    };

    return fill(parameters) as Record<string, unknown>;
}

/**
 * The words to show for a refusal. When the message carries the server's
 * *InnerException*, the exception's own message — without its type name, the
 * `--->` chain or the stack — is the part a person can act on ("Cannot convert
 * the literal 'x' to the expected type 'Edm.Guid'."). Otherwise the message is
 * short and whole already, and is shown as it came. A body that is not JSON,
 * or empty (a 401), says the status.
 */
export function readRefusal(status: number, text: string, action: ActionDef): Refusal {
    let code: string | null = null;
    let message = '';

    try {
        const error = (JSON.parse(text) as { error?: { code?: unknown; message?: unknown } }).error;

        code = typeof error?.code === 'string' ? error.code : null;
        message = typeof error?.message === 'string' ? error.message : '';
    } catch {
        message = '';
    }

    const sentence = readableReason(message);

    return {
        status,
        code,
        sentence: sentence !== '' ? sentence : `HTTP ${status}`,
        nameWrong: status === 404 && code === '0x80060888' && message.includes(`'${action.bound ? 'Microsoft.Dynamics.CRM.' : ''}${action.name}'`),
    };
}

/**
 * A server's message as a person can read it: after *InnerException :* when
 * it is there — the payload family, 1.5–3.6 KB with the stack (P3) — the
 * exception's own words without its type name, `--->` chain or stack; else
 * the message as it came, which the platform's own refusals already are (P5).
 * At most 300 characters, cut at a sentence. Fit for every reason a control
 * shows, a `webAPI` write's included, not only an action's.
 */
export function readableReason(message: string): string {
    const at = message.indexOf(INNER);
    let sentence = at === -1 ? message : message.slice(at + INNER.length);

    sentence = sentence.split(' ---> ')[0].split('\n')[0].replace(/^(?:[A-Za-z]+\.)+[A-Za-z]*Exception:\s*/, '').trim();

    if (sentence.length > 300) {
        const cut = sentence.lastIndexOf('. ', 300);

        sentence = cut > 0 ? sentence.slice(0, cut + 1) : `${sentence.slice(0, 299)}…`;
    }

    return sentence;
}

/** The response property an action names, as text — or `null` when it names none, or the answer carries nothing (a 204, P4). */
export function readResult(text: string, property: string | null): string | null {
    if (property === null || text === '') {
        return null;
    }

    try {
        const value = (JSON.parse(text) as Record<string, unknown>)[property];

        if (value === null || value === undefined || value === '') {
            return null;
        }

        return typeof value === 'object' ? JSON.stringify(value).slice(0, 200) : String(value);
    } catch {
        return null;
    }
}

/**
 * One call. Resolves either way — a refusal is an answer, and offline is a
 * refusal with status 0 and the browser's own words — so a caller has one
 * path. An unbound action ignores `keys` and `id` unless its parameters say
 * `{id}` or `{record}`.
 */
export function callAction(
    fetchImpl: ActionFetch,
    clientUrl: string,
    action: ActionDef,
    keys: RecordKeys,
    id: string,
): Promise<ActionOutcome> {
    const url = `${clientUrl}/api/data/v9.2/${actionPath(action, keys, id)}`;

    return fetchImpl(url, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(actionBody(action.parameters, keys, id)),
        credentials: 'same-origin',
    }).then(
        (response) => response.text().then((text): ActionOutcome => (response.status >= 200 && response.status < 300
            ? { ok: true, status: response.status, result: readResult(text, action.result) }
            : { ok: false, refusal: readRefusal(response.status, text, action) })),
        (error: unknown): ActionOutcome => ({
            ok: false,
            refusal: { status: 0, code: null, sentence: error instanceof Error ? error.message : String(error), nameWrong: false },
        }),
    );
}
