# Invidious companion

Companion for Invidious which handle all the video stream retrieval from YouTube servers.

## Requirements

- [deno](https://docs.deno.com/runtime/)  

## Documentation
- Installation guide: https://docs.invidious.io/companion-installation/
- Extra documentation for Invidious companion: https://github.com/iv-org/invidious-companion/wiki

## Run Locally (development)

```
deno task dev
```

## Running a public instance
When running a public instance, the `verify_requests` config option should be set the `true` and the server secret key should be set.

config/config.toml:
```toml
[server]
secret_key = "some-16-character-random-string"
verify_requests = true
```

This prevents requests being made to Companion that should only originate from an authorised Invidious instance.
