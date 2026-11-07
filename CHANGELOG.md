# Changelog

The engine's history before it became a package is in the FunAnanas game repo (`packages/browser/client/sfx.js`, before 2026-11-06). Dates are the day a change was made; the package version is the day of a release (`YYYY.MM.DD`).

## Unreleased

### Resonance, drive and echo

Backward compatible: three optional fields, and a voice without them makes exactly the audio graph it did (the 54 engine tests pass untouched, and a new one pins the node count).

- `filter.q` (linear Q, 0.1 to 15; converted to decibels for a lowpass or highpass, which is how Web Audio takes it), `drive` (0 to 1, a `tanh` shaper after the filter, `driveCurve()`) and `echo: { time, feedback?, mix? }` (one delay per repeat, at most 8 and 2 seconds, none under 2%, `echoTaps()`). `modulation()` holds each to its range and drops what is not numbers. `endOf(voice)` is new, and `renderScore` uses it so the render includes the last repeat.
- Types and `docs/sfx.md` ("Resonance, drive and echo") updated; the declarations test caught the three new exports before the types had them.
- **Measured in Node's real Web Audio** (`node-web-audio-api`): echoes at 0.2, 0.4 and 0.6 s with peaks 0.129, 0.065 and 0.032 for a 0.162 voice at mix 0.8, feedback 0.5, and a render of 1.47 s against 0.27 s without; drive 0.8 on a quiet sine left the peak (-25.2 dB) and raised the average by 2.8 dB; Q 12 on a 1 kHz lowpass made noise 10.2 dB louder at the average and 12 dB at the peak. Four deliberate breakages of the new code (a missing connection, the decibel conversion, the drive curve, the render length) each made a test fail. **Not heard:** the ranges and curve shapes are my choices from the maths and the measurements, not from listening.

## 2026-11-07

### MIT licence

Added a `LICENSE` (MIT) and `"license": "MIT"` in `package.json`. The tag `v2026.11.07` was made before it and still says `UNLICENSED` in its `package.json`; the licence is in the package metadata from the next release.

### The engine is a package

`sfx.js` moved out of the FunAnanas game repo into `@funananas/sfx`, so the game and Juicelab (the sound-effect tool) share one copy and neither has to check out the other. The file is byte-for-byte the one that was in the game repo with the 2026-11-06 changes below; its tests (54, unchanged) and `docs/sfx.md` came with it. New: `src/sfx.d.ts`, types for every export, and `tests/types.test.ts`, which fails if the declarations and the module disagree.

## 2026-11-06

### `createSfx`: envelopes, a limiter, wobble and offline rendering

The first step of the sound engine's growth for a standalone tool, `juicelab`. Backward compatible: no score changed.

- **A voice's envelope is now a choice:** optional `attack` (seconds to the peak, default 0.006), `hold` (seconds at the peak, default 0) and `curve` (`"exp"`, the default, or `"linear"`). `envelope()` is exported and holds both times inside the voice's `length`; a negative or non-number value means the default. A voice with none of them makes the same automation calls as before (a test pins it).
- **Every sound goes through a soft limiter** before the speakers, so stacked voices are rounded off short of clipping: a `WaveShaperNode` whose curve (`softClipCurve()`, exported, with `CLIP_FROM` = 0.6) is a straight line up to 0.6 of full scale and a smooth `tanh` bend above it towards a ceiling of about 0.9. A browser without the node plays straight out. **This replaced a first version that was wrong:** it was a `DynamicsCompressorNode` (-6 dB threshold, ratio 20) and the entry said a single sound "sits under the threshold and is untouched". Measured in Chromium, it was not: a 0.3-gain tone came out 5.1 dB quieter (-20.8 dB against -15.7 dB), at any level, because the node changes the level of quiet sounds too, differently per browser. The shaper leaves a sound under 0.6 exactly as it was (measured: -15.7 dB, the unlimited level) and holds eight stacked loud square waves to -0.9 dB. It is not oversampled: at `"2x"` the same stack peaked at +0.2 dB, since the resampling filter overshoots on a hard edge. **Not heard:** I have not listened to a busy Horde update through it; the five games' sound tests pass unchanged.
- **Vibrato, tremolo, FM and detune,** the second step: optional `vibrato: { rate, depth }` (cents, on the oscillator's detune), `tremolo: { rate, depth }` (a gain that swings between `1 - depth` and 1, tones and noise), `detune` (cents) and `fm: { ratio, index, to? }` (a sine at `ratio` times the pitch, its swing `index` times its own frequency so a slide keeps its timbre, `to` the index at the end for a bell). `modulation()` is exported and holds each to a range (vibrato up to 1200 cents and 40 Hz, tremolo depth 0 to 1, FM ratio 0.05 to 16 and index 0 to 30, detune ±1200) and drops a field that is not numbers or does nothing, so `play` cannot be made to throw by a score. Modulators are extra oscillators that start and stop with their voice. No existing score uses a field, so nothing in the five games changed; the tests record the graph's connections (a mutation that skipped the wiring failed two of them). **Not heard:** the ranges and the FM index scaling are my choices from the maths, not from listening.
- **Offline rendering, the third step:** `renderScore(score, { sampleRate, gain, level, random, tail })` renders a score to a mono `AudioBuffer` on an `OfflineAudioContext` (no click or gesture needed), through the same voices, master level and limiter as `play`, for a tool's audio export. It lasts until the last voice ends (plus 0.02 s and a 0.15 s tail), at most `MAX_RENDER_SECONDS` (30, so a hostile score cannot ask for unbounded memory), and resolves `undefined`, never rejecting, for an empty score, no `OfflineAudioContext` or a failed render. A seeded `random` makes the same score render to the same samples. To make this possible the voice-building code moved out of the `createSfx` closure into module-level `voiceMaker(context, noise)`, `masterOut` and `hissOf`; `play` is unchanged in behaviour (the 43 earlier engine tests pass untouched). Checked in Chromium by rendering and measuring (see the limiter entry above), and through the `juicelab` tool's WAV, FLAC and MP3 downloads, which `ffprobe` and `ffmpeg` read back at the right length, rate and level.
- Docs in `docs/sfx.md` (The envelope, Wobble and colour, The limiter). Still to come in the engine: noise fixes (a hiss longer than the one-second buffer looks cut off, and every hiss starts at the same sample), and the FM modulator can exceed the audio range (an FM voice at 20 kHz with ratio 2 makes the browser log a clamped-frequency warning).
