# @funananas/sfx — Agent Guide

FunAnanas's sound engine as a shared package: one plain ES module (`src/sfx.js`, no dependencies, no build step), its types (`src/sfx.d.ts`) and its contract (`docs/sfx.md`). Two consumers: the FunAnanas game repo (`../multiplayer/c`; it builds the engine into its vendor bundle as `window.createSfx`) and Juicelab (`../juicelab`, the sound-effect tool; it imports it and renders in Node with `node-web-audio-api`).

**Created 2026-11-07** by moving `sfx.js`, its test and `docs/sfx.md` out of the game repo (the file is byte-for-byte the game repo's working copy, which included the uncommitted 2026-11-06 work: envelopes, the soft limiter, vibrato/tremolo/FM/detune, `renderScore`). Nothing in either consumer uses this package yet; see "Not done".

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

## Not done

- **Where it is installed from is undecided** (public GitHub repo as a git dependency, a private repo with deploy keys, npm, GitHub Packages): it decides what the game's CI and its VPS's `npm ci` need. Until then `package.json` has `"private": true` and no remote exists.
- **Neither consumer uses it yet.** The game repo still has its own `packages/browser/client/sfx.js`, test and `docs/sfx.md`, and Juicelab still reads that file in place through an alias. Moving them over, in this order: publish this, point Juicelab at it, point the game at it and delete the game's copy (its `packages/browser/client/index.js` is the only importer; the docs and AGENTS files that name the old path need updating).
- No ESLint or prettier setup beyond Prettier's defaults: the 4-space style of `src/sfx.js` is the game repo's.
