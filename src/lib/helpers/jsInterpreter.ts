import { Platform, Types } from "youtubei.js";

// https://ytjs.dev/guide/getting-started.html#providing-a-custom-javascript-interpreter
// deno-lint-ignore require-await
export const jsInterpreter = Platform.shim.eval = async (
    data: Types.BuildScriptResult,
    env: Record<string, Types.VMPrimative>,
) => {
    const properties = [];

    if (env.n) {
        properties.push(`n: exportedVars.nFunction("${env.n}")`);
    }

    if (env.sig) {
        properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);
    }

    const code = `${data.output}\nreturn { ${properties.join(", ")} }`;

    return new Function(code)();
};
