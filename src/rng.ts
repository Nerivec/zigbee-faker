/**
 * @see https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 * @param seed
 * @returns
 */
function mulberry32(seed: number) {
    let t = seed >>> 0;

    return () => {
        t |= 0;
        t = (t + 0x6d2b79f5) | 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);

        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Seeded PRNG (fast, tiny)
 */
export default class Rng {
    private next: () => number;

    constructor(seed: number = Date.now()) {
        this.next = mulberry32(seed >>> 0);
    }

    int(min: number, max: number): number {
        const n = Math.floor(this.next() * (max - min + 1)) + min;

        return n;
    }

    float(min = 0, max = 1): number {
        const n = this.next() * (max - min) + min;

        return n;
    }

    bool(p = 0.5): boolean {
        const b = this.next() < p;

        return b;
    }

    pick<T>(arr: readonly T[]): T {
        if (arr.length === 0) {
            throw new Error("Cannot pick from an empty array");
        }

        const v = arr[this.int(0, arr.length - 1)];

        return v;
    }

    hex(len: number): string {
        let out = "";

        for (let i = 0; i < len; i++) {
            out += "0123456789abcdef"[this.int(0, 15)];
        }

        // TODO: ensure no all-0 or all-F (often special cases in Zigbee)
        return out;
    }

    bigInt(): bigint {
        return BigInt(`0x${this.hex(this.int(2, 16))}`);
    }
}
