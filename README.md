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
2. Briefly swipe over one dark-on-light Aztec label. A new decoded payload adds a SHA-256 hash row. Only the first 16 hex characters are displayed; deduplication uses all 64 characters of the hash of the raw bytes.
3. Watch preview FPS, scans/second, processing p50/p95, empty/successful processing times, busy frames skipped, and result counts.
4. **Pause** releases the camera. Resume retains results. Reset clears metrics and payload identities. Backgrounding the page pauses scanning; resume explicitly after returning.
5. Pause to change profile or frame size. Each setting change clears the run to avoid mixing measurements. Download the run JSON before changing settings.

All frame processing stays in the browser. No images or payloads are uploaded, and no results are persisted. Duplicate payloads still have to be decoded to recognize them. Invalid reads never become results.

## Performance approach

The default is **Capture first**, with a maximum processed frame edge of **1280 pixels**. It is a starting configuration, not a proven optimum for an unspecified phone and label. **Fast** removes the more thorough search and additional downscaled searches. Both restrict reading to one Aztec symbol and keep local-average binarization, rotation support, and error rejection enabled. Inverted-label search and denoising are disabled for the agreed label type.

The camera requests the rear lens, an ideal 60 fps, and a resolution suited to the selected processing size. These are preferences: the browser/device chooses the actual settings, shown in the UI. The entire camera image is processed without a center crop. Frames are never upscaled.

The reader-only WASM asset is bundled and served from the same GitHub Pages site. It initializes alongside camera acquisition in a dedicated worker. One frame is in flight at a time; new frames are skipped while busy, rather than queued. The main thread captures RGBA pixels and transfers their buffer. React metrics update once per second, with immediate updates only for new results and controls.

See [scanning configuration and measurement notes](docs/scanning.md) and the [agreed design](docs/scanner-plan.md).

## Deploy

The repository uses GitHub Pages with **GitHub Actions** as its source. Pushes to `main` run lint, real WASM tests, TypeScript/build checks, and Chromium/WebKit browser tests before uploading `dist` and deploying. Pull requests to `main` run the same checks without deploying. The workflow also supports manual dispatch on `main`.

The workflow uses GitHub's built-in token and OIDC; no deploy secret is needed. Vite's base path is `/find-it/`, including worker, font, and WASM asset URLs. If the repository name or hosting path changes, update `vite.config.ts`, `playwright.config.ts`, and the site links together.
