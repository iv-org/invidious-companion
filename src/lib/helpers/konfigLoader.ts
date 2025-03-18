import { Store } from "@willsoto/node-konfig-core";
import { FileLoader as KonfigFileLoader } from "@willsoto/node-konfig-file";
import { TOMLParser } from "@willsoto/node-konfig-toml-parser";
import { join as pathJoin } from "@std/path";
import { existsSync } from "@std/fs";

export const konfigLoader = async (): Promise<
    Store<Record<string, unknown>>
> => {
    const konfigStore = new Store();
    const konfigFilesToLoad = {
        files: [
            {
                path: pathJoin(Deno.cwd(), "config/default.toml"),
                parser: new TOMLParser(),
            },
        ],
    };

    if (existsSync(pathJoin(Deno.cwd(), "config/local.toml"))) {
        console.log("[INFO] Using custom settings local file.");
        konfigFilesToLoad.files.push({
            path: pathJoin(Deno.cwd(), "config/local.toml"),
            parser: new TOMLParser(),
        });
    }

    const konfigLoader = new KonfigFileLoader(konfigFilesToLoad);
    // @ts-ignore Safe to ignore
    konfigStore.registerLoader(konfigLoader);
    await konfigStore.init();

    return konfigStore;
};
