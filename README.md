# Invidious companion

Companion for Invidious which handle all the video stream retrieval from YouTube servers.

## Documentation
- Installation guide: https://docs.invidious.io/installation/
- Extra documentation for Invidious companion: https://github.com/iv-org/invidious-companion/wiki

### Local development

### Requirements

- [Node.js](https://nodejs.org/) >= 24

### Run Locally (development)

```
SERVER_SECRET_KEY=CHANGEME npm run dev
```

### Available tasks using npm

- `npm run dev`: Launch Invidious companion in debug mode
- `npm run test`: Test all the tests for Invidious companion
- `npm run check`: Type-check the source code
- `npm run format`: Check the code formatting
- `npm run compile`: Compile the project to standalone binaries

### Permission model

Invidious companion runs under the [Node.js permission model](https://nodejs.org/api/permissions.html):
`npm start`, the Docker image and the systemd service enable `--permission`
with an allowlist mirroring what the Deno build restricted with
`--allow-read`/`--allow-write`: read/write on the cache directory and the
Unix socket paths, plus `--allow-worker` for the PO token generator's worker
thread.

Standalone binaries cannot bake in the flags, so pass them via `NODE_OPTIONS`:

```
NODE_OPTIONS="--permission --allow-fs-read=* --allow-fs-write=/var/tmp/youtubei.js --allow-fs-write=/tmp/invidious-companion.sock --allow-fs-write=/tmp/companionsock --allow-worker --allow-addons" ./invidious_companion
```

Notes:

- Node's permission model does not gate networking or environment variables,
  so unlike Deno there is no `--allow-net` equivalent; use a container or
  systemd sandbox if network access must be restricted.
- Custom `CACHE_DIRECTORY`, `CONFIG_FILE` or socket paths outside the
  allowlist need matching `--allow-fs-*` entries.
- `npm run dev` runs without the permission model because `node --watch`
  restarts the process via `child_process`.
