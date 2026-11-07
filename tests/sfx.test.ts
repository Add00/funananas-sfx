import { beforeAll, describe, expect, it, vi } from "vitest";

let sfxModule: any;

beforeAll(async () => {
    sfxModule = await import("../src/sfx.js");
});

/** Just enough of the Web Audio API to count what is made and started. */
function fakeContext(state = "running") {
    const made = { oscillators: 0, noises: 0, started: 0, instances: 0, filters: 0, slides: 0 };
    const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime: () => made.slides++ });
    const node = () => ({ connect: (next: any) => next, gain: param(), frequency: param(), type: "" });

    class Context {
        state = state;
        currentTime = 0;
        sampleRate = 100;
        destination = {};
        constructor() {
            made.instances++;
        }
        resume() {
            this.state = "running";

            return Promise.resolve();
        }
        createGain = node;
        createBiquadFilter() {
            made.filters++;

            return node();
        }
        createBuffer = () => ({ getChannelData: () => new Float32Array(100) });
        createOscillator() {
            made.oscillators++;

            return { ...node(), start: () => made.started++, stop() {} };
        }
        createBufferSource() {
            made.noises++;

            return { ...node(), buffer: null, start: () => made.started++, stop() {} };
        }
    }

    return { Context, made };
}

const memory = (initial: Record<string, string> = {}) => {
    const kept = { ...initial };

    return {
        kept,
        getItem: (key: string) => kept[key] ?? null,
        setItem: (key: string, value: string) => void (kept[key] = value),
    };
};

const SCORES = {
    ping: () => [{ voice: "tone", type: "triangle", from: 440, to: 220, length: 0.1, gain: 0.3 }],
    swish: () => [
        { voice: "hiss", length: 0.2, gain: 0.2, filter: { type: "bandpass", from: 500, to: 2000 } },
        { voice: "tone", from: 100, at: 0.05, length: 0.1, gain: 0.2 },
    ],
    quiet: () => [],
};

function make(overrides: Record<string, unknown> = {}, state = "running") {
    const { Context, made } = fakeContext(state);
    const storage = memory();
    const sfx = sfxModule.createSfx({
        key: "test-sound",
        scores: SCORES,
        AudioContextClass: Context,
        storage,
        isMuted: () => false,
        ...overrides,
    });

    return { sfx, made, storage };
}

describe("createSfx", () => {
    it("plays nothing before it is woken by a click or key", () => {
        const { sfx, made } = make();

        expect(sfx.play("ping")).toBe(false);
        expect(made.started).toBe(0);
    });

    it("plays a score as voices once woken, with filters and slides where it says", () => {
        const { sfx, made } = make();
        sfx.wake();

        expect(sfx.play("swish")).toBe(true);
        expect(made.oscillators).toBe(1);
        expect(made.noises).toBe(1);
        expect(made.filters).toBe(1);
        expect(made.started).toBe(2);

        expect(sfx.play("ping")).toBe(true);
        expect(made.oscillators).toBe(2);
    });

    it("sends a sound from one side through one panner, held to -1..1, and the middle or a browser without one straight out", () => {
        const panners: Array<{ pan: { value: number } }> = [];
        const pans = () => panners.map((panner) => panner.pan.value);
        const { Context } = fakeContext();
        class Stereo extends Context {
            createStereoPanner() {
                const panner = { pan: { value: 0 }, connect: (next: unknown) => next };
                panners.push(panner);

                return panner;
            }
        }
        const sfx = sfxModule.createSfx({
            key: "k",
            scores: SCORES,
            AudioContextClass: Stereo,
            storage: memory(),
            isMuted: () => false,
        });
        sfx.wake();

        expect(sfx.play("swish", {}, 1, -0.5)).toBe(true);
        expect(pans()).toEqual([-0.5]);
        sfx.play("ping", {}, 1, 7);
        expect(pans()).toEqual([-0.5, 1]);
        sfx.play("ping", {}, 1, 0);
        sfx.play("ping");
        expect(pans()).toHaveLength(2);

        // No StereoPannerNode (an old Safari): still heard, from the middle.
        const { sfx: plain, made } = make();
        plain.wake();
        expect(plain.play("ping", {}, 1, 0.8)).toBe(true);
        expect(made.started).toBe(1);
    });

    it("hands the options to the score", () => {
        const score = vi.fn(() => [{ voice: "tone", from: 300, length: 0.1, gain: 0.2 }]);
        const { sfx } = make({ scores: { hit: score } });
        sfx.wake();
        sfx.play("hit", { gain: 0.7 });

        expect(score).toHaveBeenCalledWith({ gain: 0.7 });
    });

    it("makes one context however often it is woken, and resumes a suspended one", () => {
        const { sfx, made } = make({}, "suspended");
        sfx.wake();
        sfx.wake();
        sfx.wake();

        expect(made.instances).toBe(1);
    });

    it("is silent for a name that is not a sound or a score with no voices", () => {
        const { sfx } = make();
        sfx.wake();

        expect(sfx.play("nonsense")).toBe(false);
        expect(sfx.play("quiet")).toBe(false);
    });

    it("stays silent, and starts no audio, when switched off or when the site's Sound is off", () => {
        const off = make({ storage: memory({ "test-sound": "off" }) });
        off.sfx.wake();
        expect(off.sfx.on).toBe(false);
        expect(off.sfx.play("ping")).toBe(false);
        expect(off.made.instances).toBe(0);

        let muted = false;
        const { sfx } = make({ isMuted: () => muted });
        sfx.wake();
        muted = true;
        expect(sfx.wanted()).toBe(false);
        expect(sfx.play("ping")).toBe(false);
        muted = false;
        sfx.setOn(false);
        expect(sfx.play("ping")).toBe(false);
        sfx.setOn(true);
        expect(sfx.play("ping")).toBe(true);
    });

    it("keeps the player's choice in this browser, per key", () => {
        const { sfx, storage } = make();
        expect(sfx.on).toBe(true);

        sfx.setOn(false);
        expect(storage.kept["test-sound"]).toBe("off");
        sfx.setOn(true);
        expect(storage.kept["test-sound"]).toBe("on");
    });

    it("survives a browser with no audio, one that refuses a context, and storage that throws", () => {
        const none = sfxModule.createSfx({
            key: "k",
            scores: SCORES,
            AudioContextClass: undefined,
            isMuted: () => false,
            storage: memory(),
        });
        none.wake();
        expect(none.play("ping")).toBe(false);

        const blocked = sfxModule.createSfx({
            key: "k",
            scores: SCORES,
            isMuted: () => false,
            storage: memory(),
            AudioContextClass: class {
                constructor() {
                    throw new Error("blocked");
                }
            },
        });
        expect(() => blocked.wake()).not.toThrow();
        expect(blocked.play("ping")).toBe(false);

        const refusing = {
            getItem: () => {
                throw new Error("no");
            },
            setItem: () => {
                throw new Error("no");
            },
        };
        const { Context } = fakeContext();
        const sfx = sfxModule.createSfx({
            key: "k",
            scores: SCORES,
            AudioContextClass: Context,
            isMuted: () => false,
            storage: refusing,
        });
        expect(sfx.on).toBe(true);
        expect(() => sfx.setOn(false)).not.toThrow();
    });

    it("warns, and does not throw, when a voice fails", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { sfx } = make({ scores: { bad: () => [null] } });
        sfx.wake();

        expect(sfx.play("bad")).toBe(false);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("is made, and on, in a browser where reading localStorage throws", () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get() {
                throw new Error("SecurityError");
            },
        });

        try {
            const { Context } = fakeContext();
            const sfx = sfxModule.createSfx({
                key: "k",
                scores: SCORES,
                AudioContextClass: Context,
                isMuted: () => false,
            });

            expect(sfx.on).toBe(true);
            expect(() => sfx.setOn(false)).not.toThrow();
            expect(sfxModule.readChoice("k")).toBe(true);
            expect(() => sfxModule.saveChoice("k", false)).not.toThrow();
        } finally {
            if (original) Object.defineProperty(globalThis, "localStorage", original);
            else delete (globalThis as any).localStorage;
        }
    });

    /** A page that remembers its listeners, as `wakeOnGesture` wants one. */
    function page() {
        const handlers = new Map<string, () => void>();

        return {
            handlers,
            visibilityState: "visible",
            addEventListener: (name: string, handler: () => void) => void handlers.set(name, handler),
        };
    }

    it("wakes on a press, a tap's end, a click or a key on the page it is given", () => {
        const target = page();
        const { sfx, made } = make();
        sfx.wakeOnGesture(target);

        // A touch's pointerdown is no user activation, so the tap's end must be heard too.
        expect([...target.handlers.keys()].sort()).toEqual([
            "click",
            "keydown",
            "pointerdown",
            "pointerup",
            "visibilitychange",
        ]);
        expect(made.instances).toBe(0);
        target.handlers.get("pointerup")!();
        expect(made.instances).toBe(1);
    });

    /** A context the test can stop, as a browser does: it counts how often it is resumed. */
    function stoppable() {
        const instances: any[] = [];
        let resumed = 0;
        class Context {
            state = "running";
            currentTime = 0;
            sampleRate = 100;
            destination = {};
            constructor() {
                instances.push(this);
            }
            resume() {
                resumed++;
                this.state = "running";

                return Promise.resolve();
            }
            createGain = () => ({ connect: () => ({}), gain: {} });
            createBuffer = () => ({ getChannelData: () => new Float32Array(100) });
        }

        return { Context, instances, resumed: () => resumed };
    }

    const engineOn = (Context: unknown) =>
        sfxModule.createSfx({
            key: "k",
            scores: SCORES,
            AudioContextClass: Context,
            storage: memory(),
            isMuted: () => false,
        });

    it("keeps listening once the audio is running, so a gesture can wake it after the browser stops it", () => {
        const target = page();
        const { Context, instances, resumed } = stoppable();
        const sfx = engineOn(Context);
        sfx.wakeOnGesture(target);

        target.handlers.get("click")!();
        expect(target.handlers.size).toBe(5);

        // iOS stops the context when the page is backgrounded or a call comes in.
        instances[0].state = "interrupted";
        target.handlers.get("pointerup")!();

        expect(resumed()).toBe(1);
        expect(instances[0].state).toBe("running");
    });

    it("resumes a context the browser left interrupted or suspended, and leaves a running one alone", () => {
        for (const stopped of ["interrupted", "suspended"]) {
            const { Context, instances, resumed } = stoppable();
            const sfx = engineOn(Context);

            sfx.wake();
            sfx.wake();
            expect(resumed(), "running").toBe(0);

            instances[0].state = stopped;
            sfx.wake();
            expect(resumed(), stopped).toBe(1);
        }
    });

    it("resumes a stopped context when the page comes back, and makes none if there never was one", () => {
        const target = page();
        const { Context, instances, resumed } = stoppable();
        const sfx = engineOn(Context);
        sfx.wakeOnGesture(target);

        // Nobody has clicked yet: coming back must not make a context a browser would refuse.
        target.handlers.get("visibilitychange")!();
        expect(instances).toHaveLength(0);

        target.handlers.get("click")!();
        instances[0].state = "interrupted";
        target.handlers.get("visibilitychange")!();
        expect(resumed()).toBe(1);
    });

    it("does not resume anything for a player who has the sound off", () => {
        const { Context, instances, resumed } = stoppable();
        const sfx = engineOn(Context);
        sfx.wake();
        instances[0].state = "suspended";
        sfx.setOn(false);

        sfx.recover();
        expect(resumed()).toBe(0);
    });

    it("does nothing on the page being hidden", () => {
        const target = page();
        const spy = vi.fn();
        const sfx = sfxModule.createSfx({
            key: "k",
            scores: SCORES,
            AudioContextClass: undefined,
            storage: memory(),
            isMuted: () => false,
        });
        sfx.recover = spy;
        sfx.wakeOnGesture(target);

        target.visibilityState = "hidden";
        target.handlers.get("visibilitychange")!();
        expect(spy).not.toHaveBeenCalled();
        target.visibilityState = "visible";
        target.handlers.get("visibilitychange")!();
        expect(spy).toHaveBeenCalledOnce();
    });

    it("keeps listening while the player has the sound off, so switching it on can still wake it", () => {
        const target = page();
        const { sfx, made } = make({ storage: memory({ "test-sound": "off" }) });
        sfx.wakeOnGesture(target);
        target.handlers.get("click")!();

        expect(made.instances).toBe(0);
        expect(target.handlers.size).toBe(5);
    });

    it("reads the settings drawer's Sound switch unless it is told otherwise", () => {
        const { Context } = fakeContext();
        const sfx = sfxModule.createSfx({ key: "k", scores: SCORES, AudioContextClass: Context, storage: memory() });
        expect(sfx.wanted()).toBe(true);

        (globalThis as any).Alpine = { store: () => ({ muted: true }) };
        expect(sfx.wanted()).toBe(false);
        delete (globalThis as any).Alpine;
    });
});

describe("the Sound button's store fragment", () => {
    function pair(options: Record<string, unknown> = {}) {
        const { Context, made } = fakeContext("running");
        const storage = memory();
        const sfx = sfxModule.createSfx({ key: "k", scores: SCORES, AudioContextClass: Context, storage, ...options });

        return { sfx, storage, made };
    }

    it("starts as the player left the game's sound", () => {
        expect(pair().sfx.switch().sound).toBe(true);
        expect(pair({ storage: memory({ k: "off" }) }).sfx.switch().sound).toBe(false);
    });

    it("switches the sound, keeps the choice, wakes the audio and plays the confirmation", () => {
        const { sfx, storage, made } = pair();
        const store = { ...sfx.switch("ping") };

        store.toggleSound.call(store);
        expect(store.sound).toBe(false);
        expect(storage.kept.k).toBe("off");
        // Off: the confirmation stays quiet.
        expect(made.started).toBe(0);

        store.toggleSound.call(store);
        expect(store.sound).toBe(true);
        expect(storage.kept.k).toBe("on");
        expect(made.instances).toBe(1);
        expect(made.started).toBe(1);
    });

    it("plays no confirmation when it is not given one", () => {
        const { sfx, made } = pair();
        const store = { ...sfx.switch() };

        store.toggleSound.call(store);
        store.toggleSound.call(store);

        expect(made.started).toBe(0);
    });

    it("reports the sound as off under the settings drawer's switch", () => {
        let muted = false;
        const { sfx } = pair({ isMuted: () => muted });
        const store = { ...sfx.switch() };

        expect(store.soundOn.call(store)).toBe(true);
        muted = true;
        expect(store.muted()).toBe(true);
        expect(store.soundOn.call(store)).toBe(false);
    });

    it("is quiet and off for the silent engine", () => {
        const store = { ...sfxModule.silentSfx.switch() };

        store.toggleSound();
        expect(store.soundOn.call(store)).toBe(false);
    });
});

describe("silentSfx", () => {
    it("has the engine's whole surface and plays nothing", () => {
        const { silentSfx } = sfxModule;

        expect(silentSfx.play("ping")).toBe(false);
        expect(() => {
            silentSfx.wake();
            silentSfx.setOn(true);
            silentSfx.wakeOnGesture();
        }).not.toThrow();
        expect(silentSfx.wanted()).toBe(false);
    });
});

describe("envelope", () => {
    it("rises in 6 ms with no hold unless the score says otherwise", () => {
        expect(sfxModule.envelope({ length: 0.5 })).toEqual({ rise: 0.006, flat: 0 });
    });

    it("takes a slower attack and a hold, and keeps both inside the voice's length", () => {
        expect(sfxModule.envelope({ length: 1, attack: 0.3, hold: 0.2 })).toEqual({ rise: 0.3, flat: 0.2 });
        expect(sfxModule.envelope({ length: 0.5, attack: 2, hold: 1 })).toEqual({ rise: 0.5, flat: 0 });
        expect(sfxModule.envelope({ length: 0.5, attack: 0.2, hold: 9 })).toEqual({ rise: 0.2, flat: 0.3 });
    });

    it("ignores a value that is not a number or is negative, and never rises faster than 1 ms", () => {
        expect(sfxModule.envelope({ length: 0.5, attack: -1, hold: Number.NaN })).toEqual({ rise: 0.006, flat: 0 });
        expect(sfxModule.envelope({ length: 0.5, attack: 0 })).toEqual({ rise: 0.001, flat: 0 });
        expect(sfxModule.envelope({ length: 0.5, attack: "slow" as unknown as number })).toEqual({
            rise: 0.006,
            flat: 0,
        });
    });
});

describe("a voice's envelope and the limiter, as the audio graph gets them", () => {
    /** Every gain automation call, in order, and what the output was connected to. */
    function recording({ withLimiter = true } = {}) {
        const calls: Array<[string, number, number]> = [];
        let outputTo: unknown;
        const limiter: { curve: Float32Array | null; oversample: string; connect: (next: unknown) => unknown } = {
            curve: null,
            oversample: "none",
            connect: (next: unknown) => next,
        };
        const destination = { name: "destination" };
        const gainParam = () => ({
            value: 0,
            setValueAtTime: (value: number, time: number) => calls.push(["set", value, time]),
            exponentialRampToValueAtTime: (value: number, time: number) => calls.push(["exp", value, time]),
            linearRampToValueAtTime: (value: number, time: number) => calls.push(["linear", value, time]),
        });
        const other = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
        let gains = 0;

        class Context {
            state = "running";
            currentTime = 0;
            sampleRate = 100;
            destination = destination;
            resume() {
                return Promise.resolve();
            }
            // The first gain node is the output's; later ones are voices'.
            createGain = () => {
                const first = gains++ === 0;

                return {
                    connect: (next: unknown) => {
                        if (first) outputTo = next;
                        return next;
                    },
                    gain: first ? { value: 0 } : gainParam(),
                };
            };
            createBuffer = () => ({ getChannelData: () => new Float32Array(100) });
            createOscillator = () => ({
                connect: (next: unknown) => next,
                frequency: other(),
                type: "",
                start() {},
                stop() {},
            });
            createWaveShaper = withLimiter ? () => limiter : undefined;
        }

        return { Context, calls, limiter, destination, outputTo: () => outputTo };
    }

    const play = (voice: Record<string, unknown>, rig: ReturnType<typeof recording>) => {
        const sfx = sfxModule.createSfx({
            key: "k",
            scores: { v: () => [{ voice: "tone", from: 440, length: 1, gain: 0.5, ...voice }] },
            AudioContextClass: rig.Context,
            storage: memory(),
            isMuted: () => false,
        });
        sfx.wake();

        return sfx.play("v");
    };

    it("keeps the old shape by default: a 6 ms rise and an exponential fall", () => {
        const rig = recording();
        expect(play({}, rig)).toBe(true);

        expect(rig.calls.map(([kind, , time]) => [kind, time])).toEqual([
            ["set", 0],
            ["exp", 0.006],
            ["exp", 1],
        ]);
    });

    it("rises over `attack`, holds at the peak, then falls to the end of `length`", () => {
        const rig = recording();
        play({ attack: 0.25, hold: 0.25 }, rig);

        expect(rig.calls.map(([kind, , time]) => [kind, time])).toEqual([
            ["set", 0],
            ["exp", 0.25],
            ["set", 0.5],
            ["exp", 1],
        ]);
        expect(rig.calls[2]![1]).toBe(rig.calls[1]![1]);
    });

    it("uses straight ramps for a linear curve", () => {
        const rig = recording();
        play({ curve: "linear" }, rig);

        expect(rig.calls.map(([kind]) => kind)).toEqual(["set", "linear", "linear"]);
    });

    it("puts a soft limiter before the speakers, and goes straight out in a browser without one", () => {
        const rig = recording();
        play({}, rig);

        expect(rig.outputTo()).toBe(rig.limiter);
        expect(rig.limiter.curve).toBeInstanceOf(Float32Array);
        // Not oversampled: the resampling filter rings past full scale on a hard edge.
        expect(rig.limiter.oversample).toBe("none");

        const bare = recording({ withLimiter: false });
        play({}, bare);
        expect(bare.outputTo()).toBe(bare.destination);
    });
});

describe("modulation", () => {
    it("is empty for a voice with none, and for fields that are not numbers or do nothing", () => {
        const none = { detune: undefined, vibrato: undefined, tremolo: undefined, fm: undefined };

        expect(sfxModule.modulation({})).toEqual(none);
        expect(sfxModule.modulation()).toEqual(none);
        expect(
            sfxModule.modulation({
                detune: 0,
                vibrato: { rate: 5, depth: 0 },
                tremolo: { rate: 5 },
                fm: { ratio: 2, index: 0 },
            }),
        ).toEqual(none);
        expect(
            sfxModule.modulation({ detune: "x", vibrato: "x", tremolo: null, fm: { ratio: Number.NaN, index: 1 } }),
        ).toEqual(none);
    });

    it("passes sensible values through", () => {
        expect(
            sfxModule.modulation({
                detune: -7,
                vibrato: { rate: 6, depth: 30 },
                tremolo: { rate: 8, depth: 0.5 },
                fm: { ratio: 2.5, index: 3, to: 0 },
            }),
        ).toEqual({
            detune: -7,
            vibrato: { rate: 6, depth: 30 },
            tremolo: { rate: 8, depth: 0.5 },
            fm: { ratio: 2.5, index: 3, to: 0 },
        });
    });

    it("holds every value to its range", () => {
        const held = sfxModule.modulation({
            detune: 99999,
            vibrato: { rate: 1e9, depth: 1e9 },
            tremolo: { rate: 0, depth: 5 },
            fm: { ratio: 1e6, index: 1e6, to: -3 },
        });

        expect(held).toEqual({
            detune: 1200,
            vibrato: { rate: 40, depth: 1200 },
            tremolo: { rate: 0.1, depth: 1 },
            fm: { ratio: 16, index: 30, to: 0 },
        });
        expect(sfxModule.modulation({ detune: -99999 }).detune).toBe(-1200);
    });

    it("defaults the FM index at the end of a voice to the one at its start, and drops FM that is zero throughout", () => {
        expect(sfxModule.modulation({ fm: { ratio: 2, index: 4 } }).fm).toEqual({ ratio: 2, index: 4, to: 4 });
        expect(sfxModule.modulation({ fm: { ratio: 2, index: 0, to: 0 } }).fm).toBeUndefined();
        expect(sfxModule.modulation({ fm: { ratio: 2, index: 0, to: 2 } }).fm).toEqual({ ratio: 2, index: 0, to: 2 });
    });
});

describe("vibrato, tremolo, FM and detune, as the audio graph gets them", () => {
    type Node = {
        id: string;
        kind: string;
        into: unknown[];
        started: number[];
        stopped: number[];
        [key: string]: unknown;
    };

    /** A graph that remembers what was connected to what, and what each parameter was set to. */
    function graph() {
        const nodes: Node[] = [];
        const param = (name: string) => {
            const self: any = {
                name,
                value: 0,
                sets: [] as Array<[number, number]>,
                ramps: [] as Array<[number, number]>,
            };
            self.setValueAtTime = (value: number, time: number) => self.sets.push([value, time]);
            self.exponentialRampToValueAtTime = (value: number, time: number) => self.ramps.push([value, time]);
            self.linearRampToValueAtTime = self.exponentialRampToValueAtTime;

            return self;
        };
        const make = (kind: string, extra: Record<string, unknown> = {}) => {
            const node: any = {
                id: `${kind}${nodes.length}`,
                kind,
                into: [],
                started: [],
                stopped: [],
                ...extra,
                connect(target: unknown) {
                    node.into.push(target);
                    return target;
                },
                start: (time: number) => node.started.push(time),
                stop: (time: number) => node.stopped.push(time),
            };
            nodes.push(node);

            return node;
        };

        class Context {
            state = "running";
            currentTime = 0;
            sampleRate = 100;
            destination = {};
            resume() {
                return Promise.resolve();
            }
            createGain = () => make("gain", { gain: param("gain") });
            createBuffer = () => ({ getChannelData: () => new Float32Array(100) });
            createOscillator = () => make("osc", { frequency: param("frequency"), detune: param("detune"), type: "" });
            createBufferSource = () => make("noise", { buffer: null });
        }

        const play = (
            voice: Record<string, unknown>,
            base: Record<string, unknown> = { voice: "tone", from: 400, to: 200 },
        ) => {
            const sfx = sfxModule.createSfx({
                key: "k",
                scores: { v: () => [{ length: 1, gain: 0.5, ...base, ...voice }] },
                AudioContextClass: Context,
                storage: memory(),
                isMuted: () => false,
            });
            sfx.wake();
            // The output's gain node is made on wake; the voices' come with the play.
            nodes.length = 0;

            return sfx.play("v");
        };

        return { nodes, play };
    }

    const oscillators = (nodes: Node[]) => nodes.filter((node) => node.kind === "osc");

    it("adds nothing for a plain voice", () => {
        const { nodes, play } = graph();
        play({});

        expect(oscillators(nodes)).toHaveLength(1);
        expect(nodes.filter((node) => node.kind === "gain")).toHaveLength(1);
    });

    it("sets a static detune on the voice's oscillator", () => {
        const { nodes, play } = graph();
        play({ detune: -12 });

        expect(oscillators(nodes)[0]!.detune).toMatchObject({ value: -12 });
        expect(oscillators(nodes)).toHaveLength(1);
    });

    it("drives the detune from an oscillator for a vibrato, depth in cents, and stops it with the voice", () => {
        const { nodes, play } = graph();
        play({ vibrato: { rate: 6, depth: 40 } });

        const [voice, lfo] = oscillators(nodes) as any[];
        expect(lfo.frequency.value).toBe(6);
        const reach = lfo.into[0] as Node & { gain: { value: number } };
        expect(reach.gain.value).toBe(40);
        expect(reach.into).toContain(voice.detune);
        expect(lfo.started).toEqual([0]);
        expect(lfo.stopped[0]).toBeCloseTo(1.02);
    });

    it("swings the gain between 1 - depth and 1 for a tremolo, so it is never louder than the voice", () => {
        const { nodes, play } = graph();
        play({ tremolo: { rate: 8, depth: 0.6 } });

        const lfo = oscillators(nodes)[1] as any;
        const reach = lfo.into[0] as any;
        const swing = nodes.find((node) => node.kind === "gain" && (node.gain as any).value === 0.7) as any;
        expect(reach.gain.value).toBeCloseTo(0.3);
        expect(reach.into).toContain(swing.gain);
        expect(swing.gain.value + reach.gain.value).toBeCloseTo(1);
        expect(lfo.frequency.value).toBe(8);
        expect(lfo.stopped[0]).toBeCloseTo(1.02);
    });

    it("applies a tremolo to noise too", () => {
        const { nodes, play } = graph();
        play({ tremolo: { rate: 10, depth: 1 } }, { voice: "hiss" });

        const noise = nodes.find((node) => node.kind === "noise") as any;
        const swing = noise.into[0] as any;
        expect(swing.gain.value).toBe(0.5);
        expect(oscillators(nodes)).toHaveLength(1);
    });

    it("modulates the frequency with a sine at a multiple of the pitch, scaled by the index, following a slide", () => {
        const { nodes, play } = graph();
        play({ fm: { ratio: 2, index: 3, to: 0 } });

        const [voice, modulator] = oscillators(nodes) as any[];
        const swing = modulator.into[0] as any;
        expect(modulator.frequency.sets[0]).toEqual([800, 0]);
        expect(modulator.frequency.ramps[0]).toEqual([400, 1]);
        expect(swing.gain.sets[0]).toEqual([3 * 400 * 2, 0]);
        expect(swing.gain.ramps[0]![0]).toBe(0.0001);
        expect(swing.into).toContain(voice.frequency);
        expect(modulator.stopped[0]).toBeCloseTo(1.02);
    });

    it("plays on with a score whose modulation is nonsense", () => {
        const { nodes, play } = graph();

        expect(play({ vibrato: { rate: "fast" }, tremolo: 3, fm: { ratio: 0 }, detune: Number.NaN })).toBe(true);
        expect(oscillators(nodes)).toHaveLength(1);
    });
});

describe("renderScore", () => {
    /** An OfflineAudioContext that records how it was made and what was built on it. */
    function offline() {
        const made = {
            constructed: [] as number[][],
            oscillators: 0,
            noises: 0,
            started: 0,
            startRendering: 0,
            gains: [] as Array<{ gain: { value: number } }>,
            buffers: [] as Float32Array[],
        };
        const rendered = { sentinel: "rendered buffer" };
        const param = () => ({
            value: 0,
            setValueAtTime() {},
            exponentialRampToValueAtTime() {},
            linearRampToValueAtTime() {},
        });
        const node = () => ({
            connect: (next: any) => next,
            gain: param(),
            frequency: param(),
            detune: param(),
            type: "",
        });

        class Offline {
            currentTime = 0;
            destination = {};
            sampleRate: number;
            constructor(channels: number, length: number, sampleRate: number) {
                this.sampleRate = sampleRate;
                made.constructed.push([channels, length, sampleRate]);
            }
            createGain() {
                const gain = node();
                made.gains.push(gain);

                return gain;
            }
            createBuffer = (_channels: number, length: number) => {
                const data = new Float32Array(length);
                made.buffers.push(data);

                return { getChannelData: () => data };
            };
            createOscillator() {
                made.oscillators++;

                return { ...node(), start: () => made.started++, stop() {} };
            }
            createBufferSource() {
                made.noises++;

                return { ...node(), buffer: null, start: () => made.started++, stop() {} };
            }
            startRendering() {
                made.startRendering++;

                return Promise.resolve(rendered);
            }
        }

        return { Offline, made, rendered };
    }

    const render = (score: unknown, options: Record<string, unknown> = {}) => {
        const rig = offline();

        return sfxModule
            .renderScore(score, { OfflineAudioContextClass: rig.Offline, ...options })
            .then((buffer: unknown) => ({ buffer, ...rig }));
    };

    const ping = [{ voice: "tone", from: 440, length: 0.5, gain: 0.3 }];

    it("renders the score's voices on an offline context and gives back what it rendered", async () => {
        const { buffer, rendered, made } = await render([...ping, { voice: "hiss", at: 0.1, length: 0.2, gain: 0.2 }]);

        expect(buffer).toBe(rendered);
        expect(made.startRendering).toBe(1);
        expect(made.oscillators).toBe(1);
        expect(made.noises).toBe(1);
        expect(made.started).toBe(2);
    });

    it("makes a mono context as long as the last voice plus its tail, at the sample rate asked for", async () => {
        const { made } = await render([{ voice: "tone", from: 440, at: 0.5, length: 1, gain: 0.3 }], {
            sampleRate: 8000,
            tail: 0.5,
        });

        // 0.5 + 1 + 0.02 (a source stops a little after its length) + 0.5 tail, at 8 kHz.
        expect(made.constructed).toEqual([[1, Math.ceil(2.02 * 8000), 8000]]);
        const defaults = await render(ping);
        expect(defaults.made.constructed[0]![0]).toBe(1);
        expect(defaults.made.constructed[0]![2]).toBe(44100);
        expect(defaults.made.constructed[0]![1]).toBe(Math.ceil((0.5 + 0.02 + 0.15) * 44100));
    });

    it("never renders longer than the limit, whatever a score asks for", async () => {
        const { made } = await render([{ voice: "tone", from: 440, length: 1e9, gain: 0.3 }], { sampleRate: 1000 });

        expect(made.constructed[0]![1]).toBe(sfxModule.MAX_RENDER_SECONDS * 1000);
    });

    it("gives the same noise for the same random function, and another for another", async () => {
        const seeded = (seed: number) => {
            let state = seed;

            return () => (state = (state * 16807) % 2147483647) / 2147483647;
        };
        const hiss = [{ voice: "hiss", length: 0.1, gain: 0.2 }];
        const first = await render(hiss, { sampleRate: 200, random: seeded(5) });
        const again = await render(hiss, { sampleRate: 200, random: seeded(5) });
        const other = await render(hiss, { sampleRate: 200, random: seeded(6) });

        expect(Array.from(first.made.buffers[0]!)).toEqual(Array.from(again.made.buffers[0]!));
        expect(Array.from(first.made.buffers[0]!)).not.toEqual(Array.from(other.made.buffers[0]!));
        expect(Math.max(...first.made.buffers[0]!)).toBeLessThanOrEqual(1);
        expect(Math.min(...first.made.buffers[0]!)).toBeGreaterThanOrEqual(-1);
    });

    it("resolves undefined, and does not reject, for an empty score, no score, no OfflineAudioContext or a failed render", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect((await render([])).buffer).toBeUndefined();
        expect((await render(undefined)).buffer).toBeUndefined();
        expect(await sfxModule.renderScore(ping, { OfflineAudioContextClass: undefined })).toBeUndefined();

        class Broken {
            createGain() {
                throw new Error("no audio");
            }
        }
        expect(await sfxModule.renderScore(ping, { OfflineAudioContextClass: Broken })).toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("puts the master level first, as play does, so a file is as loud as what was heard", async () => {
        expect((await render(ping)).made.gains[0]!.gain.value).toBe(0.55);
        expect((await render(ping, { level: 0.3 })).made.gains[0]!.gain.value).toBe(0.3);
    });

    it("renders the same voices play makes, through the same limiter, and plays on afterwards", async () => {
        // Nothing the live engine does depends on a render having happened.
        const { sfx, made } = make();
        sfx.wake();
        await render(ping);

        expect(sfx.play("ping")).toBe(true);
        expect(made.oscillators).toBe(1);
    });
});

describe("softClipCurve", () => {
    const curve = (...args: number[]): Float32Array => sfxModule.softClipCurve(...args);
    /** The curve's value for an input `x` from -1 to 1. */
    const at = (table: Float32Array, x: number) => table[Math.round(((x + 1) / 2) * (table.length - 1))]!;

    it("passes what is under CLIP_FROM through as it is, in both directions", () => {
        const table = curve();

        for (const x of [-0.6, -0.5, -0.3, -0.1, 0, 0.05, 0.2, 0.4, 0.6]) {
            expect(at(table, x)).toBeCloseTo(x, 2);
        }
        expect(sfxModule.CLIP_FROM).toBe(0.6);
    });

    it("rounds off what is above it, short of 1, and never turns a louder input into a quieter output", () => {
        const table = curve();

        expect(at(table, 1)).toBeLessThan(1);
        expect(at(table, 1)).toBeGreaterThan(sfxModule.CLIP_FROM);
        expect(at(table, 0.8)).toBeLessThan(0.8);
        for (let index = 1; index < table.length; index++)
            expect(table[index]!).toBeGreaterThanOrEqual(table[index - 1]!);
        expect(Math.max(...table.map(Math.abs))).toBeLessThan(1);
    });

    it("is the same on both sides of zero, with 0 at the middle", () => {
        const table = curve();

        for (let index = 0; index < table.length; index++)
            expect(table[index]).toBeCloseTo(-table[table.length - 1 - index]!, 6);
        expect(table[(table.length - 1) / 2]).toBe(0);
    });

    it("takes its own start and size", () => {
        const table = curve(0.3, 101);

        expect(table).toHaveLength(101);
        expect(at(table, 0.2)).toBeCloseTo(0.2, 2);
        expect(at(table, 0.5)).toBeLessThan(0.5);
    });
});
