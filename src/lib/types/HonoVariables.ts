import { Innertube } from "youtubei.js";
import type { Config } from "../helpers/config.ts";
import { Metrics } from "../helpers/metrics.ts";
import type { TokenMinter } from "../jobs/potoken.ts";

export type HonoVariables = {
    innertubeClient: Innertube;
    config: Config;
    tokenMinter: TokenMinter | undefined;
    metrics: Metrics | undefined;
};
