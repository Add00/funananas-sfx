/** A fake OfflineAudioContext that records every node made and what it is connected to. */
export function rig(options: { missing?: string[]; channels?: number[] } = {}) {
    const nodes: any[] = [];
    const constructed: number[][] = [];
    const param = (value = 0) => {
        const calls: Array<[string, number, number]> = [];

        return {
            value,
            calls,
            setValueAtTime: (v: number, t: number) => calls.push(["set", v, t]),
            exponentialRampToValueAtTime: (v: number, t: number) => calls.push(["exp", v, t]),
            linearRampToValueAtTime: (v: number, t: number) => calls.push(["linear", v, t]),
        };
    };
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
            offset: param(),
            pan: param(),
            type: "",
            ...extra,
        };
        nodes.push(node);

        return node;
    };
    const buffer = (length: number) => {
        const data = new Float32Array(length);

        return { length, getChannelData: () => data };
    };
    const missing = new Set(options.missing ?? []);

    class Offline {
        currentTime = 0;
        sampleRate: number;
        destination = make("destination");
        constructor(channels: number, length: number, sampleRate: number) {
            this.sampleRate = sampleRate;
            constructed.push([channels, length, sampleRate]);
            for (const name of missing) (this as any)[name] = undefined;
        }
        createGain = () => make("gain");
        createOscillator = () =>
            make("osc", {
                start() {},
                stop() {},
                setPeriodicWave(this: any, wave: unknown) {
                    this.wave = wave;
                },
            });
        createBufferSource = () => make("noise", { start() {}, stop() {}, buffer: null });
        createConstantSource = () => make("constant", { start() {}, stop() {} });
        createBiquadFilter = () => make("filter");
        createWaveShaper = () => make("shaper");
        createDelay = (max: number) => make("delay", { max });
        createConvolver = () => make("convolver", { buffer: null });
        createStereoPanner = () => make("panner");
        createPeriodicWave = (real: Float32Array, imag: Float32Array) => ({ kind: "wave", real, imag });
        createBuffer = (_channels: number, length: number) => buffer(length);
        startRendering = () => Promise.resolve({});
    }

    const kinds = (kind: string) => nodes.filter((node) => node.kind === kind);

    return { Offline, nodes, constructed, kinds };
}
