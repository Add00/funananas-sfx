/**
 * The site's one sound engine, in the vendor bundle as `window.createSfx` (a
 * page-wide global, like Alpine and `io`: a game page never imports it).
 * A game brings its sounds as scores and gets back something to play them with:
 *
 *   const sfx = createSfx({ key: "sumo-sound", scores: SOUNDS });
 *   sfx.wakeOnGesture();
 *   sfx.play("hit", { gain: 0.8 });
 *
 * A score is a function from options to a list of voices, so a sound that
 * depends on the game (a hit's force, a beat's tempo) is still plain data a
 * test can check without a browser. A voice is one of:
 *
 *   { voice: "tone", type, from, to?, at?, length, gain, filter? }   a pitch that may slide
 *   { voice: "hiss", at?, length, gain, filter? }                    noise
 *
 * `filter` is `{ type, from, to? }` on a biquad. Nothing is recorded, so there
 * are no files to serve. The engine owns what every game used to repeat: one
 * audio context made after a click or key (a browser makes no sound before
 * one), a second of noise for the hiss, the player's on/off choice kept in
 * this browser, and the settings drawer's Sound switch, which is over every
 * game's. A browser with no Web Audio, or one that refuses it, plays the game
 * in silence; nothing here throws.
 *
 * @module
 */

const LEVEL = 0.55;

/** How fast a voice rises, unless its score says otherwise: a click-free 6 ms. */
const ATTACK = 0.006;

/**
 * A voice's envelope in seconds: `rise` to its peak, then `flat` at the peak,
 * then the rest of `length` falling. Both are held inside `length` (a score
 * cannot make a voice outlast its own length), and a missing or odd value
 * means the default: the 6 ms rise and no hold.
 */
export function envelope({ length, attack, hold }) {
    const number = (value, fallback) => (Number.isFinite(value) && value >= 0 ? value : fallback);
    const rise = Math.min(Math.max(number(attack, ATTACK), 0.001), length);
    const flat = Math.min(number(hold, 0), length - rise);

    return { rise, flat };
}

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const between = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * What a voice asks of the engine beyond its pitch and envelope, as numbers the
 * audio graph can take, each held to a range a browser handles well. A field
 * that is missing, not an object of numbers, or does nothing (zero depth) is
 * `undefined`, so a score cannot make `play` throw or a sound unbounded:
 *
 * - `detune`: cents, -1200 to 1200.
 * - `vibrato: { rate, depth }`: a pitch wobble, `rate` 0.1 to 40 Hz, `depth` up to 1200 cents.
 * - `tremolo: { rate, depth }`: a loudness wobble, `rate` 0.1 to 60 Hz, `depth` 0 to 1 (1 dips to silence).
 * - `fm: { ratio, index, to? }`: a sine at `ratio` (0.05 to 16) times the pitch, swinging
 *   the pitch by `index` (0 to 30) times its own frequency; `to` is the index at the end of
 *   the voice (default `index`), for a bell whose brightness dies away.
 */
export function modulation({ detune, vibrato, tremolo, fm } = {}) {
    const wobble = (spec, rates, ceiling) => {
        if (typeof spec !== "object" || spec === null || !finite(spec.rate) || !finite(spec.depth)) return undefined;
        const depth = between(spec.depth, 0, ceiling);

        return depth > 0 ? { rate: between(spec.rate, rates[0], rates[1]), depth } : undefined;
    };

    const bend = finite(detune) ? between(detune, -1200, 1200) : 0;
    let modulator;

    if (typeof fm === "object" && fm !== null && finite(fm.ratio) && finite(fm.index)) {
        const index = between(fm.index, 0, 30);
        const last = finite(fm.to) ? between(fm.to, 0, 30) : index;
        if (index > 0 || last > 0) modulator = { ratio: between(fm.ratio, 0.05, 16), index, to: last };
    }

    return {
        detune: bend === 0 ? undefined : bend,
        vibrato: wobble(vibrato, [0.1, 40], 1200),
        tremolo: wobble(tremolo, [0.1, 60], 1),
        fm: modulator,
    };
}

/** Peaks below this (of full scale) pass through exactly as they are. */
export const CLIP_FROM = 0.6;

/**
 * The shape of the soft limiter, as a table for a `WaveShaperNode` (its input runs
 * from -1 to 1 across the table): a straight line up to `from`, then a smooth
 * curve that flattens towards the ceiling (`from` + (1 - `from`) * tanh(1), about
 * 0.9), the same on both sides of zero.
 */
export function softClipCurve(from = CLIP_FROM, size = 2049) {
    const curve = new Float32Array(size);
    for (let index = 0; index < size; index++) {
        const x = (index / (size - 1)) * 2 - 1;
        const magnitude = Math.abs(x);
        const shaped = magnitude <= from ? magnitude : from + (1 - from) * Math.tanh((magnitude - from) / (1 - from));
        curve[index] = Math.sign(x) * shaped;
    }

    return curve;
}

/**
 * The end of the chain: a soft limiter, so voices that stack (four guns and a wave, a
 * chord of bells) are rounded off short of clipping. It is a shaper, not a
 * compressor, on purpose: a sound whose peaks stay under CLIP_FROM comes through
 * unchanged, where a compressor node also changes the level of quiet sounds (by
 * about 5 dB in Chromium, and by different amounts elsewhere). A browser without
 * the node plays straight out.
 */
function limited(context) {
    if (typeof context.createWaveShaper !== "function") return context.destination;

    const limiter = context.createWaveShaper();
    limiter.curve = softClipCurve();
    limiter.connect(context.destination);

    return limiter;
}

/** The settings drawer's own switch (main.hbs's `manager` store). */
const siteMuted = () => globalThis.Alpine?.store?.("manager")?.muted === true;

/**
 * This browser's localStorage, or undefined where reading it throws (storage
 * blocked, a sandboxed frame). It is the default of every `storage` parameter
 * below, which is evaluated before a function's own try, so a bare
 * `globalThis.localStorage` there would take the page script down with it.
 */
function defaultStorage() {
    try {
        return globalThis.localStorage;
    } catch {
        return undefined;
    }
}

/** Whether the player left sound on for `key`; on unless they switched it off here. */
export function readChoice(key, storage = defaultStorage()) {
    try {
        return storage?.getItem(key) !== "off";
    } catch {
        return true;
    }
}

export function saveChoice(key, on, storage = defaultStorage()) {
    try {
        storage?.setItem(key, on ? "on" : "off");
    } catch {
        // Private browsing: the choice lasts for this visit.
    }
}

/** The way out of a context: the master level, then the limiter. */
function masterOut(context, level) {
    const out = context.createGain();
    out.gain.value = level;
    out.connect(limited(context));

    return out;
}

/** A second of hiss, for splashes, air and a drum's stick. */
function hissOf(context, random) {
    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let index = 0; index < samples.length; index++) samples[index] = random() * 2 - 1;

    return noise;
}

/**
 * What makes one voice of a score on `context`, with `noise` for the hiss: a function
 * `(voice, scale, into)` that builds the voice's nodes and starts them. The live
 * engine and `renderScore` both build voices here, so a rendered sound is the one
 * that plays.
 */
function voiceMaker(context, noise) {
    // A sound rises over its attack, holds if it says to, and falls over the rest of its length.
    function shape(source, { at = 0, length, gain, filter, attack, hold, curve, tremolo }, scale, into) {
        const start = context.currentTime + at;
        const loudness = context.createGain();
        const { rise, flat } = envelope({ length, attack, hold });
        const peak = Math.max(0.0002, gain * scale);
        const ramp = curve === "linear" ? "linearRampToValueAtTime" : "exponentialRampToValueAtTime";
        loudness.gain.setValueAtTime(0.0001, start);
        loudness.gain[ramp](peak, start + rise);
        if (flat > 0) loudness.gain.setValueAtTime(peak, start + rise + flat);
        loudness.gain[ramp](0.0001, start + Math.max(length, rise + flat + 0.001));

        let last = source;
        if (filter) {
            const node = context.createBiquadFilter();
            node.type = filter.type;
            node.frequency.setValueAtTime(filter.from, start);
            if (filter.to) node.frequency.exponentialRampToValueAtTime(filter.to, start + length);
            last.connect(node);
            last = node;
        }

        const wobble = modulation({ tremolo }).tremolo;
        if (wobble) {
            // Gain swings between 1 - depth and 1, so a tremolo never makes a voice louder than its gain.
            const swing = context.createGain();
            swing.gain.value = 1 - wobble.depth / 2;
            const lfo = context.createOscillator();
            lfo.frequency.value = wobble.rate;
            const reach = context.createGain();
            reach.gain.value = wobble.depth / 2;
            lfo.connect(reach);
            reach.connect(swing.gain);
            last.connect(swing);
            last = swing;
            run(lfo, start, length);
        }

        last.connect(loudness).connect(into);
        run(source, start, length);
    }

    // Starts a source at `start` and stops it just after the voice's length.
    function run(source, start, length) {
        source.start(start);
        source.stop(start + length + 0.02);
    }

    // The pitch colour of a tone: a static detune, a vibrato (a slow oscillator
    // added to the detune, in cents) and FM (a sine at a multiple of the pitch
    // added to the frequency, in Hz).
    function colour(oscillator, voice, start) {
        const { detune, vibrato, fm } = modulation(voice);
        const from = voice.from;
        const to = voice.to ?? voice.from;
        const { length } = voice;

        if (detune !== undefined || vibrato) oscillator.detune.value = detune ?? 0;

        if (vibrato) {
            const lfo = context.createOscillator();
            lfo.frequency.value = vibrato.rate;
            const reach = context.createGain();
            reach.gain.value = vibrato.depth;
            lfo.connect(reach);
            reach.connect(oscillator.detune);
            run(lfo, start, length);
        }

        if (fm) {
            // The swing is `index` times the modulator's own pitch, so the timbre
            // holds when the voice slides; `fm.to` moves the index over the voice.
            const modulator = context.createOscillator();
            modulator.frequency.setValueAtTime(from * fm.ratio, start);
            modulator.frequency.exponentialRampToValueAtTime(to * fm.ratio, start + length);
            const swing = context.createGain();
            swing.gain.setValueAtTime(Math.max(0.0001, fm.index * from * fm.ratio), start);
            swing.gain.exponentialRampToValueAtTime(Math.max(0.0001, fm.to * to * fm.ratio), start + length);
            modulator.connect(swing);
            swing.connect(oscillator.frequency);
            run(modulator, start, length);
        }
    }

    return function sound(voice, scale, into) {
        if (voice.voice === "hiss") {
            const source = context.createBufferSource();
            source.buffer = noise;
            shape(source, voice, scale, into);
            return;
        }

        const oscillator = context.createOscillator();
        oscillator.type = voice.type ?? "sine";
        const start = context.currentTime + (voice.at ?? 0);
        oscillator.frequency.setValueAtTime(voice.from, start);
        oscillator.frequency.exponentialRampToValueAtTime(voice.to ?? voice.from, start + voice.length);
        colour(oscillator, voice, start);
        shape(oscillator, voice, scale, into);
    };
}

/**
 * `key` is where the on/off choice is kept; `scores` maps a sound's name to its
 * score. `isMuted`, `storage`, `AudioContextClass` and `random` are there for a
 * test (and `isMuted` for a page with its own idea of muted).
 */
export function createSfx({
    key,
    scores = {},
    level = LEVEL,
    isMuted = siteMuted,
    storage = defaultStorage(),
    AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
    random = Math.random,
}) {
    let context;
    let out;
    let voice; // makes one voice on `context`: see voiceMaker

    const sfx = {
        on: readChoice(key, storage),

        /** Switches this game's sound and keeps the choice. */
        setOn(value) {
            sfx.on = Boolean(value);
            saveChoice(key, sfx.on, storage);
        },

        /** Whether sound is wanted right now: on here, and not off in the settings drawer. */
        wanted() {
            return sfx.on && !isMuted();
        },

        /** Starts (or resumes) the audio. Call it from a click or key press. */
        wake() {
            if (!sfx.wanted() || AudioContextClass === undefined) return;

            try {
                if (!context) {
                    context = new AudioContextClass();
                    out = masterOut(context, level);
                    voice = voiceMaker(context, hissOf(context, random));
                }
                resumeIfStopped();
            } catch {
                context = undefined; // No sound here; the game goes on without.
            }
        },

        /**
         * Resumes a context the browser has stopped under us (a backgrounded
         * tab, a phone call), without making one: no gesture has happened if
         * there is none yet, and a context made now would only be refused.
         */
        recover() {
            if (sfx.wanted()) resumeIfStopped();
        },

        /**
         * Wakes the audio on a click, tap or key on `target`, and again on any
         * later one, since a browser may stop the context again (iOS does when
         * the page is backgrounded or a call comes in) and `play()` is silent
         * until it runs. A running context makes `wake()` a no-op, so the
         * listeners stay for good. A touch's `pointerdown` is not a user
         * activation (a browser lets audio start on `pointerup`, `click` and a
         * key, and on a mouse's `pointerdown`), so a phone is woken by the
         * tap's end. Coming back to the page also resumes a stopped context,
         * which a browser may allow without a gesture.
         */
        wakeOnGesture(target = globalThis.document) {
            for (const gesture of ["pointerdown", "pointerup", "click", "keydown"]) {
                target?.addEventListener(gesture, () => sfx.wake(), { passive: true });
            }

            target?.addEventListener("visibilitychange", () => {
                if (target.visibilityState !== "hidden") sfx.recover();
            });
        },

        /**
         * The Alpine half of a page's Sound button, to spread into its store:
         * `sound` (this game's choice), `muted()`, `soundOn()` (the choice under
         * the settings drawer's switch) and `toggleSound()`. The press is the
         * click a browser waits for, so it wakes the audio and plays `confirm`,
         * which says what "on" sounds like. Bind the button to `soundOn()`.
         */
        switch(confirm) {
            return {
                sound: sfx.on,

                muted() {
                    return isMuted();
                },

                soundOn() {
                    return this.sound && !this.muted();
                },

                toggleSound() {
                    this.sound = !this.sound;
                    sfx.setOn(this.sound);
                    sfx.wake();
                    if (confirm !== undefined) sfx.play(confirm);
                },
            };
        },

        /**
         * Plays the sound `name` made with `options`, `gain` times as loud (below
         * 1 is quieter), and `pan` from -1 (left) to 1 (right) for a sound that
         * comes from somewhere. Says whether anything sounded. A browser with no
         * stereo panner plays it from the middle.
         */
        play(name, options = {}, gain = 1, pan = 0) {
            if (!sfx.wanted() || context?.state !== "running") return false;

            const score = scores[name]?.(options) ?? [];
            if (score.length === 0) return false;

            try {
                const into = placed(pan);
                for (const part of score) voice(part, gain, into);
                return true;
            } catch (error) {
                console.warn("[CLIENT] sound:", error);
                return false;
            }
        },
    };

    // iOS Safari reports "interrupted" for a context a call or the lock screen
    // stopped, which `resume()` brings back like "suspended".
    function resumeIfStopped() {
        if (context && (context.state === "suspended" || context.state === "interrupted")) {
            context.resume().catch(() => {});
        }
    }

    // Where one sound's voices go: through a panner when it comes from one side.
    function placed(pan) {
        const side = Math.max(-1, Math.min(1, Number(pan) || 0));
        if (side === 0 || typeof context.createStereoPanner !== "function") return out;

        const panner = context.createStereoPanner();
        panner.pan.value = side;
        panner.connect(out);
        return panner;
    }

    return sfx;
}

/** Seconds a render may last at most, whatever a score asks: it bounds the memory a hostile score can use. */
export const MAX_RENDER_SECONDS = 30;

/** Seconds of silence kept after the last voice, for the limiter's release. */
const TAIL = 0.15;

/**
 * Renders `score` to an `AudioBuffer` (mono) without playing it: the same voices as
 * `play`, through the same master level and limiter, on an `OfflineAudioContext`, so
 * the file is what was heard. Nothing needs a click or a gesture. It lasts until the
 * last voice ends plus a short tail, at most MAX_RENDER_SECONDS.
 *
 * Options: `sampleRate` (default 44100), `gain` (a multiplier on every voice, as in
 * `play`), `level` (the master level, as in `createSfx`), `random` (the noise: seed
 * it, and the same score renders to the same samples), `tail`, and
 * `OfflineAudioContextClass` for a test.
 *
 * Resolves `undefined`, and never rejects, for an empty score, a browser without
 * `OfflineAudioContext`, or a render that fails (the failure is logged).
 */
export async function renderScore(
    score,
    {
        sampleRate = 44100,
        gain = 1,
        level = LEVEL,
        random = Math.random,
        tail = TAIL,
        OfflineAudioContextClass = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext,
    } = {},
) {
    if (!Array.isArray(score) || score.length === 0 || OfflineAudioContextClass === undefined) return undefined;

    try {
        const ends = score.map((voice) => (Number(voice.at) || 0) + Number(voice.length) + 0.02);
        const seconds = Math.min(MAX_RENDER_SECONDS, Math.max(...ends.filter(Number.isFinite), 0) + tail);
        if (!(seconds > 0)) return undefined;

        const context = new OfflineAudioContextClass(1, Math.ceil(seconds * sampleRate), sampleRate);
        const voice = voiceMaker(context, hissOf(context, random));
        const out = masterOut(context, level);
        for (const part of score) voice(part, gain, out);

        return await context.startRendering();
    } catch (error) {
        console.warn("[CLIENT] sound render:", error);
        return undefined;
    }
}

/** A sound that does nothing, for a page (or a test) that has none. */
export const silentSfx = {
    on: false,
    setOn() {},
    wake() {},
    wakeOnGesture() {},
    recover() {},
    wanted: () => false,
    play: () => false,
    switch: () => ({ sound: false, muted: () => false, soundOn: () => false, toggleSound() {} }),
};
