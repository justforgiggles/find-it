# Mobile Aztec scanner: approved distance refinement

The user approved this refinement after reviewing the local parcel examples and the trade-off between sweep speed and small-label recovery. It supersedes the original single-code, 1280-pixel swipe configuration.

- Retain React/Vite, Tailwind, standard shadcn/ui, reader-only ZXing WASM, in-memory hashes, and automatic GitHub Pages deployment.
- Camera-only operation; no photo picker or code-location overlays. Local photos are private comparison fixtures only.
- Prefer feature-detected still capture at the largest supported size within 25 MP. Normalize orientation, cap oversized captures, and show the actual source and effective dimensions. Fall back to high-resolution rear-camera video; retry still support on restart.
- Capture one scene, finish its full planned search, then capture the next. Distance recovery takes priority over fast swipe throughput.
- Search a 1920-pixel overview followed by native-resolution 1536-pixel square crops with 50% overlap and edge-aligned coverage. Do not upscale.
- Run LocalAverage and GlobalHistogram on every view, even after success. Aztec only, unlimited valid symbols, tryHarder and rotation enabled; downscaling, inversion, and denoising disabled.
- Publish results incrementally, hash raw decoded bytes, deduplicate overlapping passes within each scene, and count at most one duplicate per payload in each later scene.
- Keep one search in flight in a worker. Release scene resources on completion; cancel on pause, reset, backgrounding, or configuration changes and reject stale acquisition/results.
- Advanced controls: crop sizes 768/1024/1536/2048 and overlap 25/50/75%. Require pause, and start a fresh run when changing them.
- Report capture source/dimensions/duration, progress, completed sweeps, decoder calls, first-result and sweep duration, unique/duplicate counts, preview FPS, and JSON export. Distinguish decoder-call timing from scene timing.
- Test multiple labels, edges, rotations, overlap, repeated payloads, small/portrait sources, still/video fallback, cancellation and restarts. Public CI uses generated fixtures. Run the real examples locally and preserve unresolved cases.

Acceptance is measured recovery, not a promise to decode every blurred label. Cropping preserves source pixels; it cannot reconstruct missing detail. Identical payloads on two boxes still produce one row. Physical phone performance remains a hardware measurement task.
