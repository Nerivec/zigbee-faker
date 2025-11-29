import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import stringify from "json-stable-stringify-without-jsonify";
import zhPackageJSON from "zigbee-herdsman/package.json" with { type: "json" };
import zhcPackageJSON from "zigbee-herdsman-converters/package.json" with { type: "json" };
import z2mPackageJSON from "zigbee2mqtt/package.json" with { type: "json" };
import {
    listDefinitionExposes,
    listDefinitionExposesCategories,
    listDefinitionModels,
    listDefinitionOptions,
    listGreenPowerDefinitionModels,
    Zigbee2MQTTAPIFaker,
} from "./zigbee2mqtt.js";

const mapToMarkdown = (map: Map<string, string[]>, { title, outer, inner }: { title: string; outer: string; inner: string }): string => {
    let out = "";
    let outerCount = 0;
    let innerCount = 0;

    for (const [outerKey, inners] of map) {
        out += `- ${outerKey}\n`;
        outerCount += 1;

        for (const innerKey of inners) {
            out += `  - ${innerKey}\n`;
            innerCount += 1;
        }
    }

    return `# ${title}

${outer} count: ${outerCount}

${inner} (indented under ${outer}) count: ${innerCount}

---

${out.trimStart()}`;
};

if (!existsSync("samples")) {
    mkdirSync("samples");
}

if (!existsSync("samples/z2m")) {
    mkdirSync("samples/z2m");
}

const faker = new Zigbee2MQTTAPIFaker(1);

const snapshot = faker.snapshot();

writeFileSync("samples/z2m/devices.json", stringify(snapshot.devices, { space: 4 }), "utf8");

writeFileSync("samples/z2m/networkmap.json", stringify(snapshot.networkMap, { space: 4 }), "utf8");

const entityStates = snapshot.devices.slice(1).map((d) => ({
    state: faker.entityState(d),
    friendly_name: d.friendly_name,
}));

writeFileSync("samples/z2m/entityStates.json", stringify(entityStates, { space: 4 }), "utf8");

const entityPartialStates = snapshot.devices.slice(1).map((d) => ({
    state: faker.entityState(d, true),
    friendly_name: d.friendly_name,
}));

writeFileSync("samples/z2m/entityPartialStates.json", stringify(entityPartialStates, { space: 4 }), "utf8");

const fakeDevice2 = faker.device("Router", "GL-C-007-2ID");

writeFileSync("samples/z2m/device-bymodel.json", stringify(fakeDevice2, { space: 4 }), "utf8");

writeFileSync(
    "samples/z2m/models.md",
    mapToMarkdown(listDefinitionModels(), {
        title: "Models & whitelabels currently supported",
        outer: "Models",
        inner: "Whitelabels",
    }),
    "utf8",
);

writeFileSync(
    "samples/z2m/models-gp.md",
    mapToMarkdown(listGreenPowerDefinitionModels(), {
        title: "GreenPower models & whitelabels currently supported",
        outer: "Models",
        inner: "Whitelabels",
    }),
    "utf8",
);

const allExposes = listDefinitionExposes();

writeFileSync(
    "samples/z2m/exposes.md",
    `# Exposes by use count

Exposes count: ${allExposes.length}

---

${allExposes.join("\n")}`,
    "utf8",
);

const allOptions = listDefinitionOptions();

writeFileSync(
    "samples/z2m/options.md",
    `# Options by use count

Options count: ${allOptions.length}

---

${allOptions.join("\n")}`,
    "utf8",
);

writeFileSync(
    "samples/z2m/exposes-categories.md",
    mapToMarkdown(listDefinitionExposesCategories(), {
        title: "Categories for exposes",
        outer: "Categories",
        inner: "Exposes",
    }),
    "utf8",
);

writeFileSync("samples/z2m/versions.md", `Z2M: ${z2mPackageJSON.version} | ZHC: ${zhcPackageJSON.version} | ZH: ${zhPackageJSON.version}`, "utf8");
