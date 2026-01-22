import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
    listDefinitionExposes,
    listDefinitionExposesCategories,
    listDefinitionModels,
    listDefinitionOptions,
    listGreenPowerDefinitionModels,
    Zigbee2MQTTAPIFaker,
} from "../src/zigbee2mqtt.js";

describe("Zigbee2MQTT", () => {
    beforeAll(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1735689601000);
    });

    afterAll(() => {
        vi.useRealTimers();
    });

    it("generates a random device type", () => {
        const faker = new Zigbee2MQTTAPIFaker(1);
        const device = faker.device();

        expect(device).toMatchObject({
            ieee_address: "0xff49b6f772632716",
            type: "Unknown",
            network_address: 50267,
            supported: true,
            friendly_name: "gamma_1384_terra",
            disabled: false,
            description: undefined,
            power_source: "Mains (3 phase)",
            software_build_id: "v1.6.54",
            date_code: "20240321",
            model_id: "IM-CDZDGAAA0005KA_MAN",
            interviewing: false,
            interview_completed: true,
            interview_state: "SUCCESSFUL",
            manufacturer: "ADEO",
        });
        expect(faker.entityState(device)).toStrictEqual({
            brightness: 135,
            color: undefined,
            color_temp: 192,
            color_temp_startup: 233,
            effect: "blink",
            last_seen: "2024-12-31T21:49:25.677Z",
            linkquality: 183,
            power_on_behavior: "previous",
            state: "ON",
            x: 21,
            y: 978,
        });

        const faker2 = new Zigbee2MQTTAPIFaker(9900);
        const device2 = faker2.device();

        expect(device2).toMatchObject({
            ieee_address: "0xfe4d83d33c806029",
            type: "GreenPower",
            network_address: 22204,
            supported: true,
            friendly_name: "terra 2057 delta",
            disabled: false,
            description: "Nova delta omega delta zen terra zen.",
            power_source: "Unknown",
            software_build_id: "v2.2.39",
            date_code: "20220511",
            model_id: "ZLGP17/ZLGP18",
            interviewing: false,
            interview_completed: true,
            interview_state: "SUCCESSFUL",
            manufacturer: "Legrand",
        });
        expect(faker.entityState(device)).toStrictEqual({
            brightness: 98,
            color: undefined,
            color_temp: 226,
            color_temp_startup: 166,
            effect: "blink",
            last_seen: "2024-12-31T22:40:47.540Z",
            linkquality: 167,
            power_on_behavior: "off",
            state: "OFF",
            x: 247,
            y: 138,
        });
    });

    it("generates random devices with specific models", () => {
        const faker = new Zigbee2MQTTAPIFaker(1);
        const device = faker.device("Router", "ZBDongle-E");

        expect(device).toMatchObject({
            ieee_address: "0x08ff49b6f7726327",
            type: "Router",
            network_address: 4415,
            model_id: "ZBDongle-E",
            manufacturer: "SONOFF",
        });
        expect(faker.entityState(device)).toStrictEqual({
            last_seen: "2024-12-31T23:19:48.889Z",
            light_indicator_level: 140,
            linkquality: 62,
        });

        const faker2 = new Zigbee2MQTTAPIFaker(10);
        const device2 = faker2.device("Router", "E13-N11");

        expect(device2).toMatchObject({
            ieee_address: "0xebc77310fe2667e4",
            type: "Router",
            network_address: 52957,
            model_id: "E13-N11",
            manufacturer: "Sengled",
        });
        expect(faker2.entityState(device2)).toStrictEqual({
            brightness: 46,
            last_seen: "2024-12-31T20:27:18.265Z",
            linkquality: 160,
            occupancy: true,
            state: "ON",
            update: {
                installed_version: 138384420,
                latest_version: 183702098,
                progress: undefined,
                remaining: undefined,
                state: "scheduled",
            },
        });
    });

    it("generates a router device type", () => {
        const faker = new Zigbee2MQTTAPIFaker(1);
        const device = faker.device("Router");

        expect(device).toMatchObject({
            ieee_address: "0x8ff49b6f77263271",
            type: "Router",
            network_address: 25859,
        });
    });

    it("generates an end device type", () => {
        const faker = new Zigbee2MQTTAPIFaker(1);
        const device = faker.device("EndDevice");

        expect(device).toMatchObject({
            ieee_address: "0x8ff49b6f77263271",
            type: "EndDevice",
            network_address: 25859,
        });
    });

    it("generates a GreenPower device type", () => {
        const faker = new Zigbee2MQTTAPIFaker(1);
        const device = faker.device("GreenPower");

        expect(device).toMatchObject({
            ieee_address: "0x8ff49b6f77263271",
            type: "GreenPower",
            network_address: 25859,
        });
    });

    it("generates an unknown device type", () => {
        const faker = new Zigbee2MQTTAPIFaker(1);
        const device = faker.device("Unknown");

        expect(device).toMatchObject({
            ieee_address: "0x8ff49b6f77263271",
            type: "Unknown",
            network_address: 25859,
        });
    });

    it("generates a small snapshot", () => {
        const faker = new Zigbee2MQTTAPIFaker(1);
        const snapshot = faker.snapshot(20, 4);

        expect(snapshot.state).toStrictEqual({ state: "online" });
        expect(snapshot.info).toBeDefined();
        expect(snapshot.health).toBeDefined();
        expect(snapshot.converters).toBeDefined();
        expect(snapshot.converters.length).toStrictEqual(4);
        expect(snapshot.extensions).toBeDefined();
        expect(snapshot.extensions.length).toStrictEqual(2);
        expect(snapshot.devices.length).toStrictEqual(21);
        expect(snapshot.groups.length).toStrictEqual(4);
        expect(snapshot.networkMap).toBeDefined();
        expect(snapshot.networkMap.type).toStrictEqual("raw");
    });

    it("generates a large snapshot", () => {
        const faker = new Zigbee2MQTTAPIFaker(1);
        const snapshot = faker.snapshot(200, 25);

        expect(snapshot.state).toStrictEqual({ state: "online" });
        expect(snapshot.info).toBeDefined();
        expect(snapshot.health).toBeDefined();
        expect(snapshot.converters).toBeDefined();
        expect(snapshot.converters.length).toStrictEqual(5);
        expect(snapshot.extensions).toBeDefined();
        expect(snapshot.extensions.length).toStrictEqual(2);
        expect(snapshot.devices.length).toStrictEqual(201);
        expect(snapshot.devices[0].friendly_name).toStrictEqual("Coordinator");
        expect(snapshot.groups.length).toStrictEqual(25);
        expect(snapshot.networkMap).toBeDefined();
        expect(snapshot.networkMap.type).toStrictEqual("raw");
    });

    it("lists ZHC models", () => {
        const output = listDefinitionModels();

        expect(output.size).toBeGreaterThanOrEqual(1);
    });

    it("lists ZHC GP models", () => {
        const output = listGreenPowerDefinitionModels();

        expect(output.size).toBeGreaterThanOrEqual(1);
    });

    it("lists ZHC definition exposes", () => {
        const output = listDefinitionExposes();

        expect(output.length).toBeGreaterThanOrEqual(1);
    });

    it("lists ZHC definition options", () => {
        const output = listDefinitionOptions();

        expect(output.length).toBeGreaterThanOrEqual(1);
    });

    it("lists ZHC definition exposes categories", () => {
        const output = listDefinitionExposesCategories();

        expect(output.size).toBeGreaterThanOrEqual(1);
    });
});
