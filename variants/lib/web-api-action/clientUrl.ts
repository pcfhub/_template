/*
 * _template/variants/lib/web-api-action — the organisation's URL
 *
 * SHARED. Copied into a control as <Control>/lib/web-api-action/ and kept
 * current by `node ../_template/scripts/sync-rig.mjs --into .`. Edit the
 * template's copy and sync, never this one: an edited copy stops syncing.
 * Lifted 2026-10-28 from pcf-row-commands' `organisationUrl` (0.3.0).
 */

/**
 * The organisation's URL, or `null` on a host that has none — the base every
 * same-origin call is made from, and the test of whether there is a
 * Dataverse behind the control at all.
 *
 * **`typeof x.method === 'function'` is not that test.** Measured with a host
 * probe on a real canvas app, 2026-09-22: **fifteen of fifteen** platform
 * surfaces are published there — `webAPI.deleteRecord` and
 * `navigation.openConfirmDialog` among them — and the ones safe to call throw
 * `Method not implemented.` from the call itself. So a presence test passes on
 * canvas and the feature is offered where it can only fail.
 *
 * What does discriminate is **an answer rather than a method**. `getClientUrl`
 * refuses by throwing, and a thrown refusal is an answer once it is caught. It
 * is undocumented — absent from the API reference entirely — which is why it is
 * read defensively and why the `Xrm` global is tried after it.
 */
export function organisationUrl(context: object): string | null {
    const ask = <T>(call: () => T): T | undefined => {
        try {
            return call();
        } catch {
            return undefined;
        }
    };

    const page = (context as { page?: { getClientUrl?: unknown } }).page;
    const fromPage = typeof page?.getClientUrl === 'function'
        ? ask(() => (page.getClientUrl as () => unknown)())
        : undefined;
    const fromGlobal = ask(() => (globalThis as {
        Xrm?: { Utility?: { getGlobalContext?: () => { getClientUrl?: () => unknown } } };
    }).Xrm?.Utility?.getGlobalContext?.()?.getClientUrl?.());

    const url = [fromPage, fromGlobal].find((candidate) => typeof candidate === 'string' && candidate !== '');

    return typeof url === 'string' ? url : null;
}
