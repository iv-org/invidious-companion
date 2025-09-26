import { Innertube } from "youtubei.js";
import type { CaptionTrackData } from "youtubei.js/PlayerCaptionsTracklist";
import { HTTPException } from "hono/http-exception";

function createTemporalDuration(milliseconds: number) {
    return new Temporal.Duration(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        milliseconds,
    );
}

const ESCAPE_SUBSTITUTIONS = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\u200E": "&lrm;",
    "\u200F": "&rlm;",
    "\u00A0": "&nbsp;",
};

export async function handleTranscripts(
    innertubeClient: Innertube,
    videoId: string,
    selectedCaption: CaptionTrackData,
) {
    const lines: string[] = ["WEBVTT"];

    const info = await innertubeClient.getInfo(videoId);
    const transcriptInfo = await (await info.getTranscript()).selectLanguage(
        selectedCaption.name.text || "",
    );
    const rawTranscriptLines = transcriptInfo.transcript.content?.body
        ?.initial_segments;

    if (rawTranscriptLines == undefined) throw new HTTPException(404);

    rawTranscriptLines.forEach((line) => {
        const timestampFormatOptions = {
            style: "digital",
            minutesDisplay: "always",
            fractionalDigits: 3,
        };

        // Temporal.Duration.prototype.toLocaleString() is supposed to delegate to Intl.DurationFormat
        // which Deno does not support. However, instead of following specs and having toLocaleString return
        // the same toString() it seems to have its own implementation of Intl.DurationFormat,
        // with its options parameter type incorrectly restricted to the same as the one for Intl.DateTimeFormatOptions
        // even though they do not share the same arguments.
        //
        // The above matches the options parameter of Intl.DurationFormat, and the resulting output is as expected.
        // Until this is fixed typechecking must be disabled for the two use cases below
        //
        // See
        // https://docs.deno.com/api/web/~/Intl.DateTimeFormatOptions
        // https://docs.deno.com/api/web/~/Temporal.Duration.prototype.toLocaleString
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Duration/toLocaleString
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DurationFormat/DurationFormat

        const start_ms = createTemporalDuration(Number(line.start_ms)).round({
            largestUnit: "year",
            relativeTo: Temporal.PlainDateTime.from("2022-01-01"),
            //@ts-ignore see above
        }).toLocaleString("en-US", timestampFormatOptions);

        const end_ms = createTemporalDuration(Number(line.end_ms)).round({
            largestUnit: "year",
            relativeTo: Temporal.PlainDateTime.from("2022-01-01"),
            //@ts-ignore see above
        }).toLocaleString("en-US", timestampFormatOptions);
        const timestamp = `${start_ms} --> ${end_ms}`;

        const text = (line.snippet?.text || "").replace(
            /[&<>‍‍\u200E\u200F\u00A0]/g,
            (match: string) =>
                ESCAPE_SUBSTITUTIONS[
                    match as keyof typeof ESCAPE_SUBSTITUTIONS
                ],
        );

        lines.push(`${timestamp}\n${text}`);
    });

    return lines.join("\n\n");
}
