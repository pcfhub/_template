#!/usr/bin/env node
/**
 * Fail while the repository still carries template placeholders.
 *
 * This runs first in CI, ahead of the Windows build, because a repository that
 * has not been through `npm run setup` fails everything downstream for one
 * reason — and the reason is much easier to read here than in an msbuild log.
 *
 * It also does a light structural read of `pcfhub.json`: enough to catch the
 * mistakes that would otherwise be discovered by an ingestion run failing on
 * the hub. Deliberately *not* a copy of the hub's schema — PCFHub's
 * `ManifestValidator` is the one definition of that contract, and a second copy
 * here would drift, then disagree, and the one nothing executes always loses.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'bin', 'obj', 'generated']);

// The setup script names every token it replaces, so it always "contains
// placeholders" — it is the thing that removes them.
const SKIP_PATHS = new Set(['scripts/setup.mjs', 'scripts/check-template.mjs']);

const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|mp4|webm|zip|ico|woff2?)$/i;

const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;

const problems = [];

// ------------------------------------------------------------- placeholders

for (const path of walk(root)) {
    const relative = path.slice(root.length + 1).replace(/\\/g, '/');

    if (SKIP_PATHS.has(relative)) {
        continue;
    }

    const found = new Set();

    if (!SKIP_EXTENSIONS.test(path)) {
        for (const match of readFileSync(path, 'utf8').matchAll(PLACEHOLDER)) {
            found.add(match[0]);
        }
    }

    for (const match of basename(path).matchAll(PLACEHOLDER)) {
        found.add(match[0]);
    }

    if (found.size > 0) {
        problems.push(`${relative} still contains ${[...found].join(', ')}`);
    }
}

if (problems.length > 0) {
    console.error('\nThis repository is still the template. Run:\n\n  npm run setup\n');
    for (const problem of problems) {
        console.error(`  ${problem}`);
    }
    console.error('');
    process.exit(1);
}

// -------------------------------------------------------------- pcfhub.json

let manifest;

try {
    manifest = JSON.parse(readFileSync(join(root, 'pcfhub.json'), 'utf8'));
} catch (error) {
    fail(`pcfhub.json is not readable as JSON: ${error.message}`);
}

const required = ['schemaVersion', 'slug', 'name', 'control'];

for (const key of required) {
    if (manifest[key] === undefined) {
        problems.push(`pcfhub.json is missing "${key}".`);
    }
}

for (const key of ['namespace', 'constructor', 'type']) {
    if (manifest.control?.[key] === undefined) {
        problems.push(`pcfhub.json is missing "control.${key}".`);
    }
}

// The path is declared rather than discovered, so a typo in it costs the whole
// API reference — every release imports with no properties at all.
const manifestPath = manifest.control?.manifestPath;

if (manifestPath && !exists(join(root, manifestPath))) {
    problems.push(`pcfhub.json points control.manifestPath at "${manifestPath}", which does not exist.`);
}

// The hub reads docs from the default branch and reports any file it does not
// recognise, so a misnamed page is published nowhere and mentioned only in an
// ingestion run nobody is watching.
const SECTIONS = [
    'overview.md', 'installation.md', 'canvas.md', 'model-driven.md', 'api.md',
    'examples.md', 'limitations.md', 'faq.md', 'migration.md',
];

const docsPath = manifest.docs?.path ?? 'docs';

if (exists(join(root, docsPath))) {
    for (const entry of readdirSync(join(root, docsPath))) {
        if (entry.endsWith('.md') && !SECTIONS.includes(entry.toLowerCase())) {
            problems.push(
                `${docsPath}/${entry} is not one of the hub's sections and would be skipped. ` +
                `Expected one of: ${SECTIONS.join(', ')}.`,
            );
        }
    }

    if (exists(join(root, docsPath, 'changelog.md'))) {
        problems.push(
            `${docsPath}/changelog.md is ignored — the hub builds the changelog from release notes.`,
        );
    }
} else {
    problems.push(`No ${docsPath}/ directory, so this component would publish with no documentation.`);
}

if (problems.length > 0) {
    console.error('');
    for (const problem of problems) {
        console.error(`  ${problem}`);
    }
    console.error('');
    process.exit(1);
}

console.log('Template adopted, pcfhub.json readable, docs named correctly.');

// ------------------------------------------------------------------ helpers

function* walk(dir) {
    for (const entry of readdirSync(dir).sort()) {
        if (SKIP_DIRS.has(entry)) {
            continue;
        }

        const path = join(dir, entry);

        if (statSync(path).isDirectory()) {
            yield* walk(path);
        } else {
            yield path;
        }
    }
}

function exists(path) {
    try {
        statSync(path);

        return true;
    } catch {
        return false;
    }
}

function fail(message) {
    console.error(`\n  ${message}\n`);
    process.exit(1);
}
