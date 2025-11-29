import type Rng from "./rng.js";

/**
 * Basic word from a short list
 * @param r
 * @returns
 */
export function word(r: Rng): string {
    const pool = ["alpha", "beta", "gamma", "delta", "omega", "nova", "terra", "luna", "sol", "aqua", "zen", "ion", "neo", "flux", "quark"];

    return r.pick(pool);
}

/**
 * Basic sentence-like usind successive `word()` (not actual sentences)
 * @param r
 * @param min
 * @param max
 * @returns
 */
export function sentence(r: Rng, min = 3, max = 8): string {
    const n = r.int(min, max);
    const words: string[] = [];

    for (let i = 0; i < n; i++) {
        words.push(word(r));
    }

    const s = words.join(" ");

    return `${s.charAt(0).toUpperCase() + s.slice(1)}.`;
}

/**
 * Past Date in ISO string format
 * @param r
 * @returns
 */
export function isoPastDate(r: Rng): string {
    return new Date(Date.now() - r.int(10_000, r.bool(0.85) ? 20_000_000 : 1_000_000_000)).toISOString();
}
