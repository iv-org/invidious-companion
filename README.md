# Invidious companion

Companion for Invidious which handle all the video stream retrieval from YouTube servers.

## Installation

### Pre-built binaries (Rolling Release)

Pre-built binaries are automatically generated for every commit and are available in the [`latest`](https://github.com/iv-org/invidious-companion/releases/tag/latest) release. Binaries are provided for:

- **Linux**: `x86_64` and `aarch64` (ARM64)
- **macOS**: Intel (`x86_64`) and Apple Silicon (`aarch64`) 
- **Windows**: `x86_64`

To download:
1. Visit the [`latest`](https://github.com/iv-org/invidious-companion/releases/tag/latest) release
2. Download the appropriate binary archive for your platform from the Assets section
3. Extract and run the binary

The latest builds are always available in the `latest` release and are updated automatically with each new commit.

#### Finding Old Versions

If you need a specific version built from a previous commit, you can find older versions in the GitHub Actions artifacts:

1. Go to the [Actions tab](https://github.com/iv-org/invidious-companion/actions/workflows/release-binaries.yaml)
2. Click on the workflow run for the specific commit you're interested in
3. Scroll down to the "Artifacts" section to download the binaries for that commit
4. Note that artifacts are kept for 90 days before being automatically deleted

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
