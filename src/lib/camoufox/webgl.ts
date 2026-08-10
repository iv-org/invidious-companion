// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Derived from https://github.com/apify/camoufox-js/blob/master/src/webgl/sample.ts

import { fromFileUrl } from "@std/path";
import { DatabaseSync } from "node:sqlite";

interface WebGLRow {
    data: string;
    weight: number;
}

export function sampleWebGL(
    operatingSystem: "lin" | "mac" | "win",
): Record<string, unknown> & { webGl2Enabled?: boolean } {
    const packageUrl = import.meta.resolve("camoufox-js");
    const databasePath = fromFileUrl(
        new URL("./data-files/webgl_data.db", packageUrl),
    );
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        const rows = database.prepare(
            `SELECT data, ${operatingSystem} AS weight FROM webgl_fingerprints WHERE ${operatingSystem} > 0`,
        ).all() as unknown as WebGLRow[];
        if (rows.length === 0) {
            throw new Error(
                `No WebGL fingerprints found for ${operatingSystem}`,
            );
        }

        const threshold = Math.random() * rows.reduce(
            (sum, row) => sum + row.weight,
            0,
        );
        let cumulativeWeight = 0;
        for (const row of rows) {
            cumulativeWeight += row.weight;
            if (cumulativeWeight >= threshold) return JSON.parse(row.data);
        }
        return JSON.parse(rows.at(-1)!.data);
    } finally {
        database.close();
    }
}
