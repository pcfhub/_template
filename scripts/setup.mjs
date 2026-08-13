#!/usr/bin/env node
/**
 * Adopt this template: replace every placeholder, rename the files that carry
 * one, and generate the identifiers that must be unique per repository.
 *
 *   node scripts/setup.mjs
 *   node scripts/setup.mjs --control ColorPicker --namespace PCFHub --yes
 *
 * Run it once, review the diff, commit. `scripts/check-template.mjs` fails the
 * build until it has been run, so a half-adopted template cannot reach a
 * release — which matters because two of the values below (the solution's
 * unique name and the publisher prefix) are permanent once a customer has
 * installed the solution.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Never walked: build output, dependencies, and git's own storage. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'bin', 'obj', 'generated']);

/** Binary-ish or generated files whose contents must not be rewritten. */
const SKIP_FILES = new Set(['package-lock.json']);

const args = parseArgs(process.argv.slice(2));

const rules = {
    CONTROL: {
        question: 'Control name (PascalCase, becomes the constructor)',
        example: 'ColorPicker',
        test: /^[A-Za-z][A-Za-z0-9_]*$/,
        hint: 'letters, digits and underscores, starting with a letter',
    },
    NAMESPACE: {
        question: 'Namespace',
        example: 'PCFHub',
        test: /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/,
        hint: 'a PCF namespace such as "PCFHub" or "Contoso.Controls"',
    },
    SLUG: {
        question: 'Hub slug (the /components/… URL, and the pcfhub.json slug)',
        derive: (a) => kebab(a.CONTROL),
        test: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        hint: 'lowercase words separated by single hyphens',
    },
    TITLE: {
        question: 'Display name',
        derive: (a) => title(a.CONTROL),
        test: /^.{1,191}$/,
        hint: 'up to 191 characters',
    },
    TAGLINE: {
        question: 'One-line description',
        example: 'A WCAG-compliant colour picker for model-driven forms.',
        test: /^.{1,255}$/,
        hint: 'up to 255 characters',
    },
    CATEGORY: {
        question: 'Hub category slug',
        example: 'pickers',
        test: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        hint: 'lowercase words separated by single hyphens',
    },
    OWNER: {
        question: 'GitHub owner',
        example: 'pcfhub',
        test: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,
        hint: 'a GitHub user or organisation',
    },
    REPO: {
        question: 'GitHub repository name',
        derive: (a) => a.SLUG,
        test: /^[A-Za-z0-9._-]+$/,
        hint: 'the repository name only, not the URL',
    },
    PUBLISHER: {
        question: 'Dataverse publisher unique name (permanent)',
        derive: (a) => a.NAMESPACE.replace(/\./g, ''),
        test: /^[A-Za-z][A-Za-z0-9]*$/,
        hint: 'letters and digits, starting with a letter',
    },
    PREFIX: {
        question: 'Publisher customization prefix (permanent, 2–8 chars)',
        derive: (a) => a.PUBLISHER.toLowerCase().slice(0, 5),
        test: /^[a-z][a-z0-9]{1,7}$/,
        hint: '2 to 8 lowercase characters, starting with a letter',
    },
};

const answers = {};

const rl = args.yes ? null : createInterface({ input: process.stdin, output: process.stdout });

for (const [token, rule] of Object.entries(rules)) {
    const fallback = args[token.toLowerCase()] ?? rule.derive?.(answers) ?? null;

    for (;;) {
        let value = fallback;

        if (rl) {
            const suffix = fallback ? ` [${fallback}]` : rule.example ? ` (e.g. ${rule.example})` : '';
            const typed = (await rl.question(`${rule.question}${suffix}: `)).trim();
            value = typed === '' ? fallback : typed;
        }

        if (value && rule.test.test(value)) {
            answers[token] = value;
            break;
        }

        const problem = value ? `"${value}" is not valid — expected ${rule.hint}.` : 'A value is required.';

        if (!rl) {
            fail(`${token}: ${problem}`);
        }

        console.error(`  ${problem}`);
    }
}

rl?.close();

/*
 * Generated rather than asked for.
 *
 * The two project GUIDs only have to be unique, and the option-value prefix
 * only has to not collide with another publisher in the same environment —
 * nobody has an opinion about any of them, and a template that ships fixed ones
 * gives every repository the same identity.
 */
answers.PCF_PROJECT_GUID = randomUUID();
answers.SOLUTION_PROJECT_GUID = randomUUID();
answers.OPTION_VALUE_PREFIX = String(10000 + Math.floor(Math.random() * 90000));

const tokens = Object.keys(answers).map((name) => [`__${name}__`, answers[name]]);

// Longest first, so `__CONTROL__` cannot eat the front of a longer token that
// happens to share its prefix.
tokens.sort((a, b) => b[0].length - a[0].length);

const rewritten = [];
const renamed = [];

for (const file of walk(root)) {
    const original = readFileSync(file, 'utf8');
    let updated = original;

    for (const [token, value] of tokens) {
        updated = updated.split(token).join(value);
    }

    if (updated !== original) {
        writeFileSync(file, updated);
        rewritten.push(relative(file));
    }
}

/*
 * Depth-first, children before parents — which is the order `walkPaths` already
 * yields, and the reason it yields a directory *after* recursing into it.
 *
 * The paths were collected before the first rename, so renaming a parent early
 * would invalidate every path still queued underneath it.
 */
for (const path of walkPaths(root)) {
    const base = basename(path);
    let next = base;

    for (const [token, value] of tokens) {
        next = next.split(token).join(value);
    }

    if (next !== base) {
        const target = join(dirname(path), next);
        renameSync(path, target);
        renamed.push(`${relative(path)} → ${next}`);
    }
}

const templateDoc = join(root, 'TEMPLATE.md');

if (existsSync(templateDoc)) {
    rmSync(templateDoc);
}

console.log('');
for (const [token, value] of tokens) {
    console.log(`  ${token.padEnd(24)} ${value}`);
}
console.log(`\n  ${rewritten.length} files rewritten, ${renamed.length} renamed:`);
for (const line of renamed) {
    console.log(`    ${line}`);
}

console.log(`
Next:
  1. Review the diff — the publisher prefix and the solution unique name are
     permanent once this ships.
  2. npm install
  3. npm run build
  4. Fill in docs/*.md. Every file there becomes a page on the hub; the ones you
     do not write simply do not appear.
  5. Add the repository to PCFHub with the slug "${answers.SLUG}", then tag v0.1.0.
`);

// ------------------------------------------------------------------ helpers

function* walkPaths(dir) {
    for (const entry of readdirSync(dir).sort()) {
        if (SKIP_DIRS.has(entry)) {
            continue;
        }

        const path = join(dir, entry);

        if (statSync(path).isDirectory()) {
            yield* walkPaths(path);
            yield path;
        } else {
            yield path;
        }
    }
}

function* walk(dir) {
    for (const path of walkPaths(dir)) {
        if (!statSync(path).isDirectory() && !SKIP_FILES.has(basename(path))) {
            yield path;
        }
    }
}

function relative(path) {
    return path.slice(root.length + 1).replace(/\\/g, '/');
}

function kebab(value) {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[_\s]+/g, '-')
        .toLowerCase();
}

function title(value) {
    return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
}

function parseArgs(argv) {
    const out = {};

    for (let i = 0; i < argv.length; i += 1) {
        if (!argv[i].startsWith('--')) {
            continue;
        }

        const key = argv[i].slice(2);

        if (key === 'yes') {
            out.yes = true;
        } else {
            out[key] = argv[i + 1];
            i += 1;
        }
    }

    return out;
}

function fail(message) {
    console.error(`\n  ${message}\n`);
    process.exit(1);
}
