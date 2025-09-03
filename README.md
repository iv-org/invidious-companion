# Invidious companion

Companion for Invidious which handle all the video stream retrieval from YouTube servers.

## Requirements

- [deno](https://docs.deno.com/runtime/)  

## Binary Releases

Pre-compiled binaries are available for download from the [GitHub Releases](https://github.com/iv-org/invidious-companion/releases) page. The following platforms are supported:

- **Windows x64** (`invidious-companion-windows-x64.exe`)
- **macOS Intel** (`invidious-companion-macos-x64`)  
- **macOS Apple Silicon** (`invidious-companion-macos-arm64`)
- **Linux x64** (`invidious-companion-linux-x64`)
- **Linux ARM64** (`invidious-companion-linux-arm64`)

To use a binary release:
1. Download the appropriate binary for your platform from the releases page
2. Make it executable (on Unix-like systems): `chmod +x invidious-companion-*`
3. Run it with your configuration: `./invidious-companion-* --help`

**Note:** Binaries are automatically built and published using GitHub Actions when new tags are created. They include version information and are cross-compiled using `deno compile --target`.  

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
