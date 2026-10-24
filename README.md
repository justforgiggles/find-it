# Find it

A mobile Aztec scanner built with the Vite React TypeScript CLI template, Tailwind CSS, standard shadcn/ui components, and ZXing WASM.

[Open the scanner](https://justforgiggles.github.io/find-it/) · [GitHub Actions](https://github.com/justforgiggles/find-it/actions)

## Run locally

Use Node 22.12+ (the project and CI use Node 22).

```sh
npm ci
npm run dev
```

Open the `/find-it/` URL printed by Vite. Camera access works on localhost or HTTPS. A plain HTTP LAN address on a phone does not qualify; use the deployed HTTPS site for phone testing.

```sh
npm run lint
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

Browser tests start a dedicated preview server on port 4189. They use generated Aztec images in a synthetic camera stream but run the real production worker and WASM decoder. WebKit coverage is useful for Safari compatibility; it does not replace physical iPhone testing.

## Use

1. Open the page and allow the rear camera. Use **Start / Retry** if permission or playback needs a gesture.
2. Hold the camera toward the boxes. The scanner searches each captured scene for multiple dark-on-light Aztec labels, including overlapping crops for smaller distant labels. Results appear incrementally as hash rows.
3. Watch capture source/dimensions, crop progress, completed sweeps, first-result and sweep duration, decoder calls, preview FPS, and unique/duplicate counts.
4. **Pause** releases the camera. Resume retains results. **Reset run** cancels the current scene, clears metrics and identities, and leaves the camera paused. Backgrounding also pauses; resume explicitly on return.
5. Pause to change crop size or overlap under Advanced search settings. Changes clear the run. Download the run JSON first if you want to retain measurements.

All image processing stays in the browser. No images or payloads are uploaded, and no results are persisted. Deduplication uses the full SHA-256 of decoded bytes; the UI shows its first 16 hex characters. Two boxes with identical payloads produce one row. Overlapping crop hits count only once within a scene, and at most one duplicate per payload is counted in each later scene.

## Performance approach

The default prefers a high-resolution still photo up to **25 MP**, with runtime-detected video fallback. It searches a **1920-pixel overview**, then **1536-pixel native crops at 50% overlap**, running LocalAverage and GlobalHistogram on every view. Aztec-only reading accepts all valid symbols, enables thorough search and rotation, and disables internal downscaling, inversion, and denoising. Crops are never synthetically upscaled.

Distance recovery now takes priority over brief-swipe throughput. One captured scene is searched completely before the next capture. A worker performs decoder calls, publishes incremental results, and releases scene resources when finished. Pause/reset/backgrounding cancel work and reject stale results. Still capture can briefly interrupt preview. Actual source dimensions and camera settings are shown; hardware capabilities vary.

These settings are a measured starting point for the supplied examples, not a proven phone optimum. Cropping cannot restore detail lost to blur or insufficient source pixels. Real examples are kept local and excluded from public CI; the local-only comparison harness is documented below.

See [scanning configuration and measurement notes](docs/scanning.md) and the [agreed design](docs/scanner-plan.md).

## Deploy

The repository uses GitHub Pages with **GitHub Actions** as its source. Pushes to `main` run lint, real WASM tests, TypeScript/build checks, and Chromium/WebKit browser tests before uploading `dist` and deploying. Pull requests to `main` run the same checks without deploying. The workflow also supports manual dispatch on `main`.

The workflow uses GitHub's built-in token and OIDC; no deploy secret is needed. Vite's base path is `/find-it/`, including worker, font, and WASM asset URLs. If the repository name or hosting path changes, update `vite.config.ts`, `playwright.config.ts`, and the site links together.
