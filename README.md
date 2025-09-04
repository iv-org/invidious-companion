# Invidious companion

Companion for Invidious which handle all the video stream retrieval from YouTube servers.

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
