# Mobile Aztec scanner

## Confirmed requirements

- Scaffold React with TypeScript using the Vite CLI; use Tailwind and standard shadcn/ui components without custom visual styling.
- Support iPhone Safari and Android Chrome. The actual first test phone and browser remain unspecified.
- Request camera access when the page opens and show the camera preview for scanning.
- Read Aztec codes only using ZXing WASM.
- Optimize successful captures during brief camera swipes over boxes first, then reduce processing latency.
- Start with ordinary dark-on-light printed labels. Printed size, payload density, and representative test specimens remain unspecified.
- Identify results by decoded contents: identical payloads on separate boxes count as one unique result.
- Show one hash row per unique payload, retaining results in memory until refresh or explicit reset. Repeated decoding is allowed; duplicate list entries are suppressed.
- Configure the existing GitHub repository, justforgiggles/find-it, for public GitHub Pages hosting. Automatically deploy pushes to its default branch; run build checks for pull requests.

## Research constraints

- The public ZXing WASM reader combines detection and decoding in `readBarcodes`; it has no separate detection-only API or configurable confidence threshold. Its underlying Aztec implementation detects candidates and then decodes them.
- Search settings trade processing cost against capture reliability. An optimal configuration cannot be claimed without measurements on representative phones and labels.
- Payload deduplication occurs after decoding. Raw decoded bytes are available for hashing without text conversion.
- Preview frame rate, processing throughput, and processing duration measure different things. Processing duration does not establish elapsed time from a label first becoming visible.

Sources: [reader API](https://github.com/Sec-ant/zxing-wasm/blob/main/src/reader/index.ts), [Aztec implementation](https://github.com/zxing-cpp/zxing-cpp/blob/master/core/src/aztec/AZReader.cpp), [reader options](https://sec-ant.github.io/zxing-wasm/docs/interfaces/full.ReaderOptions.html), [result contract](https://github.com/Sec-ant/zxing-wasm/blob/main/src/bindings/readResult.ts), [video frame callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).

## Confirmed implementation design

The user accepted the final recommendations and instructed implementation.

- Stop after one valid Aztec result per frame.
- Use a capture-oriented default profile, a faster comparison profile, and a maximum frame-edge selector.
- Decode in a worker with one scan in flight and no stale-frame queue.
- Report preview FPS, scan throughput, processing p50/p95, empty/successful processing, skipped frames, and unique/duplicate counts.
- Keep swipe success separate from unique payload counts. Record attempted and captured swipes manually so repeated passes over the same box remain meaningful trials.
- Request the rear camera on opening, with explicit retry, pause/resume, reset, and feedback only for new payloads.
- Use the standard component appearance with a mobile-first camera preview and compact metrics/results.

Actual phone/browser, label dimensions, and real swipe measurements remain open test conditions, not implementation blockers. Routine, reversible implementation choices do not warrant architectural decision records.
