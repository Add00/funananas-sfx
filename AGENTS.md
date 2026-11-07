# @funananas/sfx — Agent Guide

FunAnanas's sound engine as a shared package: one plain ES module (`src/sfx.js`, no dependencies, no build step), its types (`src/sfx.d.ts`) and its contract (`docs/sfx.md`: the engine's own, with nothing about how a FunAnanas game page wires it up, which is the game repo's `docs/sfx.md`). Two consumers: the FunAnanas game repo (it builds the engine into its vendor bundle as `window.createSfx`; not yet switched over) and Juicelab (`../juicelab`, the sound-effect tool; it imports it and renders in Node with `node-web-audio-api`).

**Created 2026-11-07** by moving `sfx.js`, its test and `docs/sfx.md` out of the game repo (the file is byte-for-byte the game repo's working copy, which included the uncommitted 2026-11-06 work: envelopes, the soft limiter, vibrato/tremolo/FM/detune, `renderScore`). See "Not done" for what remains.

## Rules

- **A score is public data.** A field a game's scores already use keeps meaning what it meant: this engine is why a sound that plays in Juicelab plays the same in a game. Add fields as optional with a default that changes nothing; if a change cannot be backward compatible, say so first in the CHANGELOG.
- **Types move with the code.** `tests/types.test.ts` fails if `src/sfx.d.ts` is missing an export of the module or declares one that is not there. It cannot check a signature: when a field is added to a voice, add it to `src/sfx.d.ts` in the same change (the typecheck covers the examples in that test).
- **The module must stay dependency-free and standalone** (no imports, no top-level use of `document` or `window`, nothing that throws without Web Audio): the game bundles it with esbuild, Node imports it, and the engine's contract says a browser with no Web Audio plays in silence.
- `src/sfx.js` is 4-space, double-quoted, as in the game repo; do not reformat it wholesale.
- **The version is CalVer, `YYYY.MM.DD`**, by hand (`npm version` rejects the leading zero). Tag a release `vYYYY.MM.DD`.

## Commands

```bash
npm test             # engine tests (the 54 that came from the game repo) and the declarations check
npm run typecheck
npm run format:check
```

Node 22 (`source ~/.nvm/nvm.sh; nvm use 22`).

## Where it lives

A **public** GitHub repo, `Add00/funananas-sfx` (chosen 2026-11-07), installed by tag as a git dependency: `git+https://github.com/Add00/funananas-sfx.git#vYYYY.MM.DD`. Public so that no consumer's CI, and no server that runs `npm ci`, needs a token or a deploy key. Keep `"private": true` in `package.json` (it stops an accidental `npm publish`; it does not affect a git install) and keep the explicit `git+https` form in consumers. Nothing secret belongs in this repo: it is public, so no internal paths, hosts, keys or notes about how the games are deployed. It is MIT licensed (chosen 2026-11-07, as WordWorks is); the licence applies to this package only, not to the game repo.

## Not done

- **Juicelab uses this package; the game repo does not yet.** The game repo still has its own `packages/browser/client/sfx.js`, test and `docs/sfx.md`, so until it moves there are two copies and a change to the engine must be made here first. Moving the game over: add the dependency, change `packages/browser/client/index.js` (the only importer) to import from `@funananas/sfx`, delete the game's `sfx.js` and its test, and update the docs and AGENTS files that name the old path. A push of that to the game's `main` deploys the game.
- No ESLint beyond Prettier: the 4-space style of `src/sfx.js` is the game repo's.
