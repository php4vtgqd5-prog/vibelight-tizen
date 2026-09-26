# VibeLight development harness

Runs the VibeLight user interface in a desktop browser, without a TV and without
building the WebAssembly module. The harness serves the files with the layout of
the installed widget and replaces the platform parts with mocks:

- `mocks/tizen.js` provides the `tizen` and `webapis` objects of a Samsung TV.
- `mocks/moonlight-wasm.js` replaces the WebAssembly module with a simulated
  Sunshine host (`GAMING-PC` on `192.168.1.50`) and a simulated stream that
  reports statistics like the real module.

```sh
node tools/dev-harness/server.mjs --port 8080
# then open http://localhost:8080/ in Chrome, and use the arrow keys, Enter and Escape
```

The page accepts options in its query string, for example
`http://localhost:8080/?panel=fhd&network=ethernet&capacity=25`:

| Option | Default | Meaning |
| --- | --- | --- |
| `scenario` | `paired` | `paired` starts with the fake host paired, `fresh` starts with no hosts |
| `platform` | `6.5` | Tizen version reported by the TV |
| `panel` | `4k` | Panel of the TV: `fhd`, `4k` or `8k` |
| `hdr` | `1` | Whether the TV supports HDR |
| `network` | `wifi` | Active connection of the TV: `wifi` or `ethernet` |
| `signal` | `0.8` | Wi-Fi signal strength between 0 and 1 |
| `codecs` | all | Codecs the TV decoder supports, e.g. `avc1,hev1.1` |
| `hostCodecs` | all | Codecs the host encodes: `h264,hevc,hevc10,av1,av110` |
| `rtt`, `jitter` | `3`, `1` | Round-trip time and jitter of the simulated network (ms) |
| `capacity` | `80` | Throughput of the simulated network (Mbps), frames are lost above it |
| `loss` | `0` | Random frame loss of the simulated network (%) |
| `renderLimit` | `0` | Highest frame rate the simulated TV decoder renders (0 for no limit) |
| `freeze` | `0` | `1` simulates a video pipeline that stops after the first frame |
| `running` | none | Id of an app that already runs on the host, e.g. `20002` |
| `locale` | `en-US` | Language of the TV, e.g. `pl-PL` or `pt-BR` |
| `version` | `2.0.0` | Version of the installed app |

The simulated network can also change while a stream runs, from the console or a test:
`__harness.network.capacity = 10` makes it carry 10 Mbps from the next second on.

The automated UI tests (`npm run test:ui`) drive the same harness with Playwright.
