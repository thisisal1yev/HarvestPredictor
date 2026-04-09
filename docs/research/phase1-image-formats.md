# Phase 1 Research — Modern Image Formats (April 2026)

**Context:** HarvestPredictor writes snapshot JPEGs per YOLO detection (640x640 or 1280px photographic crop imagery) to MinIO. Goal — pick a format/encoder that minimises storage without stalling live stream processing.

---

## TL;DR — Recommendation for HarvestPredictor

- **Primary format:** JPEG via `cv2.imwrite` at quality **82–85**, `IMWRITE_JPEG_OPTIMIZE=1`. Fast, universal, predictable, ~40–80 KB per 640x640 plant photo.
- **Optional derived variant:** AVIF at speed 8, quality ~50 for gallery thumbnails/history lists — 30–50% smaller than JPEG, but encoded out-of-band, not on the hot CV path.
- **Do NOT** encode AVIF synchronously inside the detection loop — libaom AVIF encode is 500–2000x slower than JPEG and will starve the stream worker.
- **JPEG XL — ignore for now.** Only Safari ships it; Chrome 145 has the decoder behind a flag; Firefox still not compiled in.
- **mozjpeg** — skip unless storage cost becomes painful; ~3–5% smaller files for 4–7x encode time.
- **Progressive JPEG** — free win for the web gallery use case (history page), but neutral for single-image detection view. Turn on if gallery scroll UX matters.

---

## 1. Compression ratios — photographic content

Measured on real photo corpora (not icons/illustrations, which behave differently):

| Format | Savings vs baseline JPEG (q~80, same visual quality) |
|---|---|
| JPEG baseline (libjpeg-turbo) | 0% (reference) |
| mozjpeg | ~3–5% smaller, up to ~16% in some corpora |
| WebP (lossy) | ~25–34% smaller |
| AVIF | ~40–50% smaller (30–45% smaller than WebP) |
| JPEG XL | ~50–60% smaller at same quality (lossless transcoding from JPEG ~20%) |

Sources: [WebP vs AVIF vs JPEG XL — 2026 guide (small.im)](https://small.im/blog/webp-vs-avif-vs-jpeg-xl-2026), [WebP vs AVIF 2026 benchmarks (pixotter)](https://pixotter.com/blog/webp-vs-avif/), [Real WordPress benchmark, 4 plugins (Dev|Journal, Feb 2026)](https://earezki.com/ai-news/2026-02-26-jpeg-vs-webp-vs-avif-in-wordpress-real-benchmark-data-4-plugins-tested/), [mozjpeg vs libjpeg-turbo output sizes (gist.github / sergejmueller)](https://gist.github.com/sergejmueller/088dce028b6dd120a16e), [Cloudflare mozjpeg 2.0 writeup](https://blog.cloudflare.com/experimenting-with-mozjpeg-2-0/).

**Caveat:** the "AVIF is 50% smaller" claim is usually at q≈50 AVIF vs q≈75 JPEG with SSIM-matched sampling. At identical nominal quality numbers the gap is smaller. For *our* 640x640 plant photos, expect AVIF ≈ 40–60% of the JPEG byte size.

---

## 2. Browser support — April 2026

| Format | Global support |
|---|---|
| JPEG (baseline) | 100% |
| WebP | ~97% |
| AVIF | ~93–95% (Chrome 85+, Safari 16+, Firefox, Edge all GA) |
| JPEG XL | ~12% (Safari 17+ only, partial — no animation, no progressive) |

Chrome 145 (Feb 2026) shipped the JPEG XL decoder but it is still behind `enable-jxl-image-format` flag. Firefox has `jxl-rs` in Nightly targeting Firefox 149 but six blockers remain, no stable timeline. Effective JXL reach on the open web is still basically "Safari only".

Sources: [caniuse AVIF](https://caniuse.com/avif), [caniuse JPEG XL](https://caniuse.com/jpegxl), [AVIF browser support 2026 (Orquitool)](https://orquitool.com/en/blog/avif-browser-support-2026-compatibility-webp-switch/), [Chrome JPEG XL return (Januschka)](https://www.januschka.com/chromium-jxl-resurrection.html), [DevClass on Chromium JXL reversal](https://devclass.com/2025/11/24/googles-chromium-team-decides-it-will-add-jpeg-xl-support-reverses-obsolete-declaration/), [Wikipedia JPEG XL](https://en.wikipedia.org/wiki/JPEG_XL).

**Implication for us:** target audience is farmers/agronomists in Uzbekistan on mixed mobile browsers. AVIF is safe as primary. JXL is not.

---

## 3. CPU encode time — the make-or-break number for live CV

The detection pipeline must write a snapshot every time YOLO fires; encode time blocks the stream worker.

Ballpark numbers from public benchmarks (single image, single thread, modern x86):

| Encoder | Typical encode time for ~640x640 / ~1MP photo |
|---|---|
| `cv2.imwrite` JPEG (libjpeg-turbo) | ~2–5 ms |
| Pillow JPEG | ~5–15 ms |
| libvips JPEG | ~2–4 ms |
| Pillow/libvips WebP (lossy, quality ~80) | ~80–170 ms |
| libvips AVIF (libaom, default speed 6) | **~1000–2000 ms** |
| libvips AVIF, speed 8–9 (rav1e/SVT-AV1) | ~150–400 ms |
| mozjpeg | ~10–40 ms (4–7x slower than libjpeg-turbo) |

**AVIF speed parameter matters more than anything else.** libaom defaults to speed 6, which is catastrophic for live processing. Speed 8 is the commonly recommended "production sweet spot"; speed 9 / 10 is close to WebP speed but loses ~10–15% of the compression benefit. rav1e and SVT-AV1 have been improving ~30–50% per year according to trackers cited below.

Sources: [libvips speed and memory wiki](https://github.com/libvips/libvips/wiki/Speed-and-memory-use), [imgproxy image processing servers benchmark](https://imgproxy.net/blog/image-processing-servers-benchmark/), [AVIF in 2026 — encode speed analysis (DEV Community)](https://dev.to/serhii_kalyna_730b636889c/avif-in-2026-why-its-the-best-format-for-web-images-epj), [OpenCV imwrite cost analysis (ccoderun)](https://www.ccoderun.ca/programming/2021-02-08_imwrite/), [AVIF vs WebP speed (crystallize.com)](https://crystallize.com/blog/avif-vs-webp), [libjpeg-turbo: about mozjpeg](https://libjpeg-turbo.org/About/Mozjpeg).

**Implication for us:** if the CV service writes 5–10 snapshots per second during live stream, JPEG via `cv2.imwrite` is the only format that keeps up without a dedicated encoder thread pool. AVIF must be produced asynchronously from a worker queue — never on the hot path.

---

## 4. JPEG XL status — 2026

- **Safari:** stable since iOS 17 / macOS Sonoma (Sep 2023), partial — no animation, no progressive decode.
- **Chrome/Chromium:** decoder merged in v145 (Feb 2026), behind `enable-jxl-image-format` flag. Default-off. Not yet a real deployment target.
- **Firefox:** Rust decoder (`jxl-rs`) landed in Nightly, Firefox 149 target, six known blockers, no stable release timeline.
- **Effective reach:** ~12%, basically Safari share.

Conclusion: JPEG XL is a *watch item*, not a production target for April 2026. Revisit in late 2026 / early 2027 once Chrome enables by default and Firefox stable ships.

Sources: [Chromium JXL resurrection (Januschka)](https://www.januschka.com/chromium-jxl-resurrection.html), [Phoronix: JPEG-XL possible Chrome return](https://www.phoronix.com/news/JPEG-XL-Possible-Chrome-Back), [Mozilla bug 1539075 — JXL tracking](https://bugzilla.mozilla.org/show_bug.cgi?id=1539075), [caniuse JPEG XL](https://caniuse.com/jpegxl).

---

## 5. Progressive JPEG vs baseline

- **Load speed:** identical bytes over the wire.
- **Perceived speed:** large win. At 50% downloaded, user sees a blurry full-frame preview instead of the top half of the image. Meaningful on slow rural mobile connections (our actual audience).
- **Decode CPU:** ~3x baseline per Google's measurements, but "3x of ~5ms" is invisible on any device from 2020+.
- **File size:** progressive is typically 1–4% *smaller* than baseline on >10 KB images (94% of tested images in a 10,000-image study).
- **Core Web Vitals:** does not move LCP directly (LCP measures completion), but helps real UX under slow networks.

**Implication for us:** for the detection *history page* (list of many JPEG snapshots), turning on progressive mode is a free win. On the hot detection path there is no user-visible loading so it doesn't matter.

OpenCV supports this via `cv2.IMWRITE_JPEG_PROGRESSIVE=1`.

Sources: [Progressive JPEG in 2026 (ShortPixel)](https://shortpixel.com/blog/progressive-jpeg-vs-baseline-jpeg-does-it-still-matter-in-2026/), [Ctrl.blog perceived performance study](https://www.ctrl.blog/entry/jpeg-progressive-loading.html), [ImageCDN progressive vs baseline](https://theimagecdn.com/docs/progressive-jpeg-vs-baseline-jpeg), [ImageKit progressive JPEG article](https://imagekit.io/blog/progressive-jpeg/).

---

## 6. mozjpeg vs standard libjpeg-turbo

- **Size:** ~3–5% smaller on average (up to ~16% on some images). One full-corpus test: mozjpeg average 41% of original, libjpeg-turbo 49% of original.
- **Encode time:** 4–7x slower than libjpeg-turbo (173s → 474s on a test corpus).
- **API:** drop-in libjpeg-compatible.

**Implication for us:** on the live CV path, 4–7x encode time is unacceptable. For a *batch re-encode job* on archived images, mozjpeg is a reasonable storage optimization if it becomes worth the engineering cost. Not a Phase 1 decision.

Sources: [mozjpeg output size and runtime gist](https://gist.github.com/sergejmueller/088dce028b6dd120a16e), [libjpeg-turbo official "what about mozjpeg"](https://libjpeg-turbo.org/About/Mozjpeg), [Cloudflare mozjpeg 2.0 experiment](https://blog.cloudflare.com/experimenting-with-mozjpeg-2-0/), [brandur.org libjpeg / mozjpeg shootout](https://brandur.org/fragments/libjpeg-mozjpeg).

---

## 7. YOLO snapshot sweet spot — 640x640 RGB plant photo

No single public benchmark matches our exact scenario (agricultural plant photos, 640x640, cv2 encoder), so this section synthesises from general JPEG behaviour on natural photographic content:

**Expected JPEG file size at 640x640 of a plant photo (heavy natural texture):**

| Quality | Approx size |
|---|---|
| q=95 | 120–180 KB |
| q=90 | 70–110 KB |
| q=85 | 50–80 KB |
| q=80 | 40–60 KB |
| q=75 | 30–50 KB |
| q=70 | 25–40 KB |
| q=60 | 18–30 KB |

Observed in general photo corpora: visual artifacts begin to appear below q=70. q=85 is widely cited as the "no visible loss" boundary for photography. q=80 is the most common "web photo" default.

**For YOLO snapshots specifically there is extra nuance:**

- These images are evidence/diagnostic, not hero photos. They need to be clear enough for the agronomist to verify the detection bounding box.
- Artifacts matter most in texture regions (leaves with fine detail), where YOLO is already looking.
- **Recommended starting point: `cv2.IMWRITE_JPEG_QUALITY=82`, `cv2.IMWRITE_JPEG_OPTIMIZE=1`.** Expect ~45–70 KB for a 640x640 plant frame, ~150–250 KB for 1280px.
- If quality turns out visibly lossy on real drone footage, bump to 88. If storage is tight, drop to 78 and re-evaluate.

Note that a comprehensive 640x480 cv2 benchmark showed "little visual difference between q=70 and q=100" on natural video frames. This confirms q=80–85 is a conservative default, not aggressive.

Sources: [Lenspiration JPEG quality guide](https://www.lenspiration.com/2020/07/what-quality-setting-should-i-use-for-jpg-photos/), [OpenCV imwrite cost + quality analysis (ccoderun)](https://www.ccoderun.ca/programming/2021-02-08_imwrite/), [OpenCV imgcodecs flags docs](https://docs.opencv.org/4.x/d8/d6a/group__imgcodecs__flags.html), [OpenCVhelp image compression tutorial](https://www.opencvhelp.org/tutorials/advanced/image-compression/).

---

## 8. Concrete configuration recommendation

```python
# hot path — cv-service live detection snapshot
cv2.imwrite(
    path,
    frame,
    [
        cv2.IMWRITE_JPEG_QUALITY, 82,
        cv2.IMWRITE_JPEG_OPTIMIZE, 1,
        cv2.IMWRITE_JPEG_PROGRESSIVE, 1,  # free UX win on history gallery
    ],
)
```

Expected results for 640x640 RGB plant photo:
- Size: ~45–70 KB per snapshot
- Encode time: ~3–6 ms
- Visual quality: indistinguishable from original for diagnostic use

**If storage pressure grows** (Phase 2 / Phase 3):
1. Keep JPEG as the canonical "source of truth" snapshot.
2. Add an async worker that produces an AVIF derivative at speed 8, quality 50 for the gallery/thumbnail list. ~30–50% storage for that specific use case.
3. Serve via `<picture>` with AVIF + JPEG fallback.
4. Do NOT adopt JPEG XL until Chrome enables by default.

---

## 9. Open questions / things to verify empirically

- Actual byte size on *real* drone footage of Uzbek cotton/wheat fields — public benchmarks skew toward stock photo corpora. Need to re-measure on the first 100 real detections.
- Whether MinIO compression / erasure coding already recovers enough storage to make the JPEG→AVIF switch unnecessary.
- Whether the CV service runs on a GPU box with enough CPU headroom for parallel AVIF encoding, or whether it is CPU-bound on inference.
- Whether hot path ever serves snapshots directly to the frontend, or always via CDN/imgproxy (affects whether we need multiple pre-generated variants).

These are inputs for the synthesis phase, not blockers on the format choice.
