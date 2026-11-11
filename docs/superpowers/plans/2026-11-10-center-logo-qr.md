# Centered logos in enrollment QR codes

User clarified branded QR means logo inside the code. This corrects the existing feature under prior implementation authorization. Preserve Mantine, fonts, tier checks and standard QR; no native releases. Continue isolated merchant-web worktree. Read existing design/implementation and self-reviewed scope before implementation.

Design: retain printable poster and add center/header/none logo placement. Default center when a portable stored logo exists. PNG/JPEG file input normalizes a local logo to a bounded PNG for this export only; explicit copy says it does not change saved business branding. Existing external logo URLs are never fetched server-side. Read-only authenticated POST preview accepts only validated logo data, placement and color, with same owner/tenant/plan guards and CSRF. GET remains backward compatible and accepts placement. Use established qrcode library for matrix/error correction, Mantine controls and jsQR to verify actual rendered export before enabling download/print. No new dependency, database write or native build.

1. Regression tests: logo inside nested QR, center/header/none decoding across URL densities and image cases, strict preview routes and tenant/plan/CSRF checks. Observe failures before implementation.
2. Extend SVG renderer with conservative central white backing and embedded raster logo, four-module quiet zone and H correction. Add strict preview route and option validation. No arbitrary enrollment targets.
3. Add local upload/placement controls, normalization/size errors, cancellable automatic preview decode. Keep demo self-contained and ensure uploaded logo never contacts real API in demonstration. Existing copy reflects logo in code and supports placing above when desired.
4. Test browser flows desktop/mobile light/dark, uploaded PNG/JPEG, errors/reset, disabled export during verification, actual download decoding, no outbound requests in demo, accessibility and print. Run unit/type/lint/build. Independent review before release.
5. Scoped API-only overlay from exact current live image; preserve deployed route registry and all unrelated dirty files, no worker/migration changes. Sync only baseline-guarded source paths; deploy/read-only live checks, persist API tag and rollback evidence.

Next-priority advice will be grounded in current product: guided setup gaps, a real POS sale/refund/reconnect pilot, real incentive costs and customer retention measurement, branch governance. Recommendations are not implementation promises in this task.
