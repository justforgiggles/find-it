# Scanning configuration and measurement

## Distance-first search

A scene is one fixed capture. The app prefers `ImageCapture.takePhoto`, requests the largest reported still dimensions within 25 million pixels, and uses orientation-aware image decoding. If a camera returns a larger image, it is resized once to the budget; original and effective dimensions are reported. Camera capability ranges do not guarantee that a particular width/height combination is available. A failed still capture switches to video for that camera run; restart retries still capture. Capability-query failure alone still permits the camera's default photo capture.

The preview requests the rear camera, ideal 4096 × 3072 video, and ideal 30 FPS. These are preferences. Video fallback uses the actual delivered frame size. Runtime feature detection is used on every camera restart; browser name is not a capability check. Still photos may briefly interrupt the preview.

Each scene is searched in this order:

1. Overview with longest edge at most 1920 pixels, preserving aspect ratio.
2. Native-resolution crops, initially 1536 × 1536 with 50% overlap. The last crop in each row/column aligns to the scene edge. Smaller/narrower scenes use their available dimensions.
3. For each view, run both LocalAverage and GlobalHistogram, even if the first pass succeeds. No synthetic upscaling is applied.

| Reader option | Value |
| --- | --- |
| formats | Aztec only |
| maxNumberOfSymbols | 0 (unlimited) |
| tryHarder / tryRotate | true / true |
| tryDownscale | false |
| tryInvert / tryDenoise | false / false |
| isPure / returnErrors | false / false |
| binarizer | LocalAverage, then GlobalHistogram |

Only valid Aztec results are accepted. SHA-256 is computed from raw bytes, not converted text. All hashes are retained for session identity; the UI displays the first 16 hex characters. Identical payloads on different boxes remain one row. Repeated hits from overlapping crops or alternate binarizers are collapsed within the scene; at most one duplicate per payload is counted in each later scene.

The reader exposes combined detection and decoding, with no public detect-only operation or configurable Aztec confidence threshold. Empty calls include searching and attempted decoding. The validity check uses ZXing's decoding/error correction outcome, not an application confidence score.

## Scheduling and resource lifetime

One scene is acquired and transferred as an ImageBitmap to a dedicated worker. The worker searches the overview first, then draws the native source once into a CPU-backed canvas and closes the transferred bitmap. It retains that source while reusing a bounded crop canvas, and searches one image buffer at a time. It emits each pass's results and progress, yields between calls, and releases both canvases at completion. The next scene starts only after all passes complete. WASM may retain its allocated memory for reuse until the worker terminates.

Pause, reset, backgrounding, and configuration changes terminate the worker and release camera tracks. Late acquisitions close their images; old worker messages cannot update a new run. A pending photo request on an old, stopped camera does not block starting a new camera. Reset leaves the app paused. Resume after a normal pause retains previously found identities. Settings require pause and clear the run.

The decoder watchdog measures a single call's lack of progress (30 seconds), not the full sweep. A separate 45-second acquisition watchdog reports a stalled camera. Large or heavily overlapping searches can legitimately take seconds; they do not queue newer scenes.

## Metrics

- **Capture source / dimensions:** actual still or video source and effective pixel dimensions. Original capture dimensions appear under camera details.
- **Capture duration:** time spent acquiring, orientation-decoding, and applying the pixel budget.
- **Search progress:** completed decoder passes versus planned passes, with overview/crop and binarizer shown.
- **Completed sweeps / sweeps per second:** fully searched scenes, and their completion rate over the last sampling interval. Canceled scenes do not count as complete.
- **Decoder calls / decoder call p50:** calls completed, and time inside `readBarcodes`, excluding image preparation and hashing.
- **First result:** time from starting scene acquisition to receiving the first decoded payload, including a previously seen payload. The main panel shows the last completed sweep's first-result time; empty sweeps show no value. Export also includes current-scene timing.
- **Sweep duration / p50 / p95:** acquisition start through receipt of full completion, including copying, crop preparation, hashing, round trips, and yields. Percentiles retain the latest 1,000 completed sweeps or decoder calls, independently.
- **Unique / duplicate / empty:** unique payloads for this run; payloads seen again in later scenes; and completed scenes with no results. These are different units and do not sum to decoder calls.
- **Preview FPS:** presented-frame counter deltas. Without video-frame callbacks, changed video timestamps provide an explicitly labelled estimate. Neither is sensor FPS.
- **Startup:** permission, camera setup/playback, and concurrent WASM preparation. Decoder startup is reported separately.

None of these timings measures when a label first entered view, sensor exposure latency, or time to rendered pixels. A quick decoder call is not evidence of a successful swipe. JSON exports include settings, progress, current and last completed scene timings, hashes, and optional manually counted swipe results.

## Local photo comparison

Real parcel photos remain outside version control. Convert HEIC originals locally to orientation-preserving PNG or JPEG files named `IMG_*.png` or `IMG_*.jpg`, then run:

```sh
LOCAL_PHOTOS=/absolute/path/to/converted-photos npm run benchmark:photos
```

Optional `LOCAL_PHOTO_FILTER=2283`, `CROP_SIZE=2048`, and `CROP_OVERLAP=0.75` select a file or compare the available settings. Each invocation replaces the local report.

The separate local-only browser harness compares the former 1280-pixel Capture first configuration against the production distance pipeline. It writes only counts, hashes, settings, and timings to ignored `local-results/photos.json`. It disables screenshots, video, and tracing, and does not run in public CI. The app has no image-upload or photo-picker UI.

The prior exploratory study recovered at least one payload in five of the six examples using native 1536-pixel crops and GlobalHistogram, compared with one example at the former 1280-pixel default. No studied real photo yielded two readable payloads; generated fixtures verify simultaneous multi-code decoding. The difficult wide photos contain labels whose missing detail cannot be reconstructed by cropping. Whole-native GlobalHistogram also recovered those five examples: cropping has not demonstrated better recall than the best whole-native alternative on this set. Its purpose here is preserving source detail while keeping each decoder job bounded.

See the recorded production comparison in [photo comparison results](photo-comparison.md). All desktop timings are observations, not phone latency guarantees.

## Phone trials

1. Record phone/OS/browser, source and actual dimensions, distance, label size/density, light, focus, and device temperature.
2. Begin with 1536-pixel crops and 50% overlap. Let exposure/focus settle. Reset and resume before each run.
3. Hold the same boxes in view for complete sweeps. Record how many known distinct payloads are recovered, first-result time, full-sweep time, and fallback behavior. Include labels near view edges and of different sizes.
4. Pause and export JSON before changing settings. Compare 1024/1536/2048-pixel crops, then overlap, changing one variable at a time and alternating run order to reduce thermal bias.
5. For swipe trials, count attempted/captured swipes manually. A sweep searches an earlier fixed capture, so allow it to finish before attributing its results to a swipe. Repeated payloads can still count as captured trials. Distance-first scanning intentionally trades sampling frequency for more thorough scene search.
6. Use independently annotated footage or an externally measured onset for code-entry-to-result latency claims.

Generated tests cover the real worker/WASM pipeline in Chromium and WebKit, not exposure, autofocus, lens choice, rolling shutter, thermal throttling, or device memory limits. Physical iPhone and Android testing remains necessary before claiming an optimal configuration.

## Primary references

- [ZXing WASM reader options](https://sec-ant.github.io/zxing-wasm/docs/interfaces/full.ReaderOptions.html)
- [ZXing WASM reader API](https://github.com/Sec-ant/zxing-wasm/blob/main/src/reader/index.ts)
- [ZXing WASM result bytes and validity](https://github.com/Sec-ant/zxing-wasm/blob/main/src/bindings/readResult.ts)
- [ZXing C++ Aztec reader](https://github.com/zxing-cpp/zxing-cpp/blob/master/core/src/aztec/AZReader.cpp)
- [MediaStream Image Capture specification](https://w3c.github.io/mediacapture-image/)
- [Camera constraints and capabilities](https://developer.mozilla.org/en-US/docs/Web/API/Media_Capture_and_Streams_API/Constraints)
- [ImageCapture browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/ImageCapture.json)
- [Video frame callback timing](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)
