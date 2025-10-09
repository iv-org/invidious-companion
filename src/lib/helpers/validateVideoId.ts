/**
 * Validates a YouTube video ID format
 * YouTube video IDs are 11 characters long and contain alphanumeric characters, hyphens, and underscores
 * Reference: https://webapps.stackexchange.com/questions/54443/format-for-id-of-youtube-video
 *
 * @param videoId - The video ID to validate
 * @returns true if the video ID is valid, false otherwise
 */
export const validateVideoId = (videoId: string): boolean => {
    // Handle null, undefined, or non-string values
    if (!videoId || typeof videoId !== "string") {
        return false;
    }

    // YouTube video IDs are exactly 11 characters
    if (videoId.length !== 11) {
        return false;
    }

    // Valid characters: A-Z, a-z, 0-9, -, _
    const validPattern = /^[A-Za-z0-9_-]{11}$/;
    return validPattern.test(videoId);
};
