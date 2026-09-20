// Provider-agnostic signal that a browser-backed PO token could not be
// produced (browser missing, could not launch, page failed to initialize).
// The JSDOM fallback keys on this type, so any future browser provider
// (e.g. a CDP-attached browser) should throw it too rather than a
// provider-specific error.
export class BrowserPoTokenUnavailableError extends Error {
    override name = "BrowserPoTokenUnavailableError";
}
