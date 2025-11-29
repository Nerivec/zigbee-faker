import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Rng from "../src/rng.js";
import { extendedPanId, extendedPanIdFromArray, extendedPanIdToArray } from "../src/zigbee.js";

describe("Zigbee", () => {
    beforeAll(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1735689601000);
    });

    afterAll(() => {
        vi.useRealTimers();
    });

    it("converts extended PAN ID", () => {
        const r = new Rng(1);
        const extPanId = extendedPanId(r);

        const arrayFormat = extendedPanIdToArray(extPanId);
        const stringFormat = extendedPanIdFromArray(arrayFormat);

        expect(extPanId).toStrictEqual("0xa08ff49b6f772632");
        expect(arrayFormat).toStrictEqual([50, 38, 119, 111, 155, 244, 143, 160]);
        expect(extPanId).toStrictEqual(stringFormat);
    });
});
