# Implementation Log

This log records completed phases, verification evidence, limitations, and outstanding risks. It must be updated at each phase gate.

## Phase 0 — Repository and architecture

**Status:** Complete

### Major decisions

- npm-workspaces monorepo with separate `web`, `core`, `ui`, and `config` packages.
- Strict TypeScript contracts isolate marketplace rules from the processing pipeline.
- Canonical crop geometry uses PDF points with a bottom-left origin.
- Final label dimensions are fixed at 100 mm × 150 mm using exact point conversion.
- PDF previews are explicitly separated from future PDF-native output.

### Tests and verification

- Coordinate transform and exact target-dimension unit tests.
- Processing-state transition and event projection tests.
- Typecheck, ESLint, Prettier, Vitest, and Next.js production build passed.

### Limitations and risks

- No marketplace rules or real layout fingerprints were introduced in Phase 0.

## Phase 1 — Client PDF engine

**Status:** Complete

### Major decisions

- PDF magic-byte validation is authoritative; filename and MIME are not trusted.
- Files remain local in browser memory.
- PDF.js enumerates pages, metadata, text-object presence, geometry, and low-resolution previews.
- Page/document failures are isolated and recorded as append-only processing events.
- Preview object URLs are revoked when pages or batches are discarded.

### Tests and verification

- Mixed file-entry UI behavior and accessible progress primitives.
- Valid PDF signature, renamed non-PDF, and empty-file validation.
- 16 automated tests passed across 7 test files.
- Typecheck, ESLint, Prettier, and optimized Next.js production build passed.

### Limitations and risks

- Browser/E2E verification was deferred by user request during the original Phase 1 acceptance; it is required from Phase 2 onward.
- Classification, extraction, normalization, validation, review, assembly, and printing are not simulated.

## Phase 2 — Flipkart adapter

**Status:** Complete

### Fixture audit

The authorized local fixture set contains:

- 3 Flipkart PDFs / 10 A4 shipping-label-plus-invoice pages
- 2 byte-identical Amazon PDFs / 2 pages each
- 3 Meesho-style `Sub_Order_Labels` PDFs / 1 page each

### Major decisions

- Flipkart identification requires the primary E-Kart anchor plus multiple independent address, AWB, SKU, and footer signals.
- Page classification is independent and recognizes shipping-plus-invoice pages.
- The confirmed `flipkart/a4-ekart-tax-invoice/v1` fingerprint measures A4 dimensions and stable anchor coordinates.
- The crop bottom is derived from the measured gap between `Not for resale` and `Tax Invoice`; it is not a page-percentage crop.
- Fingerprint drift lowers confidence and requires review.
- Unknown layouts use `GenericAdapter`, retaining the full page for review instead of silently discarding it.
- Real fixture PDFs remain Git-ignored because they contain shipping PII; non-PII hashes and expectations live in manifests.

### Tests and verification

- Golden tests verified 5-page, 2-page, and 3-page Flipkart PDFs.
- 10 source pages produced exactly 10 printable regions and excluded 10 invoice regions.
- Crop coordinates matched the confirmed fixture envelope within 1 PDF point.
- Layout-drift and invoice-only false-positive regression tests passed.
- Chromium E2E verified real five-page upload, live CLASSIFY/EXTRACT evidence, five discovered labels, and isolation of one invalid PDF.

### Limitations and risks

- The current fingerprint covers one observed Flipkart layout family. New revisions must enter review until a new fixture-backed fingerprint is added.
- PDF-native normalization and barcode validation begin in Phases 5 and 6 respectively.

## Phase 3 — Amazon adapter

**Status:** Complete

### Major decisions

- Supplier invoice pages are identified from `Triplicate for Supplier` plus invoice-title evidence and are excluded independently of page number.
- Image-native Amazon label pages are classified from nonblank raster evidence and the surrounding document signature; the adapter does not assume a permanent two-page format.
- Preview-only pixel analysis measures meaningful visual bounds and adds a safety margin. It is detection evidence only and does not become final output.
- The confirmed `amazon/a4-raster-label-with-supplier-invoice/v1` fingerprint accepts any ordering/count containing the supported raster-label and supplier-invoice page families.
- PDF.js JBIG2/OpenJPEG/QCMS WASM assets are self-hosted so image-native fixtures work without a third-party service.

### Tests and verification

- Golden tests processed both authorized fixtures: two source pages produced one shipping label and excluded one supplier invoice in each file.
- Reordered-page regression verifies classification is evidence-based rather than page-index based.
- Raster whitespace tests verify padding and isolated-noise suppression.
- 26 tests passed across 10 test files; formatting, typecheck, lint, and production build passed.
- Chromium E2E verified JBIG2 label rendering, Amazon classification, one discovered label, zero review items, and supplier-invoice exclusion.

### Limitations and risks

- The two supplied Amazon files are byte-identical, so they validate one real layout family rather than two variants.
- A standalone raster-only Amazon label without textual document context remains conservative until OCR/barcode validation or another fixture-backed fingerprint can identify it.
- PDF-native normalization and barcode/QR validation remain Phase 5 and Phase 6 work.

## Phase 4 — Meesho adapter

**Status:** Complete

### Major decisions

- Meesho detection uses the stable Sub Order section structure and coordinates because the supplied exports do not print a Meesho wordmark.
- The versioned `meesho/a4-sub-order-label-invoice/v1` fingerprint covers the supplied XpressBees, Valmo, and Delhivery variants.
- Each page is classified independently as one package label whose recipient invoice content is retained.
- Meaningful raster content bounds remove bottom/outer whitespace; a five-point safety margin protects borders and machine-readable regions.
- Missing visual bounds or fingerprint drift routes the label to review rather than silently using a stale crop.

### Tests and verification

- Golden tests processed all three supplied carrier variants, producing exactly three labels from three source pages.
- Crop-tolerance assertions verify full-width content retention and removal of the large trailing blank area.
- Layout-drift regression verifies manual-review routing.
- 30 tests passed across 11 test files; formatting, typecheck, lint, and production build passed.
- Chromium E2E processed a Flipkart/Amazon/Meesho batch in one drop: 3 PDFs, 8 source pages, 7 discovered labels, and zero failures/review items.

### Limitations and risks

- Marketplace attribution relies on the confirmed layout fingerprint because the samples contain no explicit Meesho brand text.
- Other Meesho export families enter review until represented by a real fixture and fingerprint version.
- Final native PDF normalization begins in Phase 5.

## Phase 5 — PDF-native normalization and assembly

**Status:** Complete

### Major decisions

- Final output uses `pdf-lib` page embedding with a native bounding box; preview canvases never enter the output PDF.
- Every normalized page uses the exact 100 mm × 150 mm point dimensions and portrait orientation.
- Cropped content is aspect-fit and centered at the largest safe scale without distortion.
- Output order is deterministic: upload order, source page order, then region order. Failed labels preserve their order slot without stopping later labels.
- `PRINT_READY_LABELS.pdf` includes only ready labels; review/failed records remain available separately.
- The shared event stream now exposes clickable NORMALIZE, ASSEMBLE, and COMPLETE stages.

### Tests and verification

- Synthetic operator regression confirms vector/text input remains vector/text and produces no screenshot image operator.
- Real representative Flipkart, Amazon, and Meesho fixtures each normalized to one exact 100 × 150 mm page and assembled into a three-page combined PDF.
- 34 tests passed across 13 test files; formatting, typecheck, lint, and production build passed.
- Chromium E2E normalized a real three-marketplace batch and assembled exactly seven native pages from seven discovered shipments.

### Limitations and risks

- Source pages with non-zero PDF rotation enter the recoverable failure/review path until Phase 7 supplies an explicit manual rotation.
- Barcode/QR validation of 203 DPI renders begins in Phase 6.

## Phase 6 — Barcode/QR validation and confidence

**Status:** Complete

### Major decisions

- Each normalized page is rendered temporarily at 203 DPI and decoded locally with pinned ZXing support for Code 128, QR, Data Matrix, and PDF417.
- Targeted full/half/quadrant scans keep decoding bounded while finding small codes; payloads are persisted only as SHA-256 hashes.
- The evidence score has explicit weights for marketplace anchors, page type, geometry, expected text, crop boundaries, barcode detect/decode, QR detect/decode, clipping safety, and layout fingerprint.
- Mandatory dimension, marketplace code-policy, and clipping checks cannot be overridden by aggregate confidence.
- Clipping evidence triggers one bounded native crop-margin retry; remaining uncertainty routes to review.
- Duplicate candidates are retained and warned using decoded-payload hashes or exact source-document/page fingerprints.

### Tests and verification

- QR decode/hash, clipping evidence, confidence weighting, mandatory-check, and review-routing unit tests passed.
- The required native quality regression confirmed a payload decodable from each representative original Flipkart, Amazon, and Meesho crop remains decodable after native normalization and 203 DPI rendering.
- 42 tests passed across 16 test files; formatting, typecheck, lint, and production build passed.
- Chromium E2E verified the real mixed batch validates and remains seven pages, and that two byte-identical Amazon documents remain two ready labels with an explicit duplicate warning.

### Limitations and risks

- Detection is intentionally limited to the code families observed or expected in shipping workflows; another symbology enters review.
- Only payload hashes, not raw customer/tracking payloads, are retained in application state.
- Manual resolution of review items begins in Phase 7.

## Phase 7 — Manual review and crop editor

**Status:** Complete

### Major decisions

- Review uses the source-page preview only for interaction; crop changes are converted to PDF points and re-embedded from the original PDF.
- The editor supports pointer drag, lower-right resize, 0/90/180/270-degree output rotation, and technical crop/validation readouts.
- Re-detect reruns native normalization and the same 203 DPI deterministic validation path.
- Explicit approval is recorded as manual evidence and rebuilds the ready combined PDF; skip removes only that label from assembly.
- A review label can be downloaded individually before approval.

### Tests and verification

- Chromium E2E generated an unknown real PDF in memory, verified review routing, resized the crop with a real pointer gesture, rotated it, downloaded the single label, re-detected, approved, and rebuilt a one-page combined PDF.
- A second Chromium path verified skip clears the review item without creating a failure or affecting the batch.
- 42 tests passed across 16 test files; formatting, typecheck, lint, and production build passed.

### Limitations and risks

- The crop editor exposes one resize handle rather than eight directional handles; it still supports arbitrary position and size changes.
- Manual approval is intentionally explicit and can override deterministic uncertainty; the evidence trail records that fact.

## Phase 8 — Preview, Download, and Print All

**Status:** Complete

### Major decisions

- The final-batch panel reports uploaded PDFs, source pages, discovered labels, ready labels, review items, and isolated failures from the canonical batch counters.
- Thumbnail and compact list views preserve deterministic output order and expose marketplace, source page, validation status, decoded-code count, and duplicate warnings.
- Preview and Download use the assembled native `PRINT_READY_LABELS.pdf` object URL; no preview canvas or screenshot is substituted into the output.
- Print All opens that same combined PDF in the browser/OS print flow and never attempts silent device or USB access.
- Combined-PDF object URLs are revoked when replaced or when the batch is disposed.

### Tests and verification

- Chromium E2E processed a real three-marketplace batch, opened the combined preview, downloaded the PDF, and verified seven exact 100 x 150 mm pages with `pdf-lib`.
- The same browser test stubbed a real popup-window boundary and verified Print All invokes focus and print on the combined-PDF URL.
- 42 tests passed across 16 test files; formatting, typecheck, lint, and production build passed.

### Limitations and risks

- Browser PDF preview rendering and print-dialog presentation remain browser/OS controlled.
- Popup blocking is surfaced to the user and requires normal browser permission rather than an unsafe silent-print workaround.

## Phase 9 — Server fallback and scalable local infrastructure

**Status:** Complete

### Major decisions

- FastAPI remains a fallback boundary; the complete known-marketplace workflow stays browser-local by default.
- PostgreSQL stores batch/document/event/layout metadata only. A standard SQLAlchemy URL supports local PostgreSQL by default and optional Neon without changing business logic.
- Celery uses self-hosted Valkey with bounded concurrency, late acknowledgement, one-task prefetch, hard/soft time limits, and periodic TTL cleanup.
- `LocalTempStorage` is the no-credential default. The optional ImageKit provider uses private uploads and a shared local worker mirror; missing credentials select local storage instead of preventing boot.
- API and worker containers run as UID/GID 1001 with read-only root filesystems. A one-shot initializer grants that identity access only to the private named storage volume.
- Caddy exposes one local origin, routing only API/health/docs paths to FastAPI and all other paths to Next.js.
- Server events serialize to the same `ProcessingEvent` field names and stages used by browser-local processing.

### Tests and verification

- Nine backend tests cover optional-provider boot, local/Neon selection, ImageKit disablement, magic/MIME/size checks, filename sanitization, private random storage keys, event privacy, page limits, and isolated malformed-PDF handling.
- Ruff lint and formatting checks passed for all backend source/tests.
- Chromium E2E created a server batch through Caddy, uploaded a PDF, and verified PostgreSQL metadata, private storage, Valkey delivery, Celery parsing, page count, and shared event stages.
- `docker compose up --build -d` built and started web, API, worker, local PostgreSQL, Valkey, Caddy, and the one-shot storage initializer with no paid credentials.
- TypeScript typecheck, ESLint, Prettier, and the Next.js production build passed.

### Limitations and risks

- The server worker currently performs bounded structural PDF inspection and queues classification evidence; known marketplace normalization remains the more private and more capable browser path.
- ImageKit live integration is not exercised without user credentials. Its private remote copy is optional and its shared local mirror remains the worker-read path.
- Table creation is intentionally pragmatic for this initial modular monolith; production schema evolution should add explicit migrations before multiple API replicas run migrations concurrently.

## Phase 10 — Optional local/cloud vision fallback and verification

**Status:** Complete

### Major decisions

- Added a shared `VisionFallbackProvider` contract and backend coordinator. Deterministic success returns immediately without calling any provider.
- `LocalVisionProvider` uses bounded OpenCV connected-content analysis. Optional `GeminiProvider` and `OpenAIProvider` send only a minimum PNG/JPEG/WebP render with strict structured crop output; source PDFs and whole batches are not sent.
- Provider order is local vision, Gemini, then OpenAI. Blank keys disable cloud providers and never prevent boot; `AI_ENABLED=false` remains the default.
- Every proposal is only a hypothesis. Exact output dimensions, machine-readable decode, clipping safety, and evidence confidence must pass again after the proposal; model confidence cannot override these checks.
- Health readiness reports enabled provider IDs without exposing credentials. Model names and image/approval limits remain configurable.

### Tests and verification

- Seventeen backend tests passed, including deterministic short-circuiting, missing-key boot, provider order, local content bounds, OpenAI Responses structured-image request shape, Gemini inline-image/structured-output request shape, and rejection of high-confidence proposals with failed barcode evidence.
- Forty-four TypeScript tests across seventeen files passed, including the shared deterministic post-AI gate.
- The Phase 10 Playwright path verified the full Docker application boots through Caddy with no cloud keys and keeps local PDF input available.
- The complete ten-test Chromium suite passed after preserving a real undecodable Meesho fixture as manual review instead of weakening validation.
- Typecheck, ESLint, Prettier, Ruff lint/format, Next.js production build, and the full Docker Compose build passed.

### Limitations and risks

- Gemini, OpenAI, ImageKit, and Neon network calls were contract-tested with mocked transports/configuration; live credentials were not available and are not required for the core workflow.
- Local OpenCV fallback proposes content bounds; it is not a downloaded generative model and still depends on the same deterministic post-validation gate.
- The current server worker provides bounded fallback ingestion/inspection infrastructure. Native known-marketplace normalization remains browser-primary, and optional vision proposals are integrated through the coordinator seam rather than automatically uploading customer pages.

## Post-Phase 10 fix — Meesho exchange-label retention

**Status:** Complete

### Major decisions

- Added a versioned Meesho A4 exchange-label fingerprint using combined exchange, address, returns, product, geometry, and optional carrier evidence. Carrier names are supporting evidence only and never classify a marketplace by themselves.
- Exchange-only pages are normalized from native PDF content and deliberately routed to manual review while this newer layout family has limited golden coverage.
- Added a pipeline-wide safety net: any nonblank, non-invoice page for which an adapter emits no printable region is retained as a full-page manual-review item instead of being silently discarded.

### Tests and verification

- Added adapter regression coverage for the Meesho exchange layout and pipeline regression coverage for zero-region retention.
- The current real 25-page Meesho batch was checked read-only: 1 exchange label plus 24 label-and-invoice pages produced 25 printable regions, with the exchange page retained for review.
- Full Vitest suite: 48 tests passed across 18 files. ESLint, targeted Prettier checks, TypeScript/Next.js production build, and local Docker health checks passed.
- Added an explicit `APPROVE ALL` review action that records manual evidence for every current review item and rebuilds the combined PDF once, while preserving individual approve, re-detect, download, and skip controls.

## SaaS release R3 — self-hosted authentication foundation

**Status:** Complete

### Major decisions

- FastAPI is the only identity and authorization authority. PostgreSQL stores users, opaque revocable sessions, single-use recovery tokens, and sanitized security events.
- The account model has exactly `user` and `admin` roles. Public registration cannot choose a role; the first administrator is created or promoted only through a password-safe operator CLI.
- Argon2id password hashing, host-only HttpOnly session cookies, session-bound CSRF, trusted-origin checks, Valkey-backed abuse limits, idle/absolute expiry, device session management, and password-reset revocation are implemented as modular backend capabilities.
- `/app` now moves through the authenticated `/dashboard/labels` route. The original local PDF Workspace remains a single implementation. `/dashboard/security` manages sessions; `/admin` proves backend authorization while intentionally deferring the full admin product.
- Alembic replaces startup `create_all`. A one-shot Compose migration gate runs before API and worker, while Mailpit provides a no-cost local email verification and reset path.
- Server-fallback batches are owned by the authenticated user. Cross-user batch lookup returns 404 and authenticated mutations also require CSRF.

### Tests and verification

- Backend suite: 251 passed and 18 optional-service tests skipped; a separate real PostgreSQL/Valkey integration run passed all 18 tests covering migrations, schema drift, concurrency, token consumption, and revocation races.
- Frontend suite: 59 tests across 21 files passed, including protected return-target validation. Typecheck, ESLint, phase-file Prettier, production build, Ruff lint/format, and Docker Compose configuration passed.
- A fresh isolated Compose project built and started every service. Live checks confirmed migrations `up_to_date`, auth `ready`, registration email captured by Mailpit, login, a `user` identity, CSRF-protected owned-batch creation, and the protected dashboard through Caddy.
- Browser automation was explicitly deferred by the product owner for this phase; visual and flow acceptance will be performed manually.

### Limitations and risks

- A full user/credits/plans/payments/logs admin panel, billing, quota enforcement, MFA, and external SMTP deliverability are later release phases.
- Local Mailpit captures mail but does not deliver it. Production verification/reset requires a configured SMTP provider.
