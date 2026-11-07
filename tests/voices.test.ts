import { beforeAll, describe, expect, it } from "vitest";
import { rig } from "./rig";

let sfx: any;

beforeAll(async () => {
    sfx = await import("../src/sfx.js");
});

const render = async (score: unknown[], options: Record<string, unknown> = {}, rigOptions = {}) => {
    const graph = rig(rigOptions);
    await sfx.renderScore(score, { OfflineAudioContextClass: graph.Offline, ...options });

    return graph;
};
const tone = { voice: "tone", from: 440, length: 0.2, gain: 0.3 };
const hiss = { voice: "hiss", length: 0.2, gain: 0.2 };

describe("modulation: the new fields", () => {
    it("holds reverb to 0.1..3 seconds and a mix of 0..1, default 0.35, and drops one that does nothing", () => {
        expect(sfx.modulation({ reverb: { time: 1 } }).reverb).toEqual({ time: 1, mix: 0.35 });
        expect(sfx.modulation({ reverb: { time: 99, mix: 9 } }).reverb).toEqual({ time: 3, mix: 1 });
        expect(sfx.modulation({ reverb: { time: 0.001, mix: 0.2 } }).reverb).toEqual({ time: 0.1, mix: 0.2 });
        expect(sfx.modulation({ reverb: { time: 1, mix: 0 } }).reverb).toBeUndefined();
        expect(sfx.modulation({ reverb: {} }).reverb).toBeUndefined();
        expect(sfx.modulation({ reverb: "big" }).reverb).toBeUndefined();
    });

    it("holds pan to -1..1 and drops the middle and anything that is not a number", () => {
        expect(sfx.modulation({ pan: 0.4 }).pan).toBe(0.4);
        expect(sfx.modulation({ pan: -7 }).pan).toBe(-1);
        expect(sfx.modulation({ pan: 0 }).pan).toBeUndefined();
        expect(sfx.modulation({ pan: "left" }).pan).toBeUndefined();
        expect(sfx.modulation({ pan: Number.NaN }).pan).toBeUndefined();
    });

    it("keeps a pulse width inside 0.05..0.95 and calls 0.5 the ordinary square", () => {
        expect(sfx.modulation({ pulse: 0.2 }).pulse).toBe(0.2);
        expect(sfx.modulation({ pulse: 0 }).pulse).toBe(0.05);
        expect(sfx.modulation({ pulse: 7 }).pulse).toBe(0.95);
        expect(sfx.modulation({ pulse: 0.5 }).pulse).toBeUndefined();
        expect(sfx.modulation({ pulse: "thin" }).pulse).toBeUndefined();
    });

    it("knows only the linear slide, and only the pink and brown noise", () => {
        expect(sfx.modulation({ slide: "linear" }).slide).toBe("linear");
        expect(sfx.modulation({ slide: "exp" }).slide).toBeUndefined();
        expect(sfx.modulation({ slide: "wobbly" }).slide).toBeUndefined();
        expect(sfx.modulation({ noise: "pink" }).noise).toBe("pink");
        expect(sfx.modulation({ noise: "brown" }).noise).toBe("brown");
        expect(sfx.modulation({ noise: "white" }).noise).toBeUndefined();
        expect(sfx.modulation({ noise: "blue" }).noise).toBeUndefined();
    });

    it("holds harmonics to 32 levels of 0..1, zeroes what is not a number and drops a wave with no sound in it", () => {
        expect(sfx.modulation({ harmonics: [1, 0.5, 0.25] }).harmonics).toEqual([1, 0.5, 0.25]);
        expect(sfx.modulation({ harmonics: [9, -2, "x", Number.NaN] }).harmonics).toEqual([1, 0, 0, 0]);
        expect(sfx.modulation({ harmonics: new Array(80).fill(0.1) }).harmonics?.length).toBe(32);
        expect(sfx.modulation({ harmonics: [0, 0] }).harmonics).toBeUndefined();
        expect(sfx.modulation({ harmonics: [] }).harmonics).toBeUndefined();
        expect(sfx.modulation({ harmonics: "all" }).harmonics).toBeUndefined();
    });

    it("keeps modulations in range, one per target, at most four, and fills in an lfo's rate and shape", () => {
        const mods = sfx.modulation({
            mod: [
                { source: "lfo", to: "pitch", amount: 99999 },
                { source: "rise", to: "pitch", amount: 5 }, // a second for pitch: dropped
                { source: "fall", to: "cutoff", amount: -50 },
                { source: "lfo", to: "volume", amount: 0.4, rate: 999, shape: "triangle" },
                { source: "rise", to: "fm", amount: 3 },
                { source: "rise", to: "volume", amount: 1 }, // a fifth: dropped
            ],
        }).mods;

        expect(mods).toEqual([
            { source: "lfo", to: "pitch", amount: 2400, rate: 5, shape: "sine" },
            { source: "fall", to: "cutoff", amount: -6 },
            { source: "lfo", to: "volume", amount: 0.4, rate: 40, shape: "triangle" },
            { source: "rise", to: "fm", amount: 3 },
        ]);
    });

    it("drops a modulation that is unknown, has no amount or does nothing", () => {
        const bad = [
            null,
            3,
            { source: "noise", to: "pitch", amount: 1 },
            { source: "lfo", to: "pan", amount: 1 },
            { source: "lfo", to: "pitch" },
            { source: "lfo", to: "pitch", amount: "lots" },
            { source: "lfo", to: "pitch", amount: 0 },
        ];

        expect(sfx.modulation({ mod: bad }).mods).toBeUndefined();
        expect(sfx.modulation({ mod: "all" }).mods).toBeUndefined();
        expect(sfx.modulation({ mod: [] }).mods).toBeUndefined();
    });

    it("leaves a voice with none of the fields with none of them", () => {
        const none = sfx.modulation({ detune: 5 });
        for (const key of ["reverb", "pan", "mods", "harmonics", "pulse", "slide", "noise"]) {
            expect(none[key], key).toBeUndefined();
        }
    });
});

describe("harmonicWave and pulseWave", () => {
    it("puts each level on its own sine, with no DC", () => {
        const { real, imag } = sfx.harmonicWave([1, 0.5]);

        expect(Array.from(real)).toEqual([0, 0, 0]);
        expect(Array.from(imag)).toEqual([0, 1, 0.5]);
    });

    it("makes a pulse of width 0.5 (a square wave) from odd harmonics only, falling as 1/n", () => {
        const { real, imag } = sfx.pulseWave(0.5, 9);

        for (const n of [2, 4, 6, 8]) expect(Math.hypot(real[n], imag[n])).toBeCloseTo(0, 5);
        const level = (n: number) => Math.hypot(real[n], imag[n]);
        expect(level(3) / level(1)).toBeCloseTo(1 / 3, 5);
        expect(level(5) / level(1)).toBeCloseTo(1 / 5, 5);
    });

    it("makes a thin pulse brighter than a square: it has even harmonics too", () => {
        const { real, imag } = sfx.pulseWave(0.2, 9);

        expect(Math.hypot(real[2], imag[2])).toBeGreaterThan(0.1);
    });

    it("sums to the rectangle it describes", () => {
        const duty = 0.25;
        const { real, imag } = sfx.pulseWave(duty, 400);
        const at = (theta: number) => {
            let sum = 0;
            for (let n = 1; n < real.length; n++) sum += real[n] * Math.cos(n * theta) + imag[n] * Math.sin(n * theta);

            return sum;
        };

        // The rectangle is +1 for the first quarter of a cycle and -1 after, with its mean (2 duty - 1) removed.
        const mean = 2 * duty - 1;
        expect(at(Math.PI * 0.25)).toBeCloseTo(1 - mean, 1);
        expect(at(Math.PI * 1.2)).toBeCloseTo(-1 - mean, 1);
    });
});

describe("tintedNoise", () => {
    const white = Float32Array.from(
        { length: 4000 },
        (_, i) => Math.sin(i * 12.9898) * 43758.5453 - Math.floor(Math.sin(i * 12.9898) * 43758.5453) - 0.5,
    );
    const spread = (samples: Float32Array) => {
        // Energy in the fast changes against energy in the signal: low for a deep colour.
        let change = 0;
        let level = 0;
        for (let i = 1; i < samples.length; i++) {
            change += (samples[i] - samples[i - 1]) ** 2;
            level += samples[i] ** 2;
        }

        return change / level;
    };

    it("gives white noise back for white or anything else", () => {
        expect(sfx.tintedNoise(white, "white")).toBe(white);
        expect(sfx.tintedNoise(white, "blue")).toBe(white);
        expect(sfx.tintedNoise(white, undefined)).toBe(white);
    });

    it("makes pink and brown as loud as the white noise they came from, with no peak past 1.5", () => {
        const level = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
        for (const colour of ["pink", "brown"]) {
            const out = sfx.tintedNoise(white, colour);
            expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(1.5 + 1e-6);
            expect(out.length).toBe(white.length);
            // the same average level, or a little under where the peak ceiling held it back
            expect(level(out)).toBeLessThanOrEqual(level(white) * 1.0001);
            expect(level(out)).toBeGreaterThan(level(white) * 0.2);
        }
        expect(level(sfx.tintedNoise(white, "pink"))).toBeCloseTo(level(white), 3);
    });

    it("is deeper the browner it is: less of its energy changes fast", () => {
        const pink = spread(sfx.tintedNoise(white, "pink"));
        const brown = spread(sfx.tintedNoise(white, "brown"));

        expect(spread(white)).toBeGreaterThan(pink);
        expect(pink).toBeGreaterThan(brown);
    });

    it("does not change the white noise it was given", () => {
        const copy = Float32Array.from(white);
        sfx.tintedNoise(white, "pink");
        sfx.tintedNoise(white, "brown");

        expect(Array.from(white)).toEqual(Array.from(copy));
    });

    it("copes with silence", () => {
        const out = sfx.tintedNoise(new Float32Array(10), "brown");

        expect(Array.from(out)).toEqual(new Array(10).fill(0));
    });
});

describe("impulseResponse", () => {
    it("is as long as the room, and the same every time", () => {
        const first = sfx.impulseResponse(0.5, 1000);

        expect(first.length).toBe(500);
        expect(Array.from(sfx.impulseResponse(0.5, 1000))).toEqual(Array.from(first));
    });

    it("dies away: the end is far quieter than the start", () => {
        const response = sfx.impulseResponse(1, 4000);
        const energy = (from: number, to: number) =>
            response.slice(from, to).reduce((sum: number, x: number) => sum + x * x, 0);

        expect(energy(0, 400)).toBeGreaterThan(energy(3600, 4000) * 1000);
        expect(Math.max(...response.map(Math.abs))).toBeLessThanOrEqual(1);
    });

    it("has unit energy in its first 0.2 seconds, whatever the room's length", () => {
        for (const seconds of [0.1, 0.6, 3]) {
            const response = sfx.impulseResponse(seconds, 8000);
            const early = response
                .slice(0, Math.min(response.length, 1600))
                .reduce((sum: number, x: number) => sum + x * x, 0);

            expect(early, `${seconds}s`).toBeCloseTo(1, 4);
        }
    });

    it("is noise, with no DC drift", () => {
        const response = sfx.impulseResponse(1, 8000);
        const mean = response.reduce((sum: number, x: number) => sum + x, 0) / response.length;

        expect(Math.abs(mean)).toBeLessThan(0.01);
    });
});

describe("endOf with a reverb", () => {
    it("lasts as long as the room if that is longer than the echo", () => {
        expect(sfx.endOf({ length: 0.2, reverb: { time: 2 } })).toBeCloseTo(2.2);
        expect(sfx.endOf({ length: 0.2, reverb: { time: 0.1 }, echo: { time: 0.25, mix: 0.5 } })).toBeGreaterThan(0.4);
    });

    it("ignores a reverb the engine would drop", () => {
        expect(sfx.endOf({ length: 0.2, reverb: { time: 2, mix: 0 } })).toBe(0.2);
    });
});

describe("the audio graph: noise, waves and slides", () => {
    it("gives a hiss the colour's buffer, shared by the voices that use it, and white by default", async () => {
        const { kinds } = await render([
            { ...hiss, noise: "pink" },
            { ...hiss, noise: "pink" },
            { ...hiss, noise: "brown" },
            hiss,
        ]);
        const [a, b, c, d] = kinds("noise").map((node: any) => node.buffer);

        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(a).not.toBe(d);
        expect(c).not.toBe(d);
    });

    it("sets a custom wave on the oscillator in place of its type, built from the harmonics", async () => {
        const { kinds } = await render([{ ...tone, type: "sawtooth", harmonics: [1, 0.5, 0.25] }]);
        const osc = kinds("osc")[0];

        expect(osc.wave.kind).toBe("wave");
        expect(Array.from(osc.wave.imag)).toEqual([0, 1, 0.5, 0.25]);
        expect(osc.type).toBe("");
    });

    it("sets a pulse wave on a square voice, but not on another type", async () => {
        const square = await render([{ ...tone, type: "square", pulse: 0.25 }]);
        const saw = await render([{ ...tone, type: "sawtooth", pulse: 0.25 }]);

        expect(square.kinds("osc")[0].wave.kind).toBe("wave");
        expect(saw.kinds("osc")[0].wave).toBeUndefined();
        expect(saw.kinds("osc")[0].type).toBe("sawtooth");
    });

    it("keeps the plain type for a pulse of 0.5 and shares one wave between voices that use it", async () => {
        const plain = await render([{ ...tone, type: "square", pulse: 0.5 }]);
        const twice = await render([
            { ...tone, type: "square", pulse: 0.3 },
            { ...tone, type: "square", pulse: 0.3 },
        ]);
        const [first, second] = twice.kinds("osc");

        expect(plain.kinds("osc")[0].type).toBe("square");
        expect(first.wave).toBe(second.wave);
    });

    it("falls back to the type where the browser has no PeriodicWave", async () => {
        const { kinds } = await render(
            [{ ...tone, type: "square", harmonics: [1] }],
            {},
            { missing: ["createPeriodicWave"] },
        );

        expect(kinds("osc")[0].type).toBe("square");
    });

    it("slides in a straight line when asked, and on the curve otherwise", async () => {
        const straight = await render([{ ...tone, to: 880, slide: "linear" }]);
        const curved = await render([{ ...tone, to: 880 }]);
        const calls = (graph: any) => graph.kinds("osc")[0].frequency.calls.map((call: any) => call[0]);

        expect(calls(straight)).toEqual(["set", "linear"]);
        expect(calls(curved)).toEqual(["set", "exp"]);
    });
});

describe("the audio graph: pan and stereo", () => {
    it("puts a panner after a panned voice and sends the voice through it", async () => {
        const { kinds } = await render([{ ...tone, pan: -0.6 }]);
        const [panner] = kinds("panner");

        expect(panner.pan.value).toBe(-0.6);
        expect(panner.to[0].kind).toBe("gain"); // the master level
        expect(kinds("gain").some((node: any) => node.to.includes(panner))).toBe(true);
    });

    it("sends a panned voice's echoes and room through the same panner", async () => {
        const { kinds } = await render([{ ...tone, pan: 0.5, echo: { time: 0.1, mix: 0.5 }, reverb: { time: 0.3 } }]);
        const [panner] = kinds("panner");
        const feeders = kinds("gain").filter((node: any) => node.to.includes(panner));

        expect(kinds("panner").length).toBe(1);
        expect(feeders.length).toBeGreaterThan(2); // the voice, its repeats, its room
    });

    it("makes no panner for an unpanned voice or a browser without one", async () => {
        expect((await render([tone])).kinds("panner").length).toBe(0);
        expect(
            (await render([{ ...tone, pan: 1 }], {}, { missing: ["createStereoPanner"] })).kinds("panner").length,
        ).toBe(0);
    });

    it("renders in one channel unless two are asked for", async () => {
        expect((await render([tone])).constructed[0][0]).toBe(1);
        expect((await render([tone], { channels: 2 })).constructed[0][0]).toBe(2);
        expect((await render([tone], { channels: 7 })).constructed[0][0]).toBe(1);
        expect((await render([tone], { channels: "2" })).constructed[0][0]).toBe(1);
    });
});

describe("the audio graph: reverb", () => {
    it("feeds a convolver with a room from the voice's envelope and mixes it back at the voice's mix", async () => {
        const { kinds } = await render([{ ...tone, reverb: { time: 0.5, mix: 0.4 } }], { sampleRate: 1000 });
        const [room] = kinds("convolver");
        const wet = room.to[0];

        expect(room.buffer.length).toBe(500);
        expect(wet.gain.value).toBeCloseTo(0.8); // the mix, times the lift of 2
        expect(room.normalize).toBe(false); // the room is scaled by the engine, not the browser
        expect(wet.to[0].kind).toBe("gain");
        expect(kinds("gain").some((node: any) => node.to.includes(room))).toBe(true);
    });

    it("shares a room between voices of the same length, and makes another for another length", async () => {
        const { kinds } = await render([
            { ...tone, reverb: { time: 0.5 } },
            { ...hiss, reverb: { time: 0.5 } },
            { ...tone, reverb: { time: 1 } },
        ]);
        const [a, b, c] = kinds("convolver").map((node: any) => node.buffer);

        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });

    it("makes no convolver without a reverb or where there is none to make", async () => {
        expect((await render([tone])).kinds("convolver").length).toBe(0);
        const bare = await render([{ ...tone, reverb: { time: 1 } }], {}, { missing: ["createConvolver"] });
        expect(bare.kinds("convolver").length).toBe(0);
    });

    it("renders long enough for the room's tail", async () => {
        const { constructed } = await render([{ ...tone, reverb: { time: 2 } }], { sampleRate: 100, tail: 0 });

        expect(constructed[0][1]).toBe(Math.ceil((0.2 + 2 + 0.02) * 100));
    });
});

describe("the audio graph: the modulation matrix", () => {
    const wired = (graph: any, kind: string) => graph.kinds(kind);

    it("drives an oscillator's detune from an lfo, in cents", async () => {
        const graph = await render([
            { ...tone, mod: [{ source: "lfo", to: "pitch", amount: 300, rate: 7, shape: "triangle" }] },
        ]);
        const [voice, lfo] = wired(graph, "osc");
        const reach = lfo.to[0];

        expect(lfo.type).toBe("triangle");
        expect(lfo.frequency.value).toBe(7);
        expect(reach.gain.value).toBe(300);
        expect(reach.to[0]).toBe(voice.detune);
    });

    it("moves a filter's cutoff by octaves, as the cents a filter takes", async () => {
        const graph = await render([
            { ...hiss, filter: { type: "lowpass", from: 800 }, mod: [{ source: "rise", to: "cutoff", amount: 2 }] },
        ]);
        const [filter] = wired(graph, "filter");
        const [control] = wired(graph, "constant");
        const reach = control.to[0];

        expect(reach.gain.value).toBe(2400);
        expect(reach.to[0]).toBe(filter.detune);
    });

    it("runs a rise from 0 to 1 and a fall from 1 to 0 over the voice's length", async () => {
        const rise = await render([{ ...tone, mod: [{ source: "rise", to: "pitch", amount: 100 }] }]);
        const fall = await render([{ ...tone, mod: [{ source: "fall", to: "pitch", amount: 100 }] }]);

        expect(wired(rise, "constant")[0].offset.calls).toEqual([
            ["set", 0, 0],
            ["linear", 1, 0.2],
        ]);
        expect(wired(fall, "constant")[0].offset.calls).toEqual([
            ["set", 1, 0],
            ["linear", 0, 0.2],
        ]);
    });

    it("scales a volume modulation so the voice is never louder than its own gain", async () => {
        const levels = async (amount: number, source: string) => {
            const graph = await render([{ ...tone, mod: [{ source, to: "volume", amount }] }]);
            // the gain that feeds a parameter is the modulation's reach; the node owning that parameter is the level
            const reach = wired(graph, "gain").find((node: any) => node.to[0]?.calls);
            const level = wired(graph, "gain").find((node: any) => node.gain === reach.to[0]);

            return { base: level.gain.value, swing: reach.gain.value };
        };

        // an lfo swings -1..1, so the level is base + (a/2) s: from 1 - a up to 1
        expect(await levels(0.6, "lfo")).toEqual({ base: 0.4 + 0.3, swing: 0.3 });
        // a rise is 0..1: base 1 - a, plus a s
        expect(await levels(0.6, "rise")).toEqual({ base: 0.4, swing: 0.6 });
        // a negative amount fades from full down by |a|
        expect(await levels(-0.6, "rise")).toEqual({ base: 1, swing: -0.6 });
    });

    it("pushes FM's depth in index units of the voice's own pitch, and only where there is FM", async () => {
        const withFm = await render([
            { ...tone, from: 200, fm: { ratio: 2, index: 3 }, mod: [{ source: "rise", to: "fm", amount: 4 }] },
        ]);
        const without = await render([{ ...tone, mod: [{ source: "rise", to: "fm", amount: 4 }] }]);

        expect(wired(withFm, "constant")[0].to[0].gain.value).toBe(4 * 200 * 2);
        expect(wired(without, "constant").length).toBe(0);
    });

    it("leaves out a modulation with nothing to push (a cutoff without a filter, a pitch on noise)", async () => {
        const graph = await render([
            {
                ...hiss,
                mod: [
                    { source: "lfo", to: "cutoff", amount: 1 },
                    { source: "lfo", to: "pitch", amount: 100 },
                ],
            },
        ]);

        expect(wired(graph, "osc").length).toBe(0);
        expect(wired(graph, "constant").length).toBe(0);
    });

    it("plays on, without a rise or a fall, where there is no constant source", async () => {
        const graph = await render(
            [{ ...tone, mod: [{ source: "rise", to: "pitch", amount: 100 }] }],
            {},
            { missing: ["createConstantSource"] },
        );

        expect(wired(graph, "constant").length).toBe(0);
        expect(wired(graph, "osc").length).toBe(1);
    });
});

describe("a voice with none of the new fields", () => {
    it("makes the graph it always did: one oscillator, one envelope, nothing extra", async () => {
        const { kinds, nodes } = await render([tone]);

        expect(
            kinds("panner").length + kinds("convolver").length + kinds("constant").length + kinds("delay").length,
        ).toBe(0);
        expect(nodes.length).toBe(5); // destination, master, limiter, oscillator, envelope
    });
});
