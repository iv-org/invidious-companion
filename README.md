# Invidious companion

Companion for Invidious which handle all the video stream retrieval from YouTube servers.

## Installation

### Pre-built binaries (Rolling Release)

Pre-built binaries are automatically generated for every commit and are available in the [`binaries`](https://github.com/iv-org/invidious-companion/tree/binaries) branch. Binaries are provided for:

- **Linux**: `x86_64` and `aarch64` (ARM64)
- **macOS**: Intel (`x86_64`) and Apple Silicon (`aarch64`) 
- **Windows**: `x86_64`

To download:
1. Visit the [`binaries`](https://github.com/iv-org/invidious-companion/tree/binaries) branch
2. Navigate to the latest directory (organized by date and commit)
3. Download the appropriate binary archive for your platform
4. Extract and run the binary

The 20 most recent builds are kept available in the binaries branch.

### Build from source

## Requirements

- [deno](https://docs.deno.com/runtime/)  

## Documentation
- Installation guide: https://docs.invidious.io/companion-installation/
- Extra documentation for Invidious companion: https://github.com/iv-org/invidious-companion/wiki

## Run Locally (development)

```
SERVER_SECRET_KEY=CHANGEME deno task dev
```

## Available tasks using deno

- `deno task dev`: Launch Invidious companion in debug mode
- `deno task compile`: Compile the project to a single file.
- `deno task test`: Test all the tests for Invidious companion
- `deno task format`: Format all the .ts files in the project.
