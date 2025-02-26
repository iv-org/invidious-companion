import { Innertube } from "youtubei.js";

function createTemporalDuration(milliseconds) {
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
    selectedCaption,
) {
    const lines: string[] = ["WEBVTT"];

    const info = await innertubeClient.getInfo(videoId);
    const transcriptInfo = await (await info.getTranscript()).selectLanguage(
        selectedCaption.name.simpleText,
    );
    const rawTranscriptLines =
        transcriptInfo.transcript.content.body.initial_segments;

    rawTranscriptLines.forEach((line) => {
        const timestampFormatOptions = {
            style: "digital",
            minutesDisplay: "always",
            fractionalDigits: 3,
        };

        const start_ms = createTemporalDuration(line.start_ms).round({
            largestUnit: "year",
        }).toLocaleString(undefined, timestampFormatOptions);
        const end_ms = createTemporalDuration(line.end_ms).round({
            largestUnit: "year",
        }).toLocaleString(undefined, timestampFormatOptions);
        const timestamp = `${start_ms} --> ${end_ms}`;

        const text = line.snippet.text.replace(
            /[&<>‍‍\u200E\u200F\u00A0]/g,
            (match) => ESCAPE_SUBSTITUTIONS[match],
        );

        lines.push(`${timestamp}\n${text}`);
    });

    return lines.join("\n\n");
}
