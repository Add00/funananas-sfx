import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as engine from "../src/sfx.js";
import type { Score, Sfx, Voice } from "../src/sfx.js";

const declarations = readFileSync(new URL("../src/sfx.d.ts", import.meta.url), "utf8");

/** The values (functions and constants) the declarations export, found by their `export` lines. */
function declaredValues(): string[] {
    return [...declarations.matchAll(/^export (?:function|const) (\w+)/gm)].map((match) => match[1]!);
}

describe("the type declarations", () => {
    it("declare every value the module exports", () => {
        expect(declaredValues().sort()).toEqual(Object.keys(engine).sort());
    });

    it("are the types a caller meets, checked by the compiler as well as at run time", () => {
        // These lines are type-checked by `npm run typecheck`: a wrong declaration fails there.
        const voices: Voice[] = [
            { voice: "tone", type: "sawtooth", from: 220, to: 55, length: 0.2, gain: 0.3, curve: "linear" },
            { voice: "hiss", length: 0.1, gain: 0.2, filter: { type: "lowpass", from: 4000, to: 400 } },
        ];
        const score: Score = voices;
        const sfx: Sfx = engine.createSfx({ key: "types-test", scores: { hit: () => score } });
        expect(typeof sfx.play("hit")).toBe("boolean");
        expect(engine.silentSfx.wanted()).toBe(false);
        expect(engine.envelope({ length: 0.2 }).rise).toBeGreaterThan(0);
    });
});
