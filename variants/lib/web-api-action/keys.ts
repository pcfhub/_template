/*
 * _template/variants/lib/web-api-action — how a table's records are addressed
 *
 * SHARED. Copied into a control as <Control>/lib/web-api-action/ and kept
 * current by `node ../_template/scripts/sync-rig.mjs --into .`. Edit the
 * template's copy and sync, never this one: an edited copy stops syncing.
 * Lifted 2026-10-28 from pcf-row-commands' `rowKeys` (0.4.0).
 */

import { RecordKeys } from './action';

/** The one call of `context.utils` this needs, typed loosely: the host's bag, not the typings'. */
export interface MetadataUtils {
    getEntityMetadata?: (name: string) => Promise<{ EntitySetName?: unknown; PrimaryIdAttribute?: unknown }>;
}

export type DefinitionsFetch = (url: string, init: {
    headers: Record<string, string>;
    credentials: 'same-origin';
}) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * A table's entity set and id column, from `utils.getEntityMetadata` where the
 * host offers it — measured from a dataset control on a subgrid and a main
 * grid (pcf-row-commands P1, 2026-10-16) — and from
 * `EntityDefinitions(LogicalName='…')` where it cannot say. `null` when
 * neither answers; the caller says so rather than guessing a plural.
 *
 * No cache here: a control keeps one per table, and forgets a `null` so the
 * next press asks again rather than remembering a table as unaddressable.
 */
export function loadRecordKeys(
    utils: MetadataUtils | undefined,
    clientUrl: string | null,
    fetchImpl: DefinitionsFetch | undefined,
    table: string,
): Promise<RecordKeys | null> {
    const fromMetadata = (): Promise<RecordKeys | null> => {
        if (typeof utils?.getEntityMetadata !== 'function') {
            return Promise.resolve(null);
        }

        try {
            return Promise.resolve(utils.getEntityMetadata(table)).then(
                (meta) => (typeof meta?.EntitySetName === 'string' && meta.EntitySetName !== '' && typeof meta.PrimaryIdAttribute === 'string' && meta.PrimaryIdAttribute !== ''
                    ? { table, set: meta.EntitySetName, primaryId: meta.PrimaryIdAttribute }
                    : null),
                () => null,
            );
        } catch {
            return Promise.resolve(null);
        }
    };

    const fromDefinitions = (): Promise<RecordKeys | null> => {
        if (clientUrl === null || typeof fetchImpl !== 'function') {
            return Promise.resolve(null);
        }

        return fetchImpl(`${clientUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${table}')?$select=EntitySetName,PrimaryIdAttribute`, {
            headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' },
            credentials: 'same-origin',
        })
            .then((response) => (response.ok ? response.json() : null))
            .then(
                (body) => {
                    const found = body as { EntitySetName?: unknown; PrimaryIdAttribute?: unknown } | null;

                    return found && typeof found.EntitySetName === 'string' && typeof found.PrimaryIdAttribute === 'string'
                        ? { table, set: found.EntitySetName, primaryId: found.PrimaryIdAttribute }
                        : null;
                },
                () => null,
            );
    };

    return fromMetadata().then((keys) => keys ?? fromDefinitions());
}
