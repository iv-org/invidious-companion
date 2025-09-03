# Invidious companion

Companion for Invidious which handle all the video stream retrieval from YouTube servers.

## Installation

### Pre-built binaries

Pre-built binaries are available for download from the [GitHub Releases](https://github.com/iv-org/invidious-companion/releases) page. Binaries are provided for:

- **Linux**: `x86_64` and `aarch64` (ARM64)
- **macOS**: Intel (`x86_64`) and Apple Silicon (`aarch64`) 
- **Windows**: `x86_64`

Download the appropriate binary for your platform, extract it, and run it directly.

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
