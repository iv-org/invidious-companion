// Set to `undefined` if it's no longer in use!
//
// Old Players IDs are usually available for a few more days after Youtube
// rolls out a new Player. This is helpful when Youtube.JS is not able to
// extract the signature decipher algorithm and we need to wait for a fix
// in Youtube.JS.
export const PLAYER_ID = undefined;

// Error message shown when tokenMinter is not yet ready
export const TOKEN_MINTER_NOT_READY_MESSAGE =
    "Companion is starting. Please wait until a valid potoken is found. If this process takes too long, please consult: https://docs.invidious.io/youtube-errors-explained/#po-token-initialization-taking-too-much-time-to-complete";

// Error message shown when URL deciphering fails
export const DECIPHER_ERROR_MESSAGE =
    "Unable to decipher video URL. This may be due to YouTube changes. Please check for updates to the companion.";
