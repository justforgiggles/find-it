# Local production photo comparison

Measured on 2026-10-24 in desktop Chromium using the production worker and a mocked still camera serving the locally converted original photos. No photo or raw payload is committed. The six orientation-tagged PNGs decode to 4284 × 5712 pixels (24.47 MP).

Baseline: the previous Capture first reader configuration after browser downscaling to a 1280-pixel longest edge. Distance: 1920-pixel overview plus 35 native 1536-pixel crops, 50% overlap, both binarizers on every view (72 calls per scene).

| Local example | Baseline payload count | Distance payload count | First result, ms | Full sweep, ms |
| --- | ---: | ---: | ---: | ---: |
| IMG_2282 | 0 | 0 | — | 2637 |
| IMG_2283 | 0 | 0 | — | 2620 |
| IMG_2284 | 1 | 1 | 716 | 2612 |
| IMG_2285 | 0 | 1 | 2026 | 2634 |
| IMG_2286 | 0 | 1 | 2029 | 2618 |
| IMG_2287 | 1 | 1 | 1869 | 2676 |

The production path recovers a payload in **four of six** examples versus **two of six** with the former default. Both baseline identities are preserved. No real example yields two readable payloads. The generated 24 MP browser fixture separately proves two-code recovery: the overview reads the large code, and native crops recover the small second code missed by both overview passes.

**Unresolved:** IMG_2282 and IMG_2283 remain unreadable in this browser pipeline. Increasing IMG_2283 to 2048-pixel crops at 50% overlap also yielded no result. Cropping is not a guarantee for blurred, low-contrast, or undersampled labels.

The earlier exploratory raw-raster script recovered five examples with native GlobalHistogram, including IMG_2283, and only one at 1280. It processed stored landscape pixels; the production path uses browser decoding, orientation normalization, and canvas sampling. Those observations are separate experiments and must not be reported as the production result. The specific cause of the IMG_2283 difference has not been isolated.

Reusing a CPU-backed source canvas reduced the observed full sweep from approximately 3.4 seconds to 2.6 seconds in this environment. The overview is published before that full-source preparation so its results can appear sooner. These are single desktop observations, not controlled performance distributions or phone guarantees. Photo acquisition here includes local fixture delivery and PNG decoding, not a physical camera exposure. Baseline decoder-call timing and complete-sweep timing measure different work and should not be compared as equivalent latency.

Reproduce with `LOCAL_PHOTOS=/absolute/path/to/converted-photos npm run benchmark:photos`. The ignored local JSON report includes full hashes, exact timings, actual dimensions, and settings. Physical phone testing remains outstanding.
