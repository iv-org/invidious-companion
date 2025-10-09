import { Innertube } from "youtubei.js";
import type { TokenMinter } from "../jobs/potoken.ts";
import type { Config } from "../helpers/config.ts";
import { Metrics } from "../helpers/metrics.ts";

export type HonoVariables = {
    innertubeClient: Innertube;
    config: Config;
    tokenMinter: TokenMinter | undefined;
    metrics: Metrics | undefined;
};
