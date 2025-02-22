import { Innertube } from "youtubei.js";
import type { konfigLoader } from "../helpers/konfigLoader.ts";

export type HonoVariables = {
    innertubeClient: Innertube;
    konfigStore: Awaited<ReturnType<typeof konfigLoader>>;
};
