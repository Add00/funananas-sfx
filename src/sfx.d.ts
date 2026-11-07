// The types of `sfx.js` (plain JS). The contract is docs/sfx.md; the test `tests/types.test.ts`
// fails if an export of the module is missing here, or here and not in the module.

export type Waveform = "sine" | "triangle" | "square" | "sawtooth";

/** A biquad filter, swept from `from` to `to` over the voice's length. */
export interface Filter {
    type: BiquadFilterType;
    from: number;
    to?: number;
    /** Resonance as the usual linear Q, 0.1 to 15 (about 0.7 is flat, 5 to 10 rings at the cutoff). */
    q?: number;
}

/** Repeats of a voice: `time` seconds apart (0.02 to 0.5), each `feedback` (0 to 0.85, default 0.4) of the last, the first at `mix` (0 to 1, default 0.5). */
export interface EchoSpec {
    time: number;
    feedback?: number;
    mix?: number;
}

/** A wobble: `rate` in Hz, `depth` in cents (vibrato) or 0 to 1 (tremolo). */
export interface Wobble {
    rate: number;
    depth: number;
}

/** Frequency modulation: a second oscillator at `ratio` times the pitch, `index` deep, ending at `to`. */
export interface FmSpec {
    ratio: number;
    index: number;
    to?: number;
}

/** A room's tail: `time` seconds long (0.1 to 3), at `mix` (0 to 1, default 0.35) of the voice. */
export interface ReverbSpec {
    time: number;
    mix?: number;
}

export type ModSource = "lfo" | "rise" | "fall";
export type ModTarget = "pitch" | "cutoff" | "volume" | "fm";

/**
 * Lets a source move a setting. `lfo` swings both ways at `rate` Hz (0.1 to 40, default 5) in `shape` (default
 * sine); `rise` goes 0 to 1 over the voice, `fall` 1 to 0. `amount` is how far it pushes, either way: cents for
 * `pitch` (up to 2400), octaves for `cutoff` (6), a fraction of the volume for `volume` (1, never louder than the
 * voice's gain) and an index for `fm` (30). `cutoff` needs a filter and `fm` needs FM. One per target, up to four.
 */
export interface ModSpec {
    source: ModSource;
    to: ModTarget;
    amount: number;
    rate?: number;
    shape?: Waveform;
}

interface VoiceBase {
    /** Seconds from the start of the sound. */
    at?: number;
    /** Seconds the voice lasts. */
    length: number;
    /** 0 to 1. */
    gain: number;
    filter?: Filter;
    /** Seconds to the peak. Default 0.006. */
    attack?: number;
    /** Seconds held at the peak. Default 0. */
    hold?: number;
    /** How the level falls: exponentially (the default) or in a straight line. */
    curve?: "exp" | "linear";
    tremolo?: Wobble;
    /** Distortion, 0 (none) to 1 (very hard). */
    drive?: number;
    echo?: EchoSpec;
    reverb?: ReverbSpec;
    /** -1 (left) to 1 (right), heard in a stereo render or on stereo speakers. */
    pan?: number;
    mod?: ModSpec[];
}

/** A pitch, which may slide from `from` to `to`. */
export interface ToneVoice extends VoiceBase {
    voice: "tone";
    type?: Waveform;
    from: number;
    to?: number;
    /** Cents. */
    detune?: number;
    vibrato?: Wobble;
    fm?: FmSpec;
    /** A custom wave: the levels (0 to 1) of the first harmonics (up to 32), from the pitch itself upwards. Replaces `type`. */
    harmonics?: number[];
    /** A square wave's width, 0.05 to 0.95 (0.5 is the ordinary square). */
    pulse?: number;
    /** How the pitch slides: `"exp"` (the default) or `"linear"`. */
    slide?: "exp" | "linear";
}

/** Noise: wind, impacts, explosions, swishes. */
export interface HissVoice extends VoiceBase {
    voice: "hiss";
    /** `"white"` (the default), or `"pink"` or `"brown"`, which are deeper. */
    noise?: "white" | "pink" | "brown";
}

export type Voice = ToneVoice | HissVoice;

/** A sound: voices that play together. */
export type Score = Voice[];

/** The Alpine half of a page's Sound button, from `Sfx.switch`. */
export interface SoundSwitch {
    sound: boolean;
    muted(): boolean;
    soundOn(): boolean;
    toggleSound(): void;
}

export interface Sfx {
    /** Whether the player left sound on for this game. */
    on: boolean;
    setOn(value: boolean): void;
    /** Sound is wanted right now: on here, and not muted in the settings drawer. */
    wanted(): boolean;
    /** Starts (or resumes) the audio. Call it from a click or key press. */
    wake(): void;
    /** Resumes a context the browser has stopped, without making one. */
    recover(): void;
    /** Wakes the audio on a click, tap or key on `target` (the document by default), and again on any later one. */
    wakeOnGesture(target?: EventTarget): void;
    /** For an Alpine store: `confirm` is the sound played when the player turns sound on. */
    switch(confirm?: string): SoundSwitch;
    /**
     * Plays the sound `name` made with `options`, `gain` times as loud, and `pan` from -1 (left) to 1
     * (right). Says whether anything sounded.
     */
    play(name: string, options?: object, gain?: number, pan?: number): boolean;
}

export interface SfxOptions {
    /** Where the on/off choice is kept in this browser: give each game its own. */
    key: string;
    /** Sound names to scores: a score is a function from options to voices. */
    scores?: Record<string, (options?: any) => Score>;
    /** The master level. Default 0.55. */
    level?: number;
    /** For a page with its own idea of muted, or a test. */
    isMuted?: () => boolean;
    storage?: Pick<Storage, "getItem" | "setItem"> | undefined;
    /** For a test. */
    AudioContextClass?: unknown;
    /** The noise. For a test. */
    random?: () => number;
}

export function createSfx(options: SfxOptions): Sfx;

/** A sound that does nothing, for a page (or a test) that has none. */
export const silentSfx: Sfx;

export interface RenderOptions {
    /** Hz; default 44100. */
    sampleRate?: number;
    /** A multiplier on every voice, as in `play`. */
    gain?: number;
    /** The master level, as in `createSfx`. */
    level?: number;
    /** The noise: seed it and the same score renders to the same samples. */
    random?: () => number;
    /** Seconds of silence after the last voice. */
    tail?: number;
    /** 1 (the default) or 2. A voice's `pan` is only heard in 2. */
    channels?: 1 | 2;
    /** Only for a test, or a runtime with no Web Audio of its own (Node, with a package for it). */
    OfflineAudioContextClass?: unknown;
}

/** Seconds a render may last at most, whatever a score asks. */
export const MAX_RENDER_SECONDS: number;

/**
 * Renders a score to a mono `AudioBuffer` without playing it: the same voices, master level and
 * limiter as `play`. Resolves `undefined` (never rejects) for an empty score, no
 * `OfflineAudioContext`, or a failed render.
 */
export function renderScore(score: Score, options?: RenderOptions): Promise<AudioBuffer | undefined>;

/** A voice's envelope in seconds: `rise` to its peak, then `flat` at the peak. */
export function envelope(voice: { length: number; attack?: number; hold?: number }): {
    rise: number;
    flat: number;
};

/** What a voice asks beyond its pitch and envelope, with every value held to its range. */
export function modulation(voice?: Partial<Omit<ToneVoice, "voice">> & { noise?: "white" | "pink" | "brown" }): {
    detune: number | undefined;
    vibrato: Wobble | undefined;
    tremolo: Wobble | undefined;
    fm: Required<FmSpec> | undefined;
    /** The filter's linear Q. */
    q: number | undefined;
    drive: number | undefined;
    echo: Required<EchoSpec> | undefined;
    reverb: Required<ReverbSpec> | undefined;
    pan: number | undefined;
    mods: ModSpec[] | undefined;
    harmonics: number[] | undefined;
    pulse: number | undefined;
    slide: "linear" | undefined;
    noise: "pink" | "brown" | undefined;
};

/** What a modulation may take from, and push on. */
export const MOD_SOURCES: readonly ModSource[];
export const MOD_TARGETS: readonly ModTarget[];

/** Most harmonics a custom wave may have. */
export const MAX_HARMONICS: number;

/** `PeriodicWave` tables for a wave given as the levels of its harmonics. */
export function harmonicWave(levels: number[]): { real: Float32Array; imag: Float32Array };

/** `PeriodicWave` tables for a pulse wave of width `duty` (0.5 is a square wave). */
export function pulseWave(duty: number, harmonics?: number): { real: Float32Array; imag: Float32Array };

/** White noise made pink or brown, scaled to a peak of 1; any other colour gives the input back. */
export function tintedNoise(white: Float32Array, colour: string): Float32Array;

/** A room's impulse response: noise that dies away over `seconds`, the same every time. */
export function impulseResponse(seconds: number, sampleRate: number): Float32Array;

/** The repeats an echo makes: `delay` seconds after the voice, at `gain` times its level. */
export function echoTaps(echo: Required<EchoSpec> | undefined): Array<{ delay: number; gain: number }>;

/** Seconds from the start of the sound until the voice, and the last of its echoes, has ended. */
export function endOf(voice: Pick<Voice, "at" | "length" | "echo">): number;

/** The distortion's shape as a table for a `WaveShaperNode`; `amount` is 0 to 1. */
export function driveCurve(amount: number, size?: number): Float32Array;

/** Peaks below this (of full scale) pass through the limiter exactly as they are. */
export const CLIP_FROM: number;

/** The limiter's shape as a table for a `WaveShaperNode`. */
export function softClipCurve(from?: number, size?: number): Float32Array;

/** Whether the player left sound on for `key`; on unless they switched it off here. */
export function readChoice(key: string, storage?: Pick<Storage, "getItem"> | undefined): boolean;

/** Keeps the player's choice for `key`. */
export function saveChoice(key: string, on: boolean, storage?: Pick<Storage, "setItem"> | undefined): void;
