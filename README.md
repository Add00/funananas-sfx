# @funananas/sfx

FunAnanas's sound engine, shared by the games and by [Juicelab](https://juicelab.funananas.com), the sound-effect tool. A game or a tool brings **scores** (plain data: a list of tones and noise, each with a pitch, a length, a volume and an envelope) and gets back something that plays them, or renders them to samples, with Web Audio. Nothing is recorded, so there are no audio files to serve.

```js
import { createSfx, renderScore } from "@funananas/sfx";

const sfx = createSfx({
    key: "mygame-sound",
    scores: { hit: () => [{ voice: "tone", type: "square", from: 220, to: 55, length: 0.15, gain: 0.3 }] },
});
sfx.wakeOnGesture();
sfx.play("hit");

const buffer = await renderScore([{ voice: "hiss", length: 0.2, gain: 0.3 }]); // a mono AudioBuffer
```

The contract (voices, the envelope, vibrato, tremolo, FM, the limiter, rendering, testing and the traps) is [docs/sfx.md](docs/sfx.md). The types are [src/sfx.d.ts](src/sfx.d.ts).

It is one plain ES module with no dependencies and no build step: what you import is `src/sfx.js`.

## Using it

Add it as a dependency (see [Publishing](#publishing) for where it is installed from) and import from `@funananas/sfx`. A tool that renders in Node needs a Web Audio implementation: pass its `OfflineAudioContext` as the `OfflineAudioContextClass` option of `renderScore` (Juicelab uses `node-web-audio-api`).

## Developing

```bash
npm install
npm test            # vitest: the engine against a stubbed audio context, and the type declarations
npm run typecheck   # tsc over the declarations and the tests
npm run format:check
```

## Versions

The version is a CalVer date, `YYYY.MM.DD`, as in WordWorks and Juicelab: the day of a release. Set it by hand in `package.json` and `package-lock.json` (`npm version` rejects the leading zero), and tag the commit `vYYYY.MM.DD`. A change to what a score means is backward compatible or it gets a changelog entry that says so: the games and Juicelab pin a version and move when they choose.

## Publishing

Not decided yet: see AGENTS.md.
