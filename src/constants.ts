// PLAYER_ID is now fully configurable via the configuration system (recommended).
// Set via environment variable YOUTUBE_SESSION_PLAYER_ID or in config.toml under
// [youtube_session]
// player_id = "your-player-id-here"
//
// Old Player IDs are usually available for a few more days after YouTube
// rolls out a new Player. This is helpful when youtubei.js is not able to
// extract the signature decipher algorithm and we need to wait for a fix
// in youtubei.js.

export const TOKEN_MINTER_NOT_READY_MESSAGE =
    "Companion is starting. Please wait until a valid potoken is found. If this process takes too long, please consult: https://docs.invidious.io/youtube-errors-explained/#po-token-initialization-taking-too-much-time-to-complete";
