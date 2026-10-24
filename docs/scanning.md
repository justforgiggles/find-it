# Scanning configuration and measurement

## Starting profiles

| Option | Capture first (default) | Fast |
| --- | --- | --- |
| formats | Aztec | Aztec |
| maxNumberOfSymbols | 1 | 1 |
| tryHarder | true | false |
| tryDownscale | true | false |
| tryRotate | true | true |
| tryInvert / tryDenoise | false / false | false / false |
| isPure / returnErrors | false / false | false / false |
| binarizer | LocalAverage | LocalAverage |
| downscaleThreshold / downscaleFactor | 500 / 3 | unused |

The initial maximum frame edge is 1280 pixels, with 640 and 1920 available for comparison. Smaller inputs reduce work but can erase fine modules on small or dense labels. Higher preview FPS cannot compensate for motion blur, poor focus, or insufficient pixels per module. The camera's ideal 60 fps request is not a guarantee of delivered sensor cadence or exposure time.

`isPure` is false because camera scenes contain background and arbitrary alignment. `returnErrors` is false, and the app also requires a valid Aztec result. This retains ZXing's error correction and decoding validity checks without adding arbitrary application-level confidence heuristics. Linear-barcode options such as `minLineCount` do not provide an Aztec confidence threshold.

ZXing exposes a combined read operation. Its internal Aztec reader detects candidates and attempts decoding; there is no public detect-only API or confidence/rejection threshold. Empty-result timing includes both searching and failed candidate decoding. Fast rejection cannot be measured separately through this API.

## What the metrics mean

- **Preview FPS:** presented-frame counter deltas over the last UI sampling interval. This is not sensor FPS. Browsers without video frame callbacks use an explicitly labelled estimate based on changed video timestamps.
- **Scans/second:** completed scan attempts over that interval. Frames arriving while busy are skipped, not queued.
- **Processing time:** starts before canvas capture and ends when the worker's result reaches the main thread. Includes capture, transfer, WASM reading, successful-payload hashing, and return delivery. Does not include the next React render or camera exposure/capture latency.
- **Decoder time:** the `readBarcodes` call in the worker, excluding frame capture and hashing. It includes detection and decoding together.
- **p50/p95:** nearest-rank percentiles, independently retaining the latest 1,000 samples per category. Counts are cumulative for the current run; sample windows are bounded.
- **Busy frames skipped:** callbacks that reached the app while a scan was in flight. This does not count every frame potentially dropped by the camera/browser before a callback.
- **Unique/duplicate/empty:** mutually exclusive outcomes of completed scans. Unique identity uses SHA-256 of raw decoded bytes. Identical payloads on distinct boxes remain one identity.
- **Startup:** permission, camera setup/playback, and concurrent decoder preparation. WASM preparation time is separately reported. Steady-state processing excludes startup.

No live metric claims to measure elapsed time since a code first became visible. That requires annotated video or another externally measured onset. A low per-frame duration alone is not evidence of a good swipe capture rate.

## Phone comparison protocol

1. Record phone model, OS/browser version, label dimensions/density, approximate distance, lighting, and whether the device is warm. Use the same conditions for each comparison.
2. Start Capture first at 1280. Allow focus and exposure to settle, then reset with the code outside the view.
3. Perform at least 20 deliberate swipes with the label completely out of view between trials. Wait for counters to settle between swipes. Any increase in unique or duplicate reads indicates a captured swipe; multiple reads during one pass still count as only one captured swipe. Count attempts and captured swipes manually.
4. Enter both counts in the Swipe test panel, pause, and download the run JSON. Do not infer swipe success from unique hashes: repeated passes over one box share a hash.
5. Repeat Fast at 1280, then the most promising profile at 640 and 1920. Alternate profile order on further runs to reduce warm-up/thermal bias.
6. Prefer the configuration with the best capture success. Compare p95, empty-result time, and throughput among configurations with similar success. Repeat with smaller/denser labels before choosing a default.
7. For acquisition-latency claims, use separately annotated repeatable footage, with the first visible/legible frame marked. This app does not yet provide annotated video replay.

Automated fixtures establish functionality, not a mobile performance optimum. A stationary, generated label does not reproduce camera exposure, rolling shutter, autofocus, lens selection, motion blur, or thermal throttling. Physical phone results remain to be collected.

## Primary references

- [ZXing WASM reader options](https://sec-ant.github.io/zxing-wasm/docs/interfaces/full.ReaderOptions.html)
- [ZXing WASM reader API](https://github.com/Sec-ant/zxing-wasm/blob/main/src/reader/index.ts)
- [ZXing WASM result bytes and validity](https://github.com/Sec-ant/zxing-wasm/blob/main/src/bindings/readResult.ts)
- [ZXing C++ Aztec reader](https://github.com/zxing-cpp/zxing-cpp/blob/master/core/src/aztec/AZReader.cpp)
- [Video frame callback timing](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)
- [Camera constraints and capabilities](https://developer.mozilla.org/en-US/docs/Web/API/Media_Capture_and_Streams_API/Constraints)
- [Vite GitHub Pages deployment](https://vite.dev/guide/static-deploy.html#github-pages)
