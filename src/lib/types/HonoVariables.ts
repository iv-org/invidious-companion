import { Innertube } from "youtubei.js";
import { BG } from "bgutils";
import type { Config } from "../helpers/config.ts";
import { Metrics } from "../helpers/metrics.ts";

export type HonoVariables = {
    innertubeClient: Innertube;
    config: Config;
    tokenMinter: BG.WebPoMinter;
    metrics: Metrics | undefined;
};
