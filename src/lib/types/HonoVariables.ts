import { Innertube } from "youtubei.js";
import { BG } from "bgutils";
import type { konfigLoader } from "../helpers/konfigLoader.ts";

export type HonoVariables = {
    innertubeClient: Innertube;
    konfigStore: Awaited<ReturnType<typeof konfigLoader>>;
    tokenMinter: BG.WebPoMinter;
}
