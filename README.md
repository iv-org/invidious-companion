# Invidious companion

Companion for Invidious which handle all the video stream retrieval from YouTube servers.

## Documentation
- Installation guide: https://docs.invidious.io/installation/
- Extra documentation for Invidious companion: https://github.com/iv-org/invidious-companion/wiki

### Local development

### Requirements

- [deno](https://docs.deno.com/runtime/)
- [Camoufox](https://camoufox.com/) for browser-backed PO token generation.
  The Docker image installs a pinned headless browser into the existing
  `/var/tmp/youtubei.js` volume automatically. Local development downloads it
  into the same directory on first startup.

  Companion falls back to its previous JSDOM generator when Camoufox cannot be
  installed or launched. Camoufox runs with `headless: true`; Xvfb is not used.
  The production image uses a shell-less Google Distroless runtime.

### Run Locally (development)

```
SERVER_SECRET_KEY=CHANGEME deno task dev
```

### Available tasks using deno

- `deno task dev`: Launch Invidious companion in debug mode
- `deno task compile`: Compile the project to a single file.
- `deno task test`: Test all the tests for Invidious companion
- `deno task format`: Format all the .ts files in the project.
