# Sound effects: `createSfx`

How a game page, or a tool, makes sound. The engine is the package **`@funananas/sfx`** (`src/sfx.js`, plain ES module, no build step and no dependencies). The FunAnanas site builds it into its vendor bundle and makes it available on every page that loads it as **`window.createSfx`**: a page-wide global like `Alpine` and `io`, never imported by a game page (`views/AGENTS.md` in the game repo). A tool such as Juicelab imports it: `import { createSfx, renderScore } from "@funananas/sfx"`. Real uses to copy from, in the game repo: Sumo Ring (`packages/game-sumo/client/`) and Tower (`packages/game-tower/client/sfx.js`). Nothing is recorded, so there are no audio files to serve.

The paths below that start `packages/` are in the FunAnanas game repo, which uses this package; everything under `src/` and `tests/` is this package's own.

## The idea in one example

A game lists its sounds as **scores**, hands them to `createSfx`, and plays them by name.

```js
const SCORES = {
    // A score is a function from options to a list of voices.
    ping: () => [{ voice: "tone", type: "triangle", from: 880, length: 0.12, gain: 0.3 }],
};

const sfx = window.createSfx({ key: "mygame-sound", scores: SCORES });
sfx.wakeOnGesture(); // a browser makes no sound before a click or key

sfx.play("ping");
```

`key` is where the player's on/off choice is kept in this browser (`localStorage`, `"on"` or `"off"`, on by default), so give each game its own. The settings drawer's Sound switch (`Alpine.store("manager").muted`) is over every game's: with it off, nothing sounds.

## Voices

A voice is one of two kinds. Times are seconds, `at` is the delay from now, `gain` is 0 to 1.

```js
// A pitch, which may slide from `from` to `to` over `length`.
{ voice: "tone", type: "sine" /* sine | triangle | square | sawtooth */, from: 440, to: 220, at: 0, length: 0.2, gain: 0.3 }

// A burst of noise.
{ voice: "hiss", at: 0, length: 0.2, gain: 0.2 }

// Either may be run through a filter, which may sweep from `from` to `to`.
{ voice: "hiss", length: 0.4, gain: 0.3, filter: { type: "bandpass", from: 500, to: 3600 } }
```

Several voices in one score play together, or one after another with `at`.

### The envelope

A voice rises, may hold, then falls to silence at the end of its `length`. Three optional fields shape that; with none, a voice rises in 6 ms and falls exponentially.

```js
// A swell: a slow rise, a short plateau, then the fall.
{ voice: "tone", type: "sawtooth", from: 110, to: 220, length: 1.2, gain: 0.3, attack: 0.5, hold: 0.2 }
```

- `attack`: seconds to the peak (default 0.006, at least 0.001).
- `hold`: seconds to stay at the peak before falling (default 0).
- `curve`: `"exp"` (default, which sounds natural for loudness) or `"linear"` (a straighter ramp, for a gate-like or even swell).

Both times are held inside `length`: an `attack` longer than the voice is the voice's length, with nothing left to fall. A value that is not a number, or is negative, means the default.

### Wobble and colour: vibrato, tremolo, detune, FM

Four more optional fields on a voice. All are held to a safe range (a value that is not a number, or does nothing, is ignored), so a score from outside cannot make `play` throw.

```js
// A siren: a pitch that wobbles 5 times a second, 60 cents either way.
{ voice: "tone", type: "square", from: 660, length: 1, gain: 0.2, vibrato: { rate: 5, depth: 60 } }

// A helicopter: noise whose loudness chops 14 times a second, down to silence.
{ voice: "hiss", length: 1, gain: 0.3, filter: { type: "lowpass", from: 900 }, tremolo: { rate: 14, depth: 1 } }

// A bell in one voice: FM at 2.76 times the pitch, bright at the strike and dying away.
{ voice: "tone", from: 440, length: 1.2, gain: 0.3, fm: { ratio: 2.76, index: 3, to: 0 } }

// Two of the same note a few cents apart beat slowly against each other: a fat saw.
[{ voice: "tone", type: "sawtooth", from: 220, length: 0.6, gain: 0.15, detune: -9 },
 { voice: "tone", type: "sawtooth", from: 220, length: 0.6, gain: 0.15, detune: 9 }]
```

- `vibrato: { rate, depth }`: a pitch wobble; `rate` in Hz (0.1 to 40), `depth` in cents either way (up to 1200, an octave). Tones only.
- `tremolo: { rate, depth }`: a loudness wobble; `rate` in Hz (0.1 to 60), `depth` 0 to 1. The gain swings between `1 - depth` and 1 of the voice's gain, so a tremolo never makes a voice louder. Tones and noise.
- `detune`: cents, -1200 to 1200, a fixed offset from `from` and `to`. Tones only.
- `fm: { ratio, index, to? }`: a sine at `ratio` (0.05 to 16) times the voice's pitch swings that pitch by `index` (0 to 30) times its own frequency, so the timbre holds when the voice slides. Whole `ratio`s sound like one pitch with a harder edge; others (2.76, 5.4) sound like metal. `to` is the index at the end of the voice (default: the same as `index`), which is what makes a bell's brightness die away. Tones only.

A voice's modulators start and stop with it (just after its `length`), and the envelope applies to the result.

### The limiter

Every sound goes through a soft limiter before the speakers, so voices that stack (four guns and a wave, a chord of bells) are rounded off short of clipping. It is a `WaveShaperNode`: a peak under `CLIP_FROM` (0.6 of full scale) comes through exactly as it is, and above that the curve bends smoothly towards a ceiling of about 0.9 (-0.9 dB; eight loud square waves stacked measure exactly that). It is not oversampled on purpose: the resampling filter overshoots full scale on a hard edge, so the ceiling would not hold. A sound that stays under 0.6 is therefore not changed at all, which is the point of using a shaper and not a compressor: a `DynamicsCompressorNode` also changes the level of quiet sounds (about 5 dB lower in Chromium, and differently elsewhere). A browser without the node plays straight out. A score does not choose it, and a `mix()` that thins a busy update still saves the work of making the voices.

## Recipes

Each of these is a complete score. They are the building blocks Sumo Ring's sounds are made from.

```js
const SCORES = {
    // A wooden block: a short high triangle with a click of noise.
    block: () => [
        { voice: "tone", type: "triangle", from: 520, length: 0.09, gain: 0.45 },
        { voice: "hiss", length: 0.02, gain: 0.12, filter: { type: "bandpass", from: 2400 } },
    ],

    // A drum: a low pitch that falls, and the slap of the stick.
    drum: ({ pitch = 110 } = {}) => [
        { voice: "tone", type: "sine", from: pitch, to: pitch * 0.4, length: 0.34, gain: 0.7 },
        { voice: "hiss", length: 0.05, gain: 0.25, filter: { type: "lowpass", from: 1800 } },
    ],

    // Air tearing past: noise swept up through a band.
    whoosh: () => [{ voice: "hiss", length: 0.32, gain: 0.35, filter: { type: "bandpass", from: 500, to: 3600 } }],

    // A plucked run up a scale: the same voice, each note a little later.
    run: () =>
        [587.33, 659.25, 783.99, 880].map((from, step) => ({
            voice: "tone",
            type: "triangle",
            from,
            at: step * 0.1,
            length: 0.5,
            gain: 0.3,
        })),

    // A chime: a sine with two overtones that die away sooner.
    chime: () => [
        { voice: "tone", from: 440, length: 1.3, gain: 0.3 },
        { voice: "tone", from: 440 * 2.76, length: 0.7, gain: 0.1 },
        { voice: "tone", from: 440 * 5.4, length: 0.4, gain: 0.05 },
    ],
};
```

## Options: a sound that depends on the game

A score gets the options `play` is given, so a sound can depend on what happened. Sumo Ring's hit is lower and louder the harder two stones met; Tower's voice is a semitone step from a home note.

```js
const SCORES = {
    hit: ({ force = 0.5 } = {}) => [
        {
            voice: "tone",
            type: "sine",
            from: 190 - force * 70,
            to: 55,
            length: 0.1 + force * 0.12,
            gain: 0.25 + force * 0.5,
        },
    ],
};

sfx.play("hit", { force: 0.9 });
```

`play(name, options, gain)` takes a third argument, a multiplier on every voice, for **what happened to somebody else**: play the same sound quieter.

```js
sfx.play("hit", { force }, event.mine ? 1 : 0.6);
```

A fourth argument, `pan` from -1 (left) to 1 (right), places a sound that **happened somewhere**: its voices go through one `StereoPannerNode` (a browser without one plays it from the middle). Horde (`packages/game-horde/client/sounds.js`) pans each sound by how far to the side of the player it was and quietens it with distance (`place()`), and thins a busy update to a few of each sound (`mix()`).

```js
sfx.play("boom", { size: 1 }, 0.6, -0.4); // a blast off to the left, some way off
```

`play` returns whether anything sounded (false before the first gesture, when switched off or muted, or for a name with no score), and never throws.

## Keeping what is heard in step with what is seen

Work out one list of events from the game's state and make both the sound and the picture from it, as Sumo Ring does (`events.js` finds the events, `soundFor()` in `sounds.js` maps each to a sound):

```js
function soundFor(event) {
    switch (event.type) {
        case "hit":
            return { name: "hit", options: { force: event.force }, gain: 1 };
        case "out":
            return { name: "splash", options: {}, gain: event.mine ? 1 : 0.7 };
        default:
            return null; // silent
    }
}

for (const event of detector.push(state, me)) {
    const sound = soundFor(event);
    if (sound !== null) sfx.play(sound.name, sound.options, sound.gain);
    // ...and make the sparks from the same event.
}
```

## A Sound button

Spread `sfx.switch()` into the page's Alpine store and bind a button to it. It gives the store `sound` (this game's choice, as the player left it), `muted()` (the settings drawer's switch), `soundOn()` (the choice under the drawer's switch) and `toggleSound()`, which flips the choice, keeps it, wakes the audio and plays the sound you name. The press is a click, so the confirmation says what "on" sounds like; leave the name out for none.

```js
// In the Alpine store
...sfx.switch("block"),
```

```html
<button type="button" :aria-pressed="String($store.mygame.soundOn())" @click="$store.mygame.toggleSound()">
    Sound
</button>
```

It has to be spread into the store literal, not called later, because the methods read `this.sound`, which Alpine makes reactive on the store.

Sumo Ring's button wears corner brackets when on (`.sm-link[aria-pressed="true"]` in `sumo.css`) and its page also toggles it with the `M` key (`getStore()?.toggleSound()`).

## Wiring it into a page

In the page's script bundle (see Sumo Ring's `index.js`):

```js
import { SCORES } from "./sounds.js";

const sfx = window.createSfx({ key: "mygame-sound", scores: SCORES });
sfx.wakeOnGesture();
document.addEventListener("alpine:init", () => Alpine.store("mygame", createStore(window.MYGAME_PAGE, sfx)));
```

A store that takes the engine as an argument can be tested with the real engine given nothing to play on (`createSfx({ key, storage: undefined, AudioContextClass: undefined })`) and `setOn`, `wake` and `play` replaced by `vi.fn()`, as Sumo's store tests do, so no test needs an audio context.

If the page might load without the vendor bundle (a unit test importing the module), guard the global as Tower's `sfx.js` does: `const engine = globalThis.createSfx?.(...)` and call `engine?.play(...)`.

## Options for `createSfx`

| Option                                   | Default                            | What it is                                                |
| ---------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| `key`                                    | required                           | Where the on/off choice is kept in `localStorage`.        |
| `scores`                                 | `{}`                               | Sound name to score.                                      |
| `level`                                  | `0.55`                             | Master volume. Tower passes `1` to keep gains as written. |
| `isMuted`                                | the settings drawer's Sound switch | Override it only for a page with another idea of muted.   |
| `storage`, `AudioContextClass`, `random` | the browser's                      | For a test.                                               |

The engine returned has `on`, `setOn(value)`, `wanted()` (on here and not muted in the drawer), `wake()`, `recover()` (resumes a context the browser stopped, never makes one), `wakeOnGesture(target = document)`, `play(name, options, gain)` and `switch(confirm)` (the Sound button's store fragment). `silentSfx` has the same surface and plays nothing.

## Testing sounds

A score is plain data, so check it without a browser. Sumo's `packages/game-sumo/tests/client/sounds.test.ts` walks every score and checks each voice: a known kind, a length and gain in range, a real pitch.

```ts
for (const name of Object.keys(SCORES)) {
    for (const voice of SCORES[name]({ force: 0.7 })) {
        expect(["tone", "hiss"]).toContain(voice.voice);
        expect(voice.length).toBeGreaterThan(0);
        expect(voice.gain).toBeGreaterThan(0);
        expect(voice.gain).toBeLessThanOrEqual(1);
    }
}
```

The engine itself is tested once, against a stubbed audio context, in `tests/sfx.test.ts` of this package. What a sound **sounds like** can only be judged by listening: write the score, load the page, click once, and play it.

## Traps

- **Nothing sounds before a click or key.** `wakeOnGesture()` handles it, on a tap's end (`pointerup`, `click`), a key and a press, and **keeps listening**: a browser can stop the context again (iOS does for a call or a backgrounded tab, leaving it `"interrupted"`), and the next gesture, or the page becoming visible, resumes it. Call `sfx.wake()` from a button's handler too.
- **A new score needs a case wherever sounds are chosen** (Sumo's `soundFor`), and a test, or it is never played.
- **Keep `gain` at most 1** and a voice's `length` short (the longest in the repo is 1.4 s); the engine does not limit them.
- **Pick a unique `key`.** Two games sharing one share the player's on/off choice.
- **Industry has not moved over yet** and still carries its own Web Audio code (its notification alerts). Wiggle moved: its scores are `packages/game-wiggle/client/sounds.js`, handed to the page as `window.WIGGLE_SOUNDS` by its deferred bundle, so its inline script makes the engine in `alpine:init`, not at load.

## Rendering a sound to samples

`renderScore` makes the sound without playing it, for saving it as an audio file or measuring it. It is a function of the module, not of a `createSfx` engine, and needs no click.

```js
import { renderScore } from "@funananas/sfx";

const buffer = await renderScore(score, { sampleRate: 44100 }); // a mono AudioBuffer, or undefined
```

It builds the same voices as `play`, with the same master level (`level`, default 0.55) and the same limiter, on an `OfflineAudioContext`, so the samples are what was heard. It lasts until the last voice has ended, plus 0.02 s for a source to stop and a `tail` (default 0.15 s) of silence for the limiter, and never longer than `MAX_RENDER_SECONDS` (30). Options: `sampleRate` (44100), `gain` (a multiplier on every voice, as in `play`), `level`, `tail`, and `random`: the noise comes from it, so a seeded generator makes the same score render to the same samples. It resolves `undefined`, and never rejects, for an empty score, a browser with no `OfflineAudioContext`, or a render that fails (which is logged). It does not pan.
