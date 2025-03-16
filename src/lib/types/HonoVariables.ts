import { Innertube } from "youtubei.js";
import { BG } from "bgutils";
import type { Config } from "../helpers/config.ts";

export type HonoVariables = {
    innertubeClient: Innertube;
    config: Config;
    tokenMinter: BG.WebPoMinter;
};
