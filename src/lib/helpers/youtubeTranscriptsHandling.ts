import { Temporal } from "@js-temporal/polyfill";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Innertube, YTNodes } from "youtubei.js";

export type CaptionTrackData = NonNullable<
    InstanceType<typeof YTNodes.PlayerCaptionsTracklist>["caption_tracks"]
>[number];

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

function shiftVttToCenter(vtt: string): string {
    const lines = vtt.split("\n");
    const updatedLines: string[] = [];
    const timingRegex = /^((?:\d{1,2}:)?\d{2}:\d{2}\.\d{3} --> (?:\d{1,2}:)?\d{2}:\d{2}\.\d{3})(.*)$/;

    for (const line of lines) {
        const match = line.match(timingRegex);
        if (match) {
            updatedLines.push(match[1]);
        } else {
            updatedLines.push(line);
        }
    }

    return updatedLines.join("\n");
}

export async function handleTranscripts(
    innertubeClient: Innertube,
    videoId: string,
    selectedCaption: CaptionTrackData,
    poToken?: string,
    clientName?: string,
) {
    if (poToken && clientName) {
        const baseUrl = selectedCaption.base_url;
        const url = `${baseUrl}&fmt=vtt&potc=1&pot=${poToken}&c=${clientName}`;

        const urlObj = new URL(url);

        const response = await innertubeClient.session.http.fetch(urlObj, {
            method: "GET",
        });

        if (!response.ok) {
            throw new HTTPException(response.status as ContentfulStatusCode, {
                res: new Response("Failed to fetch captions."),
            });
        }

        let vttText = await response.text();

        if (!vttText.startsWith("WEBVTT")) {
            throw new HTTPException(404, {
                res: new Response("No valid captions found."),
            });
        }

        vttText = shiftVttToCenter(vttText);

        return vttText;
    } else {
        const lines: string[] = ["WEBVTT"];

        const info = await innertubeClient.getInfo(videoId);
        const transcriptInfo = await (await info.getTranscript())
            .selectLanguage(
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

            // Temporal.Duration.prototype.toLocaleString() delegates to
            // Intl.DurationFormat, which is natively available in Node.js.
            // The output is a digital-style timestamp, e.g. "1:02:03.456".

            const start_ms = createTemporalDuration(Number(line.start_ms))
                .round({
                    largestUnit: "year",
                    relativeTo: Temporal.PlainDateTime.from("2022-01-01"),
                }).toLocaleString("en-US", timestampFormatOptions);

            const end_ms = createTemporalDuration(Number(line.end_ms)).round({
                largestUnit: "year",
                relativeTo: Temporal.PlainDateTime.from("2022-01-01"),
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
}
