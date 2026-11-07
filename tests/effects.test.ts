import { beforeAll, describe, expect, it } from "vitest";

let sfx: any;

beforeAll(async () => {
    sfx = await import("../src/sfx.js");
});

describe("modulation: filter resonance, drive and echo", () => {
    it("holds the resonance to 0.1..15 and ignores anything that is not a number", () => {
        expect(sfx.modulation({ filter: { type: "lowpass", from: 500, q: 8 } }).q).toBe(8);
        expect(sfx.modulation({ filter: { type: "lowpass", from: 500, q: 900 } }).q).toBe(15);
        expect(sfx.modulation({ filter: { type: "lowpass", from: 500, q: -3 } }).q).toBe(0.1);
        expect(sfx.modulation({ filter: { type: "lowpass", from: 500 } }).q).toBeUndefined();
        expect(sfx.modulation({ filter: { type: "lowpass", from: 500, q: "loud" } }).q).toBeUndefined();
        expect(sfx.modulation({ filter: null }).q).toBeUndefined();
        expect(sfx.modulation({}).q).toBeUndefined();
    });

    it("holds drive to 0..1 and drops none, a non-number or nonsense", () => {
        expect(sfx.modulation({ drive: 0.4 }).drive).toBe(0.4);
        expect(sfx.modulation({ drive: 7 }).drive).toBe(1);
        expect(sfx.modulation({ drive: 0 }).drive).toBeUndefined();
        expect(sfx.modulation({ drive: -1 }).drive).toBeUndefined();
        expect(sfx.modulation({ drive: Number.NaN }).drive).toBeUndefined();
        expect(sfx.modulation({ drive: "hard" }).drive).toBeUndefined();
    });

    it("fills in an echo's feedback and mix, and holds each to its range", () => {
        expect(sfx.modulation({ echo: { time: 0.1 } }).echo).toEqual({ time: 0.1, feedback: 0.4, mix: 0.5 });
        expect(sfx.modulation({ echo: { time: 9, feedback: 5, mix: 5 } }).echo).toEqual({
            time: 0.5,
            feedback: 0.85,
            mix: 1,
        });
        expect(sfx.modulation({ echo: { time: 0.0001, feedback: -1, mix: 0.3 } }).echo).toEqual({
            time: 0.02,
            feedback: 0,
            mix: 0.3,
        });
    });

    it("drops an echo with no time, no mix or nothing like a spec", () => {
        expect(sfx.modulation({ echo: {} }).echo).toBeUndefined();
        expect(sfx.modulation({ echo: { time: "soon" } }).echo).toBeUndefined();
        expect(sfx.modulation({ echo: { time: 0.1, mix: 0 } }).echo).toBeUndefined();
        expect(sfx.modulation({ echo: null }).echo).toBeUndefined();
        expect(sfx.modulation({ echo: 3 }).echo).toBeUndefined();
    });

    it("leaves a voice with none of the new fields exactly as before", () => {
        const plain = sfx.modulation({ detune: 10 });

        expect(plain.q).toBeUndefined();
        expect(plain.drive).toBeUndefined();
        expect(plain.echo).toBeUndefined();
    });
});

describe("echoTaps", () => {
    const echo = (time: number, feedback: number, mix: number) => ({ time, feedback, mix });

    it("makes repeats one `time` apart, each `feedback` times the one before, the first at `mix`", () => {
        const taps = sfx.echoTaps(echo(0.1, 0.5, 0.8));

        expect(taps.slice(0, 3).map((tap: any) => tap.delay)).toEqual([0.1, 0.2, 0.30000000000000004]);
        expect(taps[0].gain).toBeCloseTo(0.8);
        expect(taps[1].gain).toBeCloseTo(0.4);
        expect(taps[2].gain).toBeCloseTo(0.2);
    });

    it("stops when a repeat would be under 2% of the voice", () => {
        const taps = sfx.echoTaps(echo(0.05, 0.5, 0.5));

        expect(taps.length).toBe(5); // 0.5, 0.25, 0.125, 0.0625, 0.03125, then 0.0156 is too quiet
        expect(taps.every((tap: any) => tap.gain >= 0.02)).toBe(true);
    });

    it("makes at most 8 repeats and reaches at most 2 seconds, whatever the score says", () => {
        expect(sfx.echoTaps(echo(0.02, 0.85, 1)).length).toBe(8);
        const long = sfx.echoTaps(echo(0.5, 0.85, 1));
        expect(long.length).toBe(4);
        expect(long.at(-1).delay).toBeLessThanOrEqual(2);
    });

    it("makes one repeat when feedback is 0, and none for no echo", () => {
        expect(sfx.echoTaps(echo(0.2, 0, 0.6)).length).toBe(1);
        expect(sfx.echoTaps(undefined)).toEqual([]);
        expect(sfx.echoTaps(echo(0.2, 0.5, 0.01))).toEqual([]);
    });
});

describe("endOf", () => {
    it("is the start plus the length for a voice with no echo", () => {
        expect(sfx.endOf({ at: 0.5, length: 1 })).toBe(1.5);
        expect(sfx.endOf({ length: 0.2 })).toBe(0.2);
    });

    it("adds the time to the last repeat", () => {
        expect(sfx.endOf({ at: 1, length: 0.5, echo: { time: 0.25, feedback: 0.4, mix: 0.5 } })).toBeCloseTo(
            1.5 + 0.25 * sfx.echoTaps({ time: 0.25, feedback: 0.4, mix: 0.5 }).length,
        );
    });

    it("ignores an echo the engine would drop", () => {
        expect(sfx.endOf({ length: 0.2, echo: { time: 0.1, mix: 0 } })).toBe(0.2);
        expect(sfx.endOf({ length: 0.2, echo: "x" })).toBe(0.2);
    });
});

describe("driveCurve", () => {
    it("keeps full scale at full scale, is odd, and passes through zero", () => {
        for (const amount of [0, 0.3, 1]) {
            const curve = sfx.driveCurve(amount);
            expect(curve.length).toBe(2049);
            expect(curve[0]).toBeCloseTo(-1, 5);
            expect(curve[2048]).toBeCloseTo(1, 5);
            expect(curve[1024]).toBeCloseTo(0, 6);
            expect(curve[1024 + 300]).toBeCloseTo(-curve[1024 - 300], 6);
        }
    });

    it("bends more as the amount rises: a quiet input comes out louder", () => {
        const at = (amount: number) => sfx.driveCurve(amount)[1024 + 200]; // an input of about 0.2
        expect(at(0.2)).toBeGreaterThan(at(0));
        expect(at(1)).toBeGreaterThan(at(0.5));
        expect(at(1)).toBeLessThanOrEqual(1);
    });

    it("never rises backwards", () => {
        const curve = sfx.driveCurve(1);
        for (let index = 1; index < curve.length; index++)
            expect(curve[index]).toBeGreaterThanOrEqual(curve[index - 1]);
    });

    it("treats a missing or odd amount as none", () => {
        expect(Array.from(sfx.driveCurve(Number.NaN))).toEqual(Array.from(sfx.driveCurve(0)));
        expect(Array.from(sfx.driveCurve(undefined))).toEqual(Array.from(sfx.driveCurve(0)));
    });
});

describe("the audio graph", () => {
    /** An OfflineAudioContext that records every node and what it is connected to. */
    function rig() {
        const nodes: any[] = [];
        const constructed: number[][] = [];
        const param = (value = 0) => ({
            value,
            setValueAtTime() {},
            exponentialRampToValueAtTime() {},
            linearRampToValueAtTime() {},
        });
        const make = (kind: string, extra: object = {}) => {
            const node: any = {
                kind,
                to: [] as any[],
                connect(next: any) {
                    node.to.push(next);

                    return next;
                },
                gain: param(1),
                frequency: param(),
                detune: param(),
                Q: param(Number.NaN),
                delayTime: param(),
                type: "",
                ...extra,
            };
            nodes.push(node);

            return node;
        };

        class Offline {
            currentTime = 0;
            sampleRate: number;
            destination = make("destination");
            constructor(channels: number, length: number, sampleRate: number) {
                this.sampleRate = sampleRate;
                constructed.push([channels, length, sampleRate]);
            }
            createGain = () => make("gain");
            createOscillator = () => make("osc", { start() {}, stop() {} });
            createBufferSource = () => make("noise", { start() {}, stop() {} });
            createBiquadFilter = () => make("filter");
            createWaveShaper = () => make("shaper");
            createDelay = (max: number) => make("delay", { max });
            createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
            startRendering = () => Promise.resolve({});
        }

        const kinds = (kind: string) => nodes.filter((node) => node.kind === kind);

        return { Offline, nodes, constructed, kinds };
    }

    const render = async (score: unknown[], options: object = {}) => {
        const graph = rig();
        await sfx.renderScore(score, { OfflineAudioContextClass: graph.Offline, ...options });

        return graph;
    };

    it("sets a low pass's resonance in decibels, from the linear Q a score gives", async () => {
        const { kinds } = await render([
            { voice: "hiss", length: 0.2, gain: 0.2, filter: { type: "lowpass", from: 800, q: 10 } },
        ]);

        expect(kinds("filter")[0].Q.value).toBeCloseTo(20, 5); // 20 log10(10)
    });

    it("sets a band pass's resonance as given", async () => {
        const { kinds } = await render([
            { voice: "hiss", length: 0.2, gain: 0.2, filter: { type: "bandpass", from: 800, q: 6 } },
        ]);

        expect(kinds("filter")[0].Q.value).toBe(6);
    });

    it("leaves the browser's own resonance alone when the score gives none", async () => {
        const { kinds } = await render([
            { voice: "hiss", length: 0.2, gain: 0.2, filter: { type: "lowpass", from: 800 } },
        ]);

        expect(Number.isNaN(kinds("filter")[0].Q.value)).toBe(true);
    });

    it("puts a shaper with the drive curve between the source and its envelope", async () => {
        const { kinds } = await render([{ voice: "tone", from: 220, length: 0.2, gain: 0.3, drive: 0.7 }]);
        const [limiter, shaper] = kinds("shaper");
        const osc = kinds("osc")[0];

        expect(kinds("shaper").length).toBe(2); // the limiter, then this voice's
        expect(limiter).toBeDefined();
        expect(osc.to[0]).toBe(shaper);
        expect(Array.from(shaper.curve)).toEqual(Array.from(sfx.driveCurve(0.7)));
        expect(shaper.to[0].kind).toBe("gain");
    });

    it("adds no shaper, no delay and no extra nodes to a voice with none of the new fields", async () => {
        const { kinds, nodes } = await render([
            { voice: "tone", from: 220, length: 0.2, gain: 0.3, filter: { type: "lowpass", from: 900 } },
        ]);

        expect(kinds("shaper").length).toBe(1); // only the limiter
        expect(kinds("delay").length).toBe(0);
        expect(nodes.length).toBe(
            // destination, master gain, limiter, oscillator, filter, envelope
            6,
        );
    });

    it("makes one delay per repeat, each its own distance and level, ending at the master out", async () => {
        const echo = { time: 0.1, feedback: 0.5, mix: 0.8 };
        const { kinds } = await render([{ voice: "tone", from: 220, length: 0.2, gain: 0.3, echo }]);
        const taps = sfx.echoTaps(sfx.modulation({ echo }).echo);
        const delays = kinds("delay");

        expect(delays.length).toBe(taps.length);
        delays.forEach((delay: any, index: number) => {
            expect(delay.delayTime.value).toBeCloseTo(taps[index].delay);
            expect(delay.max).toBeGreaterThanOrEqual(taps[index].delay);
            const fade = delay.to[0];
            expect(fade.kind).toBe("gain");
            expect(fade.gain.value).toBeCloseTo(taps[index].gain);
            expect(fade.to[0].kind).toBe("gain"); // the master level
        });
    });

    it("feeds every repeat from the voice's envelope, after the effects, so an echo is a copy of what was heard", async () => {
        const { kinds } = await render([
            { voice: "tone", from: 220, length: 0.2, gain: 0.3, drive: 0.5, echo: { time: 0.1, mix: 0.5 } },
        ]);
        const envelope = kinds("osc")[0].to[0].to[0]; // source -> shaper -> envelope

        expect(kinds("delay").every((delay: any) => envelope.to.includes(delay))).toBe(true);
    });

    it("works for a noise voice too", async () => {
        const { kinds } = await render([
            { voice: "hiss", length: 0.2, gain: 0.2, drive: 0.4, echo: { time: 0.05, feedback: 0.3, mix: 0.4 } },
        ]);

        expect(kinds("noise")[0].to[0].kind).toBe("shaper");
        expect(kinds("delay").length).toBeGreaterThan(0);
    });

    it("plays on, without echo or drive, in a browser that has no delay or shaper node", async () => {
        const graph = rig();
        class Bare extends graph.Offline {
            createDelay = undefined as unknown as (max: number) => any;
            createWaveShaper = undefined as unknown as () => any;
        }
        const buffer = await sfx.renderScore(
            [{ voice: "tone", from: 220, length: 0.2, gain: 0.3, drive: 1, echo: { time: 0.1 } }],
            { OfflineAudioContextClass: Bare },
        );

        expect(buffer).toEqual({});
    });

    it("renders long enough to hear the last repeat", async () => {
        const echo = { time: 0.25, feedback: 0.5, mix: 0.5 };
        const { constructed } = await render([{ voice: "tone", from: 220, length: 0.2, gain: 0.3, echo }], {
            sampleRate: 100,
            tail: 0,
        });
        const taps = sfx.echoTaps(sfx.modulation({ echo }).echo);
        const seconds = 0.2 + taps.at(-1).delay + 0.02;

        expect(constructed[0][1]).toBe(Math.ceil(seconds * 100));
        expect(constructed[0][1]).toBeGreaterThan(Math.ceil(0.22 * 100));
    });

    it("still bounds a render to MAX_RENDER_SECONDS", async () => {
        const { constructed } = await render(
            [{ voice: "tone", from: 220, at: 29.9, length: 4, gain: 0.3, echo: { time: 0.5, mix: 1, feedback: 0.85 } }],
            { sampleRate: 10, tail: 5 },
        );

        expect(constructed[0][1]).toBe(sfx.MAX_RENDER_SECONDS * 10);
    });
});
