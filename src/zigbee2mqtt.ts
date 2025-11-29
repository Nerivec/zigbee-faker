import assert from "node:assert";
import { GP_ENDPOINT, HA_ENDPOINT } from "zigbee-herdsman/dist/zspec/consts.js";
import type { ClusterName } from "zigbee-herdsman/dist/zspec/zcl/definition/tstype.js";
import zhPackageJSON from "zigbee-herdsman/package.json" with { type: "json" };
import { access, Numeric, prepareDefinition } from "zigbee-herdsman-converters";
import definitions from "zigbee-herdsman-converters/devices/index";
import type { Definition, Expose, Option } from "zigbee-herdsman-converters/lib/types";
import zhcPackageJSON from "zigbee-herdsman-converters/package.json" with { type: "json" };
import type {
    Zigbee2MQTTAPI,
    Zigbee2MQTTDevice,
    Zigbee2MQTTDeviceDefinition,
    Zigbee2MQTTDeviceEndpoint,
    Zigbee2MQTTDeviceEndpointBinding,
    Zigbee2MQTTDeviceEndpointConfiguredReporting,
    Zigbee2MQTTGroup,
    Zigbee2MQTTNetworkMap,
    Zigbee2MQTTScene,
    Zigbee2MQTTSettings,
} from "zigbee2mqtt";
import z2mSchemaJson from "zigbee2mqtt/dist/util/settings.schema.json" with { type: "json" };
import z2mPackageJSON from "zigbee2mqtt/package.json" with { type: "json" };
import { isoPastDate, sentence, word } from "./generics.js";
import Rng from "./rng.js";
import {
    clusterName,
    eui64,
    extendedPanId,
    extendedPanIdFromArray,
    extendedPanIdToArray,
    panId,
    relationship,
    routingTableEntryStatus,
    ZigbeeRelationship,
} from "./zigbee.js";

// ported from ZH for convenience with tree-shaking
export enum InterviewState {
    Pending = "PENDING",
    InProgress = "IN_PROGRESS",
    Successful = "SUCCESSFUL",
    Failed = "FAILED",
}

type PubZigbee2MQTTSettings = Omit<Zigbee2MQTTSettings, "advanced"> & {
    advanced: Omit<Zigbee2MQTTSettings["advanced"], "pan_id" | "ext_pan_id" | "network_key"> & {
        pan_id: number;
        ext_pan_id: number[];
        network_key: number[];
    };
};

type RelationshipType = Exclude<Zigbee2MQTTDevice["type"], "GreenPower">;

type Zigbee2MQTTAPIFakerSnapshot = {
    state: Zigbee2MQTTAPI["bridge/state"];
    info: Zigbee2MQTTAPI["bridge/info"];
    health: Zigbee2MQTTAPI["bridge/health"];
    converters: Zigbee2MQTTAPI["bridge/converters"];
    extensions: Zigbee2MQTTAPI["bridge/extensions"];
    devices: Zigbee2MQTTAPI["bridge/devices"];
    groups: Zigbee2MQTTAPI["bridge/groups"];
    networkMap: Zigbee2MQTTAPI["bridge/response/networkmap"];
};

/**
 * List of all ZHC definitions, no specific order (import)
 */
export const zhcDefinitions: readonly Definition[] = (() => {
    const preparedDefinitions: Definition[] = [];

    // ZHC commonjs makes a mess between exec methods
    const defs = Array.isArray(definitions) ? definitions : definitions.default;

    for (const def of defs) {
        preparedDefinitions.push(prepareDefinition(def));
    }

    return preparedDefinitions;
})();

/**
 * List of all ZHC GreenPower definitions, no specific order (import)
 */
export const zhcGpDefinitions: readonly Definition[] = (() => {
    const gpDefinitions: Definition[] = [];

    for (const definition of zhcDefinitions) {
        if (definition.fingerprint) {
            for (const fp of definition.fingerprint) {
                if (fp.modelID?.startsWith("GreenPower_")) {
                    gpDefinitions.push(definition);
                    break;
                }
            }
        }
    }

    return gpDefinitions;
})();

// #region Zigbee2MQTT Properties

/**
 * Pick a power source (including "Unknown")
 * @param r
 * @returns
 */
export function powerSource(r: Rng): Zigbee2MQTTDevice["power_source"] {
    return r.pick([
        "Unknown",
        "Mains (single phase)",
        "Mains (3 phase)",
        "Battery",
        "DC Source",
        "Emergency mains constantly powered",
        "Emergency mains and transfer switch",
    ] as const);
}

/**
 * Pick a device type ("Coordinator" excluded)
 * @param r
 * @returns
 */
export function deviceType(r: Rng): Zigbee2MQTTDevice["type"] {
    return r.pick(["Router", "EndDevice", "Unknown", "GreenPower"]);
}

/**
 * Determine the appropriate picks for a couple of relationships.
 *
 * Notes:
 *   - a and b should never both be "Coordinator" or "EndDevice"
 *   - considers "Unknown" as "EndDevice" to improve result, unless impossible
 * @param r
 * @param a
 * @param b "neighbor"
 * @returns
 */
export function relationshipByType(r: Rng, a: RelationshipType, b: RelationshipType): ZigbeeRelationship {
    if (a === "Coordinator") {
        if (b === "Coordinator") {
            throw new Error("Cannot have a relationship Coordinator<>Coordinator");
        }

        if (b === "Router") {
            return r.bool(0.75)
                ? ZigbeeRelationship.NeighborIsASibling
                : relationship(r, [ZigbeeRelationship.NeighborIsAChild, ZigbeeRelationship.NeighborIsASibling]);
        }

        // b === "EndDevice" || b ==="Unknown"
        return ZigbeeRelationship.NeighborIsAChild;
    }

    if (b === "Coordinator") {
        if (a === "Router") {
            return relationship(r, [ZigbeeRelationship.NeighborIsParent, ZigbeeRelationship.NeighborIsASibling]);
        }

        // a === "EndDevice" || a === "Unknown"
        return ZigbeeRelationship.NeighborIsParent;
    }

    if (a === "Router") {
        if (b === "Router") {
            return r.bool(0.75)
                ? ZigbeeRelationship.NeighborIsASibling
                : relationship(r, [ZigbeeRelationship.NeighborIsParent, ZigbeeRelationship.NeighborIsASibling]);
        }

        // b === "EndDevice" || b === "Unknown"
        return ZigbeeRelationship.NeighborIsAChild;
    }

    if (b === "Router") {
        // a === "EndDevice" || a === "Unknown"
        return ZigbeeRelationship.NeighborIsParent;
    }

    if (a === "EndDevice") {
        if (b === "EndDevice") {
            throw new Error("Cannot have a relationship EndDevice<>EndDevice");
        }

        // b === "Unknown"
        return ZigbeeRelationship.NeighborIsParent;
    }

    if (b === "EndDevice") {
        // a === "Unknown"
        return ZigbeeRelationship.NeighborIsAChild;
    }

    return ZigbeeRelationship.NoneOfTheAbove;
}

// #endregion

// #region Zigbee2MQTT State

/**
 * A range-appropriate int to represent link quality
 * @param r
 * @returns
 */
export function linkQuality(r: Rng) {
    return r.int(30, 255);
}

/**
 * Pick a possible OTA state
 * @param r
 * @param available If true, excludes "idle"
 * @returns
 */
export function otaState(r: Rng, available = false) {
    return available ? r.pick(["updating", "available", "scheduled"] as const) : r.pick(["updating", "idle", "available", "scheduled"] as const);
}

/**
 * Generate {count} bindings
 * @param r
 * @param count
 * @returns
 */
export function bindings(r: Rng, count: number): Zigbee2MQTTDeviceEndpointBinding[] {
    if (count <= 0) {
        return [];
    }

    const items: Zigbee2MQTTDeviceEndpointBinding[] = [];

    for (let i = 0; i < count; i++) {
        if (r.bool(0.85)) {
            items.push({
                cluster: clusterName(r),
                target: { type: "endpoint", ieee_address: eui64(r), endpoint: r.int(1, 4) },
            });
        } else {
            items.push({
                cluster: clusterName(r),
                target: { type: "group", id: r.int(1, 32) },
            });
        }
    }

    return items;
}

/**
 * Generate {count} reportings
 * @param r
 * @param count
 * @returns
 */
export function reporting(r: Rng, count: number): Zigbee2MQTTDeviceEndpointConfiguredReporting[] {
    if (count <= 0) {
        return [];
    }

    const items: Zigbee2MQTTDeviceEndpointConfiguredReporting[] = [];

    for (let i = 0; i < count; i++) {
        items.push({
            cluster: clusterName(r),
            attribute: r.bool() ? "onOff" : r.int(0, 65535),
            minimum_report_interval: r.int(1, 30),
            maximum_report_interval: r.int(60, 3600),
            reportable_change: r.int(0, 10),
        });
    }

    return items;
}

/**
 * Generate an endpoint
 * @param r
 * @param id
 * @param name
 * @param maxBindingsCount
 * @param maxReportingCount
 * @returns
 */
export function endpoint(
    r: Rng,
    id: number,
    name = r.bool(0.4) ? `${word(r)}_${r.int(1, 9)}` : undefined,
    maxBindingsCount = 3,
    maxReportingCount = 5,
): Zigbee2MQTTDeviceEndpoint {
    const input = new Set<ClusterName>();
    const output = new Set<ClusterName>();
    const scenes: Zigbee2MQTTScene[] = [];
    const addedScenes = new Set<number>();

    if (id === GP_ENDPOINT) {
        input.add("greenPower");
        output.add("greenPower");
    } else {
        input.add("genBasic");
    }

    const inCount = r.int(1, 5);

    for (let i = 0; i < inCount; i++) {
        input.add(clusterName(r));
    }

    const outCount = r.int(0, 3);

    for (let i = 0; i < outCount; i++) {
        output.add(clusterName(r));
    }

    const scenesCount = r.bool(0.75) ? 0 : r.int(0, 3);

    for (let i = 0; i < scenesCount; i++) {
        let id = r.int(1, 255);

        while (addedScenes.has(id)) {
            id = r.int(1, 255);
        }

        scenes.push({ id, name: `scene_${i + 1}` });
        addedScenes.add(id);
    }

    const ep: Zigbee2MQTTDeviceEndpoint = {
        name,
        bindings: bindings(r, r.int(0, maxBindingsCount)),
        configured_reportings: reporting(r, r.int(0, maxReportingCount)),
        clusters: { input: Array.from(input), output: Array.from(output) },
        scenes,
    };

    return ep;
}

/**
 * Generate random endpoints with possible "always-defined".
 * @param r
 * @param ensurePresent If key starts with "rnd_" it will keep the ID, but randomize the name
 * @param maxBindingsCount
 * @param maxReportingCount
 * @returns
 */
export function endpoints(
    r: Rng,
    ensurePresent?: Record<string, number>,
    maxBindingsCount?: number,
    maxReportingCount?: number,
): Record<number, Zigbee2MQTTDeviceEndpoint> {
    const endpoints: Record<number, Zigbee2MQTTDeviceEndpoint> = {};
    let epMaxCount = 3;

    if (ensurePresent) {
        let added = false;

        for (const name in ensurePresent) {
            const id = ensurePresent[name];

            if (id !== undefined) {
                endpoints[id] = endpoint(r, id, name.startsWith("rnd_") ? undefined : name, maxBindingsCount, maxReportingCount);
                added = true;
            }
        }

        if (added) {
            epMaxCount = 1;
        }
    }

    const epCount = r.int(epMaxCount === 1 ? 0 : 1, epMaxCount);

    for (let i = 0; i < epCount; i++) {
        let ep = r.int(0x01, 0xfe);

        while (endpoints[ep] !== undefined) {
            ep = r.int(0x01, 0xfe);
        }

        endpoints[ep] = endpoint(r, ep, undefined, maxBindingsCount, maxReportingCount);
    }

    return endpoints;
}

// #endregion

// #region Zigbee2MQTT definition processing

const LINKQUALITY = new Numeric("linkquality", access.STATE)
    .withUnit("lqi")
    .withDescription("Link quality (signal strength)")
    .withValueMin(0)
    .withValueMax(255)
    .withCategory("diagnostic");

/** Convert exposes from definition to plain array of exposes */
export function deviceExposes(definition: Definition): Zigbee2MQTTDeviceDefinition["exposes"] {
    const exposes: Expose[] = [LINKQUALITY];

    if (typeof definition.exposes === "function") {
        exposes.push(...definition.exposes({ isDummyDevice: true }, {}));
    } else {
        exposes.push(...definition.exposes);
    }

    return exposes;
}

/** Convert definition to definition payload (as sent over MQTT) */
export function deviceDefinitionPayload(definition: Definition): Zigbee2MQTTDeviceDefinition {
    return {
        source: "native",
        model: definition.model,
        vendor: definition.vendor,
        description: definition.description,
        exposes: deviceExposes(definition),
        supports_ota: !!definition.ota,
        options: definition.options ?? [],
        // @ts-expect-error broken type in Z2M
        icon: undefined,
    };
}

/** Find a definition by definition model (lower case matching, includes white labels) */
export function findDefinitionByModel(definitionModel: string): Definition | undefined {
    const lcModel = definitionModel.toLowerCase();

    return zhcDefinitions.find(
        (definition) =>
            definition.model.toLowerCase() === lcModel ||
            definition.whiteLabel?.find((whiteLabelEntry) => whiteLabelEntry.model.toLowerCase() === lcModel),
    );
}

/** Try to find endpoint IDs from definitions */
function definitionEndpoints(r: Rng, definition: Definition): Record<string, number> | undefined {
    if (!definition.endpoint) {
        return undefined;
    }

    // Minimal set required for `definition.endpoint` call
    //   - https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/seastar_intelligence.ts#L13
    //   - https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/moes.ts#L850
    //   - https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/ls.ts#L29
    //   - https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/gledopto.ts#L349
    //   - https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/custom_devices_diy.ts#L542
    const zhDevice = {
        isDummyDevice: true,
        endpoints: [{ ID: HA_ENDPOINT, inputClusters: [6] }],
        getEndpoint: (id: number) => (r.bool(0.5) ? { ID: id } : undefined),
    };

    // biome-ignore lint/suspicious/noExplicitAny: dummy device
    return definition.endpoint(zhDevice as any);
}

/**
 * Recursively execute the given function on given exposes.
 * @param exposes
 * @param fn
 * @param skipRoot skip execution on root for "features"-including types
 */
export function iterateExposes(exposes: Expose[], fn: (expose: Expose) => void, skipRoot = false) {
    for (const expose of exposes) {
        if (!skipRoot || !expose.features) {
            fn(expose);
        }

        if (expose.features) {
            iterateExposes(expose.features, fn);
        }
    }
}

/**
 * Recursively execute the given function on given options.
 * @param options
 * @param fn
 * @param skipRoot skip execution on root for "features"-including types
 */
export function iterateOptions(options: Option[], fn: (option: Option) => void, skipRoot = false) {
    for (const option of options) {
        if (!skipRoot || !option.features) {
            fn(option);
        }

        if (option.features) {
            iterateOptions(option.features, fn);
        }
    }
}

/**
 * Pick a value according to given expose
 * @param r
 * @param expose
 */
function exposeValue(r: Rng, expose: Expose): unknown {
    switch (expose.type) {
        case "binary": {
            return r.pick([expose.value_on, expose.value_off]);
        }
        case "numeric": {
            if (expose.name === "linkquality") {
                return linkQuality(r);
            }

            return r.int(expose.value_min ?? 0, (expose.value_max ?? r.bool(0.75)) ? 255 : 1_000);
        }
        case "text": {
            return sentence(r);
        }
        case "enum": {
            return r.pick(expose.values);
        }
        case "list": {
            const length = r.int(expose.length_min ?? 0, expose.length_max ?? 10);

            if (expose.name === "gradient") {
                return Array.from({ length }, () => `#${r.hex(6)}`);
            }

            return Array.from({ length }, () => exposeValue(r, expose.item_type));
        }
        case "climate": {
            return undefined;
        }
        case "cover": {
            return undefined;
        }
        case "fan": {
            return undefined;
        }
        case "lock": {
            return undefined;
        }
        case "switch": {
            return undefined;
        }
        case "light": {
            return undefined;
        }
        case "composite": {
            return undefined;
        }
    }

    return undefined;
}

// #endregion

/**
 * Zigbee2MQTTAPI faker class
 *
 * Note: most of the lower level functions have optional args that default to "randomized",
 * however API functions most often require args to avoid non-sensical successive randomization (most entities relating to "the Zigbee network")
 */
export class Zigbee2MQTTAPIFaker {
    private readonly r: Rng;

    constructor(seed = 1) {
        this.r = new Rng(seed);
    }

    // #region Basics

    /**
     * Friendly name using repeated `word()`, structured to reduce collisions
     * @returns
     */
    friendlyName(): string {
        const sep = this.r.bool() ? "_" : " ";

        return `${word(this.r)}${sep}${this.r.int(1000, 9999)}${sep}${word(this.r)}`;
    }

    /**
     * Generate a coordinator device
     * @returns
     */
    coordinator(): Zigbee2MQTTDevice {
        return {
            ieee_address: eui64(this.r),
            type: "Coordinator",
            network_address: 0x0000,
            supported: true,
            friendly_name: "Coordinator",
            disabled: false,
            description: undefined,
            definition: undefined,
            power_source: undefined,
            software_build_id: undefined,
            date_code: undefined,
            model_id: undefined,
            interviewing: false,
            interview_completed: true,
            interview_state: InterviewState.Successful,
            manufacturer: undefined,
            endpoints: endpoints(this.r, { rnd_1: HA_ENDPOINT, rnd_2: GP_ENDPOINT }, 0, 0),
        };
    }

    /**
     * Generate a device (excluding "Coordinator")
     * @param type Optional specific device type
     * @param model Optional specific model (ZHC definition.model)
     */
    device(type?: Exclude<Zigbee2MQTTDevice["type"], "Coordinator">, model?: string): Zigbee2MQTTDevice {
        const typeOrR = type ?? deviceType(this.r);
        const def = model ? findDefinitionByModel(model) : this.r.pick(typeOrR === "GreenPower" ? zhcGpDefinitions : zhcDefinitions);
        const interviewState = this.r.bool(0.9) ? InterviewState.Successful : this.r.pick(Object.values(InterviewState));

        assert(def, "No definition found");

        return {
            ieee_address: eui64(this.r),
            type: typeOrR,
            network_address: this.r.int(1, 0xfff7),
            supported: true,
            friendly_name: this.friendlyName(),
            disabled: this.r.bool(0.05),
            description: this.r.bool(0.25) ? sentence(this.r) : undefined,
            definition: deviceDefinitionPayload(def),
            power_source: typeOrR === "GreenPower" ? "Unknown" : powerSource(this.r),
            software_build_id: `v${this.r.int(1, 3)}.${this.r.int(0, 9)}.${this.r.int(0, 99)}`,
            date_code: `${this.r.int(2019, 2025)}${String(this.r.int(1, 12)).padStart(2, "0")}${String(this.r.int(1, 28)).padStart(2, "0")}`,
            model_id: def.model,
            interviewing: interviewState === InterviewState.InProgress,
            interview_completed: interviewState === InterviewState.Successful,
            interview_state: interviewState,
            manufacturer: def.vendor,
            endpoints: endpoints(this.r, definitionEndpoints(this.r, def) ?? (this.r.bool(0.95) ? { rnd_1: HA_ENDPOINT } : undefined)),
        };
    }

    /**
     * Generate the specified amount of devices
     * @param count default 20
     * @returns
     */
    devices(count = 20): Zigbee2MQTTDevice[] {
        if (count <= 0) {
            return [];
        }

        const list: Zigbee2MQTTDevice[] = [];

        for (let i = 0; i < count; i++) {
            list.push(this.device());
        }

        return list;
    }

    /**
     * Generate a group with the specified members
     * @param members default 1..5
     * @returns
     */
    group(members: Zigbee2MQTTDevice[] = this.devices(this.r.int(1, 5))): Zigbee2MQTTGroup {
        return {
            id: this.r.int(1, 0xfffe),
            friendly_name: this.r.bool(0.05) ? "default_bind_group" : `${word(this.r)}_group_${this.r.int(1, 99)}`,
            description: this.r.bool(0.5) ? sentence(this.r) : undefined,
            scenes: Array.from({ length: this.r.int(0, 4) }, (_, i) => ({ id: i + 1, name: `scene_${i + 1}` })),
            members: members.slice(0, this.r.int(0, Math.max(0, members.length - 1))).map((d) => ({
                ieee_address: d.ieee_address,
                endpoint: this.r.pick(Object.keys(d.endpoints).map((v) => Number(v))),
            })),
        };
    }

    /**
     * Generate a specified number of groups with specified possible members
     * @param count default 4
     * @param memberCandidates default 1..5
     * @returns
     */
    groups(count = 4, memberCandidates = this.devices(this.r.int(1, 5))): Zigbee2MQTTGroup[] {
        const groupMembers = Array.from({ length: this.r.int(0, memberCandidates.length - 1) }, () => this.r.pick(memberCandidates));
        const uniqueGroupMembers = groupMembers.filter((m, idx) => groupMembers.indexOf(m) === idx);

        return Array.from({ length: count }, () => this.group(uniqueGroupMembers));
    }

    // #endregion

    // #region Bridge

    /**
     * Generate a "bridge/logging" payload
     * @param includeDebug
     * @returns
     */
    bridgeLogging(includeDebug?: boolean): Zigbee2MQTTAPI["bridge/logging"] {
        const logLevels = ["info", "warning", "error"] as const;

        return {
            message: sentence(this.r),
            // debug is not sent to frontend
            level: this.r.pick(includeDebug ? [...logLevels, "debug"] : logLevels),
            namespace: `${this.r.pick(["z2m", "zh", "zhc"])}:${word(this.r)}`,
        };
    }

    /**
     * Generate a "bridge/state" payload
     * @returns
     */
    bridgeState(): Zigbee2MQTTAPI["bridge/state"] {
        return { state: this.r.bool(0.95) ? "online" : "offline" };
    }

    /**
     * Generate a flexible "config" payload for "bridge/info"
     * @param devices
     * @param groups
     * @param logLevel
     * @param haEnabled
     * @param availabilityEnabled
     * @param deviceSpecificOptions
     * @param groupSpecificOptions
     * @param deviceOptions
     * @returns
     */
    bridgeInfoConfig(
        devices: Zigbee2MQTTDevice[],
        groups: Zigbee2MQTTGroup[],
        logLevel = this.r.pick<PubZigbee2MQTTSettings["advanced"]["log_level"]>(["debug", "info", "warning", "error"]),
        haEnabled = this.r.bool(0.5),
        availabilityEnabled = this.r.bool(0.75),
        deviceSpecificOptions: PubZigbee2MQTTSettings["devices"] = {},
        groupSpecificOptions: PubZigbee2MQTTSettings["groups"] = {},
        deviceOptions: PubZigbee2MQTTSettings["device_options"] = {},
    ): PubZigbee2MQTTSettings {
        const logSyslog = this.r.bool(0.3);

        const devicesObj: PubZigbee2MQTTSettings["devices"] = {};

        for (const device of devices) {
            devicesObj[device.ieee_address] = { ...deviceSpecificOptions[device.ieee_address], friendly_name: device.friendly_name };
        }

        const groupsObj: PubZigbee2MQTTSettings["groups"] = {};

        for (const group of groups) {
            groupsObj[group.id] = { ...groupSpecificOptions[group.id], friendly_name: group.friendly_name };
        }

        return {
            version: 4,
            homeassistant: {
                enabled: haEnabled,
                discovery_topic: "homeassistant",
                status_topic: "hass/status",
                experimental_event_entities: this.r.bool(0.2),
                legacy_action_sensor: this.r.bool(0.2),
            },
            availability: {
                enabled: availabilityEnabled,
                active: {
                    timeout: this.r.int(5, 120),
                    max_jitter: this.r.int(1_000, 30_000),
                    backoff: this.r.bool(0.9),
                    pause_on_backoff_gt: this.r.int(100, 3_000),
                },
                passive: { timeout: this.r.int(5, 120) },
            },
            mqtt: {
                base_topic: "zigbee2mqtt",
                include_device_information: this.r.bool(0.1),
                force_disable_retain: this.r.bool(0.1),
                version: this.r.pick([3, 4, 5]),
                user: "z2m",
                password: "secret",
                server: "mqtt://localhost:1883",
                ca: undefined,
                keepalive: this.r.int(10, 120),
                key: undefined,
                cert: undefined,
                client_id: `z2m_${this.r.hex(6)}`,
                reject_unauthorized: this.r.bool(0.9),
                maximum_packet_size: this.r.int(20, 268_435_456),
            },
            serial: {
                disable_led: this.r.bool(0.5),
                port: "/dev/ttyACM0",
                adapter: this.r.pick(["deconz", "ember", "zstack"]),
                baudrate: this.r.pick([115200, 230400, 460800, 1000000]),
                rtscts: this.r.bool(0.5),
            },
            passlist: [],
            blocklist: [],
            map_options: {
                graphviz: {
                    colors: {
                        fill: { enddevice: "#fff8ce", coordinator: "#e04e5d", router: "#4ea3e0" },
                        font: { coordinator: "#ffffff", router: "#ffffff", enddevice: "#000000" },
                        line: { active: "#009900", inactive: "#994444" },
                    },
                },
            },
            ota: {
                update_check_interval: this.r.int(3600, 24 * 3600),
                disable_automatic_update_check: this.r.bool(0.2),
                zigbee_ota_override_index_location: undefined,
                image_block_response_delay: this.r.pick([undefined, this.r.int(10, 200)]),
                default_maximum_data_size: this.r.pick([undefined, 64, 80, 128]),
            },
            frontend: {
                enabled: this.r.bool(0.95),
                package: "zigbee2mqtt-windfront",
                auth_token: undefined,
                host: undefined,
                port: this.r.int(8080, 9090),
                base_url: "/",
                url: undefined,
                ssl_cert: undefined,
                ssl_key: undefined,
                notification_filter: [],
                disable_ui_serving: this.r.bool(0.05),
            },
            devices: devicesObj,
            groups: groupsObj,
            device_options: deviceOptions,
            advanced: {
                log_rotation: this.r.bool(0.8),
                log_console_json: this.r.bool(0.5),
                log_symlink_current: this.r.bool(0.6),
                log_output: Array.from({ length: this.r.int(this.r.bool(0.9) ? 1 : 0, logSyslog ? 3 : 2) }, () =>
                    this.r.pick(logSyslog ? (["console", "file", "syslog"] as const) : (["console", "file"] as const)),
                ),
                log_directory: "data/log/%TIMESTAMP%",
                log_file: "log.txt",
                log_level: logLevel,
                log_namespaced_levels: {},
                log_syslog: {},
                log_debug_to_mqtt_frontend: this.r.bool(0.1),
                log_debug_namespace_ignore: "",
                log_directories_to_keep: this.r.int(2, 1_000),
                pan_id: panId(this.r),
                ext_pan_id: extendedPanIdToArray(extendedPanId(this.r)),
                channel: this.r.int(11, 25),
                adapter_concurrent: this.r.pick([undefined, 16, 32, 64]),
                adapter_delay: this.r.pick([undefined, 0, 10, 50]),
                cache_state: this.r.bool(0.9),
                cache_state_persistent: this.r.bool(0.8),
                cache_state_send_on_startup: this.r.bool(0.8),
                last_seen: this.r.pick(["disable", "ISO_8601", "ISO_8601_local", "epoch"]),
                elapsed: this.r.bool(0.5),
                network_key: Array.from({ length: 16 }, () => this.r.int(0, 254)),
                timestamp_format: "YYYY-MM-DD HH:mm:ss",
                output: this.r.bool(0.95) ? "json" : this.r.pick(["json", "attribute", "attribute_and_json"] as const),
                transmit_power: this.r.pick([undefined, 0, 5, 9, 15, 19, 20]),
            },
            health: {
                interval: this.r.int(1, 60),
                reset_on_check: this.r.bool(0.1),
            },
        };
    }

    /**
     * Generate a flexible "bridge/info" payload
     * @param coordinator
     * @param devices
     * @param groups
     * @param logLevel
     * @param haEnabled
     * @param availabilityEnabled
     * @param deviceSpecificOptions
     * @param groupSpecificOptions
     * @param deviceOptions
     * @param permitJoin
     * @param restartRequired
     * @returns
     */
    bridgeInfo(
        coordinator: Zigbee2MQTTDevice,
        devices: Zigbee2MQTTDevice[],
        groups: Zigbee2MQTTGroup[],
        logLevel = this.r.pick<PubZigbee2MQTTSettings["advanced"]["log_level"]>(["debug", "info", "warning", "error"]),
        haEnabled = this.r.bool(0.5),
        availabilityEnabled = this.r.bool(0.75),
        deviceSpecificOptions: PubZigbee2MQTTSettings["devices"] = {},
        groupSpecificOptions: PubZigbee2MQTTSettings["groups"] = {},
        deviceOptions: PubZigbee2MQTTSettings["device_options"] = {},
        permitJoin = this.r.bool(0.5),
        restartRequired = this.r.bool(0.01),
    ): Zigbee2MQTTAPI["bridge/info"] {
        const channel = this.r.int(11, 26);
        const config = this.bridgeInfoConfig(
            [coordinator, ...devices],
            groups,
            logLevel,
            haEnabled,
            availabilityEnabled,
            deviceSpecificOptions,
            groupSpecificOptions,
            deviceOptions,
        );

        return {
            os: {
                version: `${this.r.int(5, 6)}.${this.r.int(0, 15)}.${this.r.int(0, 20)}`,
                node_version: `${this.r.int(20, 24)}.${this.r.int(0, 20)}.${this.r.int(0, 99)}`,
                cpus: `${this.r.int(2, 16)}x ${this.r.pick(["ARM", "x86_64", "AMD64"])}`,
                memory_mb: this.r.int(1024, 65536),
            },
            mqtt: { version: config.mqtt.version, server: config.mqtt.server },
            version: z2mPackageJSON.version,
            commit: this.r.bool(0.5) ? this.r.hex(7) : undefined,
            zigbee_herdsman_converters: { version: zhcPackageJSON.version },
            zigbee_herdsman: { version: zhPackageJSON.version },
            coordinator: {
                ieee_address: this.coordinator().ieee_address,
                type: this.r.pick(["ConBee3", "EmberZNet", "ZStack3x0"]),
                meta: {
                    revision: `v${this.r.int(1, 10)}.${this.r.int(0, 20)}.${this.r.int(0, 99)}`,
                },
            },
            network: {
                pan_id: config.advanced.pan_id,
                extended_pan_id: extendedPanIdFromArray(config.advanced.ext_pan_id),
                channel,
            },
            log_level: config.advanced.log_level,
            permit_join: permitJoin,
            permit_join_end: permitJoin ? Date.now() + this.r.int(30_000, 254_000) : undefined,
            restart_required: restartRequired,
            config,
            config_schema: z2mSchemaJson,
        };
    }

    /**
     * Generate a "bridge/health" payload
     * @param devices
     * @returns
     */
    bridgeHealth(devices: Zigbee2MQTTDevice[]): Zigbee2MQTTAPI["bridge/health"] {
        const devMap: Zigbee2MQTTAPI["bridge/health"]["devices"] = {};

        for (const d of devices) {
            devMap[d.ieee_address] = {
                messages: this.r.int(0, 10_000),
                messages_per_sec: this.r.float(0, 10),
                leave_count: this.r.bool(0.75) ? 0 : this.r.int(1, 5),
                network_address_changes: this.r.bool(0.95) ? 0 : this.r.int(0, 3),
            };
        }

        const sysMemTotalMb = this.r.int(1024, 65536);
        const sysMemFreeMb = this.r.int(sysMemTotalMb / 4, sysMemTotalMb - 1024);
        const sysMemUsedMb = sysMemTotalMb - sysMemFreeMb;
        const procMemUsedMb = this.r.int(50, 150);

        return {
            response_time: Date.now(),
            os: {
                load_average: [this.r.float(0, 1.5), this.r.float(0, 1.5), this.r.float(0, 1.5)].map((x) => Math.round(x * 100) / 100),
                memory_used_mb: sysMemUsedMb,
                memory_percent: Math.round((sysMemUsedMb / sysMemTotalMb) * 100.0 * 10000.0) / 10000.0,
            },
            process: {
                uptime_sec: this.r.int(10, 7 * 24 * 3600),
                memory_used_mb: procMemUsedMb,
                memory_percent: Math.round((procMemUsedMb / sysMemTotalMb) * 100.0 * 10000.0) / 10000.0,
            },
            mqtt: {
                connected: this.r.bool(0.95),
                queued: this.r.int(0, 1000),
                received: this.r.int(0, 100_000),
                published: this.r.int(0, 100_000),
            },
            devices: devMap,
        };
    }

    /**
     * Generate a "bridge/event" payload
     * @param device
     * @returns
     */
    bridgeEvent(device: Zigbee2MQTTDevice): Zigbee2MQTTAPI["bridge/event"] {
        const base = { friendly_name: device.friendly_name, ieee_address: device.ieee_address };
        const kind = this.r.pick(["device_leave", "device_joined", "device_announce", "device_interview"] as const);

        if (kind === "device_interview") {
            const status = this.r.pick(["started", "failed", "successful"] as const);

            if (status === "successful") {
                return {
                    type: "device_interview",
                    data: {
                        ...base,
                        status,
                        supported: device.supported,
                        definition: device.definition,
                    },
                };
            }

            return { type: "device_interview", data: { ...base, status } };
        }

        return { type: kind, data: base } as Zigbee2MQTTAPI["bridge/event"];
    }

    /**
     * Generate a "bridge/converters" payload
     * @param count default: 1..5
     * @returns
     */
    bridgeConverters(count = this.r.int(1, 5)): Zigbee2MQTTAPI["bridge/converters"] {
        return Array.from({ length: count }, (_, i) => ({
            name: `custom_converter_${i + 1}`,
            code: "export default { fromZigbee: [], toZigbee: [], exposes: [] };",
        }));
    }

    /**
     * Generate a "bridge/extensions" payload
     * @param count default: 1..3
     * @returns
     */
    bridgeExtensions(count = this.r.int(1, 2)): Zigbee2MQTTAPI["bridge/extensions"] {
        return Array.from({ length: count }, (_, i) => ({
            name: `extension_${i + 1}`,
            code: "export default { start: () => {}, stop: () => {} };",
        }));
    }

    /**
     * Generate a "bridge/devices" payload.
     * Coordinator is always first.
     * @param coordinator
     * @param devices
     * @returns
     */
    bridgeDevices(coordinator: Zigbee2MQTTDevice, devices: Zigbee2MQTTDevice[]): Zigbee2MQTTAPI["bridge/devices"] {
        return [coordinator, ...devices];
    }

    /**
     * Generate a "bridge/groups" payload
     * @param groups
     * @returns
     */
    bridgeGroups(groups: Zigbee2MQTTGroup[]): Zigbee2MQTTAPI["bridge/groups"] {
        return groups;
    }

    /**
     * Generate a flexible "{friendlyName}" payload
     * @param device
     * @param partial only include part of the state derived from exposes
     * @param overrides
     * @returns
     */
    entityState(
        device: Zigbee2MQTTDevice,
        partial = false,
        overrides: Partial<Zigbee2MQTTAPI["{friendlyName}"]> = {},
    ): Zigbee2MQTTAPI["{friendlyName}"] {
        const base: Zigbee2MQTTAPI["{friendlyName}"] = {};

        if (device.definition) {
            if (device.definition.supports_ota && this.r.bool(0.85)) {
                const installedVersion = this.r.int(1, 249_999_999);
                const latestVersion = this.r.bool(0.75) ? installedVersion : this.r.int(installedVersion, 250_000_000);
                const updateState = installedVersion === latestVersion ? "idle" : otaState(this.r, latestVersion > installedVersion);

                base.update = {
                    progress: updateState === "updating" ? this.r.int(0, 100) : undefined,
                    remaining: updateState === "updating" ? this.r.int(1, 1800) : undefined,
                    state: updateState,
                    installed_version: installedVersion,
                    latest_version: latestVersion,
                };
            }

            const iterateFn = (expose: Expose) => {
                if (expose.property || expose.name) {
                    base[expose.property ?? expose.name] = exposeValue(this.r, expose);
                }
            };

            if (device.definition.exposes.length > 0) {
                if (partial) {
                    const picked: Expose[] = [];

                    for (let i = 0; i < device.definition.exposes.length; i++) {
                        if (this.r.bool(0.3)) {
                            const expose = device.definition.exposes[i];

                            picked.push(expose);
                        }
                    }

                    iterateExposes(picked, iterateFn);
                } else {
                    iterateExposes(device.definition.exposes, iterateFn);
                }
            }
        }

        return {
            last_seen: isoPastDate(this.r),
            ...base,
            ...overrides,
        };
    }

    /**
     * Generate a ""{friendlyName}/availability"" payload
     * @returns
     */
    entityAvailability(): Zigbee2MQTTAPI["{friendlyName}/availability"] {
        return { state: this.r.bool(0.9) ? "online" : "offline" };
    }

    /**
     * Generate a "raw" network map
     * TODO: the map currently does not make sense in "Zigbee-way"
     * @param coordinator
     * @param devices
     * @param routes Optionally include routes, defaults to false (bool not randomized)
     * @returns
     */
    networkMap(coordinator: Zigbee2MQTTDevice, devices: Zigbee2MQTTDevice[], routes = false): Zigbee2MQTTNetworkMap {
        const nodes: Zigbee2MQTTNetworkMap["nodes"] = [];

        for (const device of [coordinator, ...devices]) {
            if (device.type !== "Coordinator" && device.type !== "Router" && device.type !== "EndDevice" && device.type !== "Unknown") {
                continue;
            }

            nodes.push({
                ieeeAddr: device.ieee_address,
                friendlyName: device.friendly_name,
                type: device.type,
                networkAddress: device.network_address,
                manufacturerName: device.manufacturer,
                modelID: device.model_id,
                lastSeen: Date.now() - this.r.int(0, 36_000_000),
                definition: device.definition
                    ? {
                          model: device.definition.model,
                          vendor: device.definition.vendor,
                          description: device.definition.description,
                          supports: Array.from(
                              new Set(
                                  device.definition.exposes.map((e) => {
                                      return e.name ?? `${e.type} (${e.features?.map((f) => f.name).join(", ")})`;
                                  }),
                              ),
                          ).join(", "),
                      }
                    : undefined,
            });
        }

        const links: Zigbee2MQTTNetworkMap["links"] = [];
        /** favor Coordinator (idx 0) 75% of the time on small networks, 50% on larger networks */
        const pickNodeIdx = () => (this.r.bool(nodes.length < 50 ? 0.75 : 0.5) ? 0 : this.r.int(1, nodes.length - 1));

        for (let i = 0; i < nodes.length - 1; i++) {
            const a = nodes[i];
            // prevents adding more than one relationship with same target
            const prevBIdxs = new Set<number>();

            for (let j = 0; j < this.r.int(0, nodes.length < 50 ? 3 : 6); j++) {
                // never pick coordinator if `a` is coordinator
                let bIdx = i === 0 ? this.r.int(1, nodes.length - 1) : pickNodeIdx();
                let b = nodes[bIdx];

                while (bIdx === i || prevBIdxs.has(bIdx) || (a.type === "EndDevice" && b.type === "EndDevice")) {
                    bIdx = pickNodeIdx();
                    b = nodes[bIdx];
                }

                prevBIdxs.add(bIdx);

                const linkquality = linkQuality(this.r);

                links.push({
                    source: { ieeeAddr: a.ieeeAddr, networkAddress: a.networkAddress },
                    target: { ieeeAddr: b.ieeeAddr, networkAddress: b.networkAddress },
                    linkquality,
                    depth: this.r.int(1, 3),
                    routes: routes
                        ? [
                              {
                                  destinationAddress: a.networkAddress,
                                  status: routingTableEntryStatus(this.r),
                                  memoryConstrained: 0x0,
                                  manyToOne: a.type === "Coordinator" ? 0x1 : 0x0,
                                  routeRecordRequired: 0x0,
                                  reserved1: 0x0,
                                  nextHopAddress: a.networkAddress,
                              },
                          ]
                        : [],
                    /** @deprecated */
                    sourceIeeeAddr: a.ieeeAddr,
                    /** @deprecated */
                    targetIeeeAddr: b.ieeeAddr,
                    /** @deprecated */
                    sourceNwkAddr: a.networkAddress,
                    /** @deprecated */
                    lqi: linkquality,
                    // type-asserted since `nodes` only contain valid types, else `a`/`b` re-picked above
                    relationship: relationshipByType(this.r, a.type as RelationshipType, b.type as RelationshipType),
                    deviceType: a.type === "EndDevice" ? 0x02 : a.type === "Router" ? 0x01 : a.type === "Coordinator" ? 0x00 : 0x03,
                    rxOnWhenIdle: this.r.bool(0.05) ? 0x02 : a.type === "Router" || a.type === "Coordinator" ? 0x01 : 0x00,
                    permitJoining: this.r.bool(0.25) ? 0x02 : this.r.bool(0.05) ? 0x01 : 0x00,
                });
            }
        }

        return { nodes, links };
    }

    /**
     * Generate a "bridge/response/networkmap" payload
     * @param coordinator
     * @param devices
     * @param routes Optionally include routes, defaults to false (bool not randomized)
     * @returns
     */
    rawNetworkMap(coordinator: Zigbee2MQTTDevice, devices: Zigbee2MQTTDevice[], routes?: boolean): Zigbee2MQTTAPI["bridge/response/networkmap"] {
        return {
            type: "raw",
            routes: routes ?? false,
            value: this.networkMap(coordinator, devices, routes),
        };
    }

    /**
     * Generate a "bridge/response/device/generate_external_definition" payload
     * @param id
     * @param zigbeeModel
     * @param vendor
     */
    externalDefinition(
        id = eui64(this.r),
        zigbeeModel = word(this.r),
        vendor = word(this.r),
    ): Zigbee2MQTTAPI["bridge/response/device/generate_external_definition"] {
        return {
            id,
            source: `import * as m from 'zigbee-herdsman-converters/lib/modernExtend';

export default {
    zigbeeModel: ['${zigbeeModel}'],
    model: '${zigbeeModel}',
    vendor: '${vendor}',
    description: 'Automatically generated definition',
    extend: [m.temperature(), m.onOff({"powerOnBehavior":false})],
    meta: {},
};`,
        };
    }

    // #endregion

    // #region Utils

    /**
     * Generate a snapshot object containing most static-ish "bridge" elements
     * Coordinator is always first in devices list.
     * @param deviceCount default: 20
     * @param groupCount default: 4
     * @returns
     */
    snapshot(deviceCount = 20, groupCount = 4): Zigbee2MQTTAPIFakerSnapshot {
        const coordinator = this.coordinator();
        const devices = this.devices(deviceCount);
        const groups = this.groups(groupCount, devices);

        return {
            state: this.bridgeState(),
            info: this.bridgeInfo(coordinator, devices, groups),
            health: this.bridgeHealth(devices),
            converters: this.bridgeConverters(),
            extensions: this.bridgeExtensions(),
            devices: this.bridgeDevices(coordinator, devices),
            groups: this.bridgeGroups(groups),
            networkMap: this.rawNetworkMap(coordinator, devices, false),
        };
    }

    // #endregion
}

// #region ZHC utils

/**
 * List all ZHC definition models with whitelabels (if any)
 * @returns Map of whitelabels by models, both with format `${vendor} ${model}`
 */
export function listDefinitionModels(): Map<string, string[]> {
    const out = new Map<string, string[]>();

    for (let i = 0; i < zhcDefinitions.length; i++) {
        const d = zhcDefinitions[i];
        const outWl: string[] = [];
        out.set(`${d.vendor} ${d.model}`, outWl);

        if (d.whiteLabel) {
            for (let j = 0; j < d.whiteLabel.length; j++) {
                const wl = d.whiteLabel[j];

                outWl.push(`${wl.vendor} ${wl.model}`);
            }

            outWl.sort();
        }
    }

    const sortedArr = Array.from(out).sort((a, b) => a[0].localeCompare(b[0]));

    return new Map(sortedArr);
}

/**
 * List all ZHC GreenPower definition models with whitelabels (if any)
 * @returns Map of whitelabels by models, both with format `${vendor} ${model}`
 */
export function listGreenPowerDefinitionModels(): Map<string, string[]> {
    const out = new Map<string, string[]>();

    for (let i = 0; i < zhcGpDefinitions.length; i++) {
        const d = zhcGpDefinitions[i];
        const outWl: string[] = [];
        out.set(`${d.vendor} ${d.model}`, outWl);

        if (d.whiteLabel) {
            for (let j = 0; j < d.whiteLabel.length; j++) {
                const wl = d.whiteLabel[j];

                outWl.push(`${wl.vendor} ${wl.model}`);
            }

            outWl.sort();
        }
    }

    const sortedArr = Array.from(out).sort((a, b) => a[0].localeCompare(b[0]));

    return new Map(sortedArr);
}

/**
 * List all ZHC exposes names used in definitions with a total count
 * @returns Array of string with format `[${count}] ${name}`
 */
export function listDefinitionExposes(): string[] {
    const namesWithCount = new Map<string, number>();

    const iterateFn = (expose: Zigbee2MQTTDeviceDefinition["exposes"][number]) => {
        if (expose.name) {
            const count = namesWithCount.get(expose.name);

            namesWithCount.set(expose.name, (count ?? 0) + 1);
        }
    };

    for (const def of zhcDefinitions) {
        iterateExposes(deviceExposes(def), iterateFn);
    }

    const out: string[] = [];

    for (const [name, count] of [...namesWithCount.entries()].sort((a, b) => b[1] - a[1])) {
        out.push(`- ${name} (${count})`);
    }

    return out;
}

/**
 * List all ZHC options names used in definitions with a total count
 * @returns Array of string with format `[${count}] ${name}`
 */
export function listDefinitionOptions(): string[] {
    const namesWithCount = new Map<string, number>();

    const iterateFn = (option: Zigbee2MQTTDeviceDefinition["options"][number]) => {
        if (option.name) {
            const count = namesWithCount.get(option.name);

            namesWithCount.set(option.name, (count ?? 0) + 1);
        }
    };

    for (const def of zhcDefinitions) {
        if (def.options) {
            iterateOptions(def.options, iterateFn);
        }
    }

    const out: string[] = [];

    for (const [name, count] of [...namesWithCount.entries()].sort((a, b) => b[1] - a[1])) {
        out.push(`- ${name} (${count})`);
    }

    return out;
}

/**
 * List all ZHC expose names<>categories used in definitions
 * @returns Array of string with format `[${category}] ${name}`
 */
export function listDefinitionExposesCategories(): Map<string, string[]> {
    const namesWithCategory: [string, string][] = [];

    const iterateFn = (expose: Zigbee2MQTTDeviceDefinition["exposes"][number]) => {
        if (expose.name) {
            if (expose.category) {
                namesWithCategory;
                namesWithCategory.push([expose.name, expose.category]);
            }
        }
    };

    for (const def of zhcDefinitions) {
        iterateExposes(deviceExposes(def), iterateFn);
    }

    const out = new Map<string, string[]>();

    for (const [name, category] of namesWithCategory) {
        const existing = out.get(category);

        if (existing) {
            if (!existing.includes(name)) {
                existing.push(name);
            }
        } else {
            out.set(category, [name]);
        }
    }

    for (const [, names] of out) {
        names.sort((a, b) => a.localeCompare(b));
    }

    const sortedArr = Array.from(out).sort((a, b) => a[0].localeCompare(b[0]));

    return new Map(sortedArr);
}

// #endregion
