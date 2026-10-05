/*
 * Retake every screenshot in `media/`.
 *
 *     npm run harness -- --no-open --port 8181     # in one shell
 *     npm run shots                                # in another
 *     npm run shots -- dark                        # only the recipes whose name contains "dark"
 *
 * **The recipes live here, not in a person's shell history.** A stale
 * screenshot is a documented claim about a version that no longer exists, and
 * the only defence is a retake cheap enough to run on every release. A recipe
 * is a page, the query string or the clicks that arrange the state, and what
 * to frame; the engine is `dev/cdp.js`, which is the template's and which
 * `sync-rig.mjs` keeps current. This file is the control's own.
 *
 * Two pages to point a recipe at: `dev/harness.html`, the interactive
 * stand-in host, framed at `#harness-form`; or a `dev/preview.html` of the
 * control's own that lays every state out as cards (`pcf-number-slider`'s is
 * the pattern), framed by card id. A recipe's `act` runs in the page after it
 * settles, so a switch the harness has no query parameter for is a click.
 *
 * **A picture changed under a published name is not republished.** The hub
 * mirrors `media/` by path and never fetches a path again, so a retake that
 * changes `screenshot.png` leaves the old one on the component page. The run
 * says so when it happens; give the new picture a new name and repoint
 * `pcfhub.json` (the skill's `references/hub-media.md`).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { shoot } = require('./cdp');

const root = path.join(__dirname, '..');

/** Flip a harness checkbox the way a person does, so the page's own `change` listener re-renders. */
const toggle = (id) => `const box = document.getElementById(${JSON.stringify(id)}); box.click();`;

const RECIPES = [
    {
        name: 'screenshot.png',
        purpose: 'the control as the harness opens it',
        page: 'dev/harness.html',
        width: 900,
        frame: '#harness-form',
    },
    {
        name: 'screenshot-dark.png',
        purpose: 'the same, on the dark theme',
        page: 'dev/harness.html',
        width: 900,
        frame: '#harness-form',
        act: toggle('harness-dark'),
    },
];

(async () => {
    const published = new Set(((JSON.parse(fs.readFileSync(path.join(root, 'pcfhub.json'), 'utf8')).media || {}).screenshots || [])
        .map((file) => path.basename(file)));
    const before = new Map(RECIPES.map((recipe) => {
        const file = path.join(root, 'media', recipe.name);

        return [recipe.name, fs.existsSync(file) ? fs.readFileSync(file) : null];
    }));

    const failed = await shoot(RECIPES, {
        root,
        port: process.env.PORT || 8181,
        only: process.argv.slice(2),
    });

    for (const [name, old] of before) {
        const file = path.join(root, 'media', name);

        if (old && published.has(name) && fs.existsSync(file) && !old.equals(fs.readFileSync(file))) {
            console.log(`\n  ${name} changed under a name pcfhub.json already publishes — the hub keeps serving the old`
                + '\n  picture. Give the new one a new name and repoint pcfhub.json and the docs.');
        }
    }

    if (failed > 0) {
        console.log(`\n  ${failed} of ${RECIPES.length} failed`);
        process.exit(1);
    }
})().catch((error) => {
    console.error(`\n  ${error.message}\n`);
    process.exit(1);
});
