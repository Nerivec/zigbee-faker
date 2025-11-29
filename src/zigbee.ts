import { Clusters } from "zigbee-herdsman/dist/zspec/zcl/definition/cluster.js";
import type { ClusterName } from "zigbee-herdsman/dist/zspec/zcl/definition/tstype.js";
import type { RoutingTableStatus } from "zigbee-herdsman/dist/zspec/zdo/definition/enums.js";
import type Rng from "./rng.js";

export enum ZigbeeRelationship {
    NeighborIsParent = 0x00,
    NeighborIsAChild = 0x01,
    NeighborIsASibling = 0x02,
    NoneOfTheAbove = 0x03,
    NeighborIsPreviousChild = 0x04,
}

/**
 * `0x` format
 * @param r
 * @returns
 */
export function eui64(r: Rng): string {
    return `0x${r.hex(16)}`;
}

/**
 * Int in 0x0001..0xfff7
 * @param r
 * @returns
 */
export function networkAddress(r: Rng): number {
    return r.int(0x0001, 0xfff7);
}

/**
 * Int in 0x0001..0xfffe
 * @param r
 * @returns
 */
export function panId(r: Rng) {
    return r.int(0x0001, 0xfffe);
}

/**
 * `0x` format
 * @param r
 * @returns
 */
export function extendedPanId(r: Rng) {
    return `0x${r.hex(16)}`;
}

/**
 * Convert an Extended PAN ID in `0x` format format to `number[]` (LE)
 * @param r
 * @param src
 * @returns
 */
export function extendedPanIdToArray(src: string) {
    return Array.from(Buffer.from(src.slice(2), "hex").reverse());
}

/**
 * Convert an Extended PAN ID in `number[]` (LE) format to `0x` format
 * @param src
 * @returns
 */
export function extendedPanIdFromArray(src: number[]) {
    return `0x${Buffer.from(src).reverse().toString("hex")}`;
}

/**
 * Pick a cluster name from the ZCL specification (greenPower and manu specific are excluded).
 * Uses `zigbee-herdsman`
 * @param r
 * @returns
 */
export function clusterName(r: Rng): ClusterName {
    const allNames = Object.keys(Clusters) as (keyof typeof Clusters)[];
    let picked = r.pick(allNames);

    // start of manu-specific
    while (Clusters[picked].ID >= 0xfc00 || picked === "greenPower") {
        picked = r.pick(allNames);
    }

    return picked;
}

/**
 * Pick a Zigbee relationship
 * @param r
 * @param limitedSet
 * @returns
 */
export function relationship(r: Rng, limitedSet?: ZigbeeRelationship[]) {
    return r.pick(
        limitedSet ?? [
            ZigbeeRelationship.NeighborIsParent,
            ZigbeeRelationship.NeighborIsAChild,
            ZigbeeRelationship.NeighborIsASibling,
            ZigbeeRelationship.NoneOfTheAbove,
            // ZigbeeRelationship.NeighborIsPreviousChild, // XXX: currently ignored by Z2M
        ],
    );
}

export function routingTableEntryStatus(r: Rng): keyof typeof RoutingTableStatus {
    return r.bool(0.85) ? "ACTIVE" : r.pick(["ACTIVE", "DISCOVERY_UNDERWAY", "DISCOVERY_FAILED", "INACTIVE", "VALIDATION_UNDERWAY"]);
}
