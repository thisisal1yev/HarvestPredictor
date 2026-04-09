# Phase 1 Research: Frontend Performance for Large Image Lists

**Researcher:** frontend-perf
**Date:** 2026-04-08
**Scope:** HarvestPredictor Detections tab — lists of 50-500 (up to 1000+) drone snapshot images, Nuxt 4 + Vue 3 + Nuxt UI 4.
**Question:** Can we rely on browser-side optimization, or must we pre-generate server-side thumbnails?

---

## TL;DR

**Server-side thumbnails are mandatory, not optional, for this use case.** "Just native lazy loading + HTTP/2" is NOT enough when the source images are ~1280x1280 drone captures and users see 50-1000 of them. The dominant costs are **decode CPU on mobile** and **decoded-bitmap memory**, neither of which native lazy loading fixes when the underlying file is full-resolution. Browser techniques (native `loading="lazy"`, `decoding="async"`, `content-visibility: auto`, virtual scrolling) are complementary — they reduce *how many* images are processed at once, but not *how expensive each one is*. Responsive thumbnails attack the per-image cost directly.

Recommended stack:
1. **Server-side:** generate 2-3 thumbnail variants per snapshot (e.g. 320w, 640w, 1280w original) — either via imgproxy / IPX / MinIO + sharp.
2. **Frontend:** `<NuxtImg>` with `srcset` + `sizes`, `loading="lazy"`, `decoding="async"`, explicit `width`/`height`, WebP/AVIF format, and virtual scrolling (TanStack Virtual) for lists over ~200 items.

---

## 1. Native `loading="lazy"` — real-world behavior in 2026

### What it is
An HTML attribute that tells the browser to defer loading an image until it's likely to enter the viewport. Supported by ~96% of global browsers per Can I Use — effectively universal.

### Viewport margin (the thing that matters)
Each browser ships a *different* rootMargin for lazy loading, and the margins are surprisingly generous — they are closer to "pre-fetch everything a few screens ahead" than "load only what's visible":

| Browser | Margin (approx) |
|---|---|
| Chrome (Blink), 4G | ~1250 px from viewport |
| Chrome (Blink), slow connection | ~2500 px |
| Firefox (Gecko), 90+ | 600 px (was 300 px in FF86) |
| Safari (WebKit) | ~100 px vertical / 0 horizontal (implementation was long incomplete) |

Sources: [MDN Lazy loading](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Lazy_loading), [Ctrl blog: Inconsistent UX with native lazy-loading](https://www.ctrl.blog/entry/lazy-loading-viewports.html), [web.dev: Browser-level image lazy loading](https://web.dev/articles/browser-level-image-lazy-loading).

### Implications for a Detections grid
- A grid of 1280x1280 snapshots at 3 columns on desktop = each row is ~350 px tall. A 1250 px Chrome rootMargin means **~4 extra rows pre-fetched**, i.e. ~12 images beyond what is visible. Acceptable.
- BUT: lazy loading only defers the *network fetch*. Once fetched, the image is still decoded at full size. If the server returns 6 MB-per-pixel bitmaps, lazy loading does not save decode cost — only start time.
- Also note Chromium only applies the rootMargin for the top-level scroller. Inside a nested scroll container (common for modal lists, drawers, tab panels), loading starts as soon as the element is ≥1 px visible, which can cause visible pop-in.

### Caveats
- LCP image (the first, above-the-fold hero) must NOT be lazy — use `fetchpriority="high"` instead.
- As of **Lighthouse 13 (October 2025)**, the "Defer offscreen images" audit was removed: the Chrome team considers modern browsers' built-in deprioritization good enough. [corewebvitals.io](https://www.corewebvitals.io/pagespeed/fix-defer-offscreen-images-lighthouse), [Chrome dev docs](https://developer.chrome.com/docs/lighthouse/performance/offscreen-images).

**Verdict:** Use `loading="lazy"` by default. It's free, universal, and sufficient for deferring network I/O. It does NOT solve decode/memory.

---

## 2. IntersectionObserver — still needed in 2026?

### Short answer
**No, not for basic image lazy loading.** Use native `loading="lazy"`. IntersectionObserver is still valuable for:
- Lazy-loading **CSS background images** (native `loading="lazy"` only works on `<img>` and `<iframe>`).
- Triggering **analytics/animations** when elements enter the viewport.
- **Virtual scrolling** implementations (internally).
- **Advanced control** — e.g., trigger a blurhash-to-full swap, log impressions, fire a prefetch for the next item.

Sources: [State of Cloud 2025 guide](https://stateofcloud.com/lazy-loading-images-implementation-guide-for-2025/), [Krunkit 2026 guide](https://ighenatt.es/en/resources/velocidad-web/lazy-loading-seo/), and the original Walmart Global Tech article [now explicitly says](https://medium.com/walmartglobaltech/lazy-loading-images-intersectionobserver-8c5bff730920) IntersectionObserver "is for the most part not the recommended method of lazy loading images" anymore.

**Verdict:** Default to native. Reach for IntersectionObserver only if a specific feature (backgrounds, impression logging, progressive enhancement) demands it.

---

## 3. Virtual scrolling for Vue 3 / Nuxt 4

### Why we need it for 1000+ items
Even with lazy loading, the DOM cost of 1000 `<img>` wrappers, their `<li>`, event listeners, and Vue reactivity is real. Virtual scrolling keeps only the visible ~20-50 items mounted. This also drops memory for decoded bitmaps of items that have scrolled far out of view (the browser can evict them).

### Candidates

| Library | Status | Vue 3 / Nuxt 4 compat | Notes |
|---|---|---|---|
| **TanStack Virtual (`@tanstack/vue-virtual`)** | Actively maintained, headless, framework-agnostic | First-class Vue 3 | Recommended in [VueUse docs](https://vueuse.org/core/usevirtuallist/) over their own `useVirtualList` for non-trivial lists. [TanStack docs](https://tanstack.com/virtual/v3/docs/framework/vue/vue-virtual). |
| **vue-virtual-scroller (`@akryum/vue-virtual-scroller`)** | 2.0.0, 412k weekly downloads, ESM-only | Has Nuxt-specific friction — [issue #832](https://github.com/Akryum/vue-virtual-scroller/issues/832) shows multiple users fighting SSR/auto-import quirks on Nuxt 3.7.4+ | Very popular but older-feeling API, opinionated DOM, some Nuxt pain. |
| **Nuxt UI 4 `UScrollArea`** | Built-in, ships with the existing stack | Native | [Nuxt UI docs](https://ui.nuxt.com/docs/components/scroll-area) mention "optional virtualization for large lists." Worth checking if it wraps TanStack under the hood before adding a new dep. |
| **VueUse `useVirtualList`** | Maintained | Native | Documented as "consider TanStack Virtual if you want more features" — fine for simple flat lists. |

### Recommendation
**TanStack Virtual** is the safest 2026 bet: headless, actively maintained, maintained by the same team behind TanStack Query (which the team may already be using), and has no SSR traps. If `UScrollArea` in Nuxt UI 4 already provides virtualization, prefer that to avoid a dependency. Verify in the source which it uses.

Kick in virtualization at ~200+ items. Under 200, native lazy loading + content-visibility is cheaper and avoids layout oddities.

Sources: [Akryum vue-virtual-scroller](https://github.com/Akryum/vue-virtual-scroller), [Vue Script 2026 roundup](https://www.vuescript.com/best-virtual-scrolling/), [VueUse useVirtualList](https://vueuse.org/core/usevirtuallist/), [TanStack Vue Virtual](https://tanstack.com/virtual/v3/docs/framework/vue/vue-virtual).

---

## 4. HTTP/2 and HTTP/3 multiplexing — the network is not the bottleneck

### What multiplexing gives us
- **HTTP/1.1:** ~6 parallel connections per origin. Loading 100 images serialized in batches of 6 = slow.
- **HTTP/2:** multiplexes unlimited streams over a single TCP connection. Default is ~100 concurrent streams. 100 images load in parallel on one connection. *But:* TCP-level head-of-line blocking — one lost packet pauses ALL streams until retransmit.
- **HTTP/3 (QUIC):** multiplexed at the transport layer. A lost packet only stalls its own stream. Big win on lossy mobile networks.

Sources: [Cloudflare HTTP/3 vs HTTP/2](https://blog.cloudflare.com/http-3-vs-http-2/), [DebugBear HTTP/3 vs HTTP/2](https://www.debugbear.com/blog/http3-vs-http2-performance), [DebugBear HTTP/1 vs HTTP/2](https://www.debugbear.com/blog/http1-vs-http2).

### Implication for this project
If the MinIO / S3 endpoint serves over HTTP/2 (it does by default on modern deployments), loading 100 images in parallel is a solved problem *at the network layer*. **But that only means bytes arrive quickly — it does NOT solve:**
- Decode time per image (CPU-bound)
- Memory footprint of decoded bitmaps
- Main-thread jank from layout/paint of 100 large images

**Conclusion:** HTTP/2 is necessary but not sufficient. It removes the "network stampede" problem but leaves the "megabyte-per-image" problem untouched. Don't use it as an excuse to skip thumbnails.

---

## 5. Responsive images: `srcset`, `sizes`, `<picture>`

### The mechanism
- `srcset="thumb-320w.webp 320w, thumb-640w.webp 640w, original-1280w.webp 1280w"` gives the browser a menu.
- `sizes="(max-width: 600px) 100vw, (max-width: 1024px) 50vw, 33vw"` describes the LAYOUT so the browser can pick wisely.
- `<picture>` is for **art direction** (different crops per viewport) or **format fallbacks** (AVIF → WebP → JPEG).

### Critical rule from 2026 best-practice guides
`sizes` must reflect actual CSS layout. If your grid cell is `max-width: 400px`, `sizes` must say ~400px, **not** `100vw`, or the browser will over-fetch.

### Real-world waste
A 2025 HTTP Archive analysis: 60%+ of image-heavy sites still serve the same image size to every device. Mobile users download images **3-8x larger** than their screens can display.

Sources: [MDN responsive images](https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images), [Krunkit 2026 complete guide](https://krunkit.me/blog/responsive-images-complete-guide), [DebugBear ultimate guide](https://www.debugbear.com/blog/responsive-images), [dev.to 2025 best practices](https://dev.to/razbakov/responsive-images-best-practices-in-2025-4dlb).

### Nuxt Image integration
`<NuxtImg>` + IPX (built on `lovell/sharp`) generates variants on the fly from a source image and emits `srcset`/`sizes` automatically. [image.nuxt.com docs](https://image.nuxt.com/usage/nuxt-img). Already integrates with a self-hosted backend — ideal for a MinIO-backed stack.

**Verdict:** `srcset` is the single highest-leverage technique here. Each snapshot rendered in a grid cell of ~300 px should be sending 320-480w bytes, not 1280w bytes. That alone is a **10-16x** reduction in transferred bytes AND decoded bitmap size.

---

## 6. Browser decode cost — the hidden CPU tax on mobile

### The numbers
Decoding JPEG/WebP/AVIF is **CPU-expensive**, particularly on mid-range and low-end mobile. [web.dev Image performance](https://web.dev/learn/performance/image-performance), [images.guide](https://images.guide/), [industrial empathy](https://www.industrialempathy.com/posts/image-optimizations/).

- Decoding a large image can be **~5x slower** (or more) on mobile than on desktop.
- Twitter's mobile web team brought decode time from **~400 ms to ~19 ms per image** by serving correctly sized images. That is a **21x** improvement — from serving properly sized files, not from any magic in the browser.
- If the browser has to decode a 1280x1280 image and then CSS-scale it to a 320 px grid cell, **you paid the full decode cost for pixels that are immediately thrown away.**

### Mitigations in order of impact
1. **Serve correctly sized images** — dominates everything else. (This requires server-side thumbnails.)
2. `decoding="async"` — lets the browser decode off the main thread, avoiding input-latency jank. Cheap, just add it.
3. `content-visibility: auto` — skips layout/paint/decode for off-screen items (Baseline newly available Sep 2025, [web.dev](https://web.dev/blog/css-content-visibility-baseline)). Warning: on image-heavy lists this can increase CPU during scroll because paint fires continuously. [nolanlawson](https://nolanlawson.com/2024/09/18/improving-rendering-performance-with-css-content-visibility/) documents the trade-off.
4. Modern formats (WebP / AVIF) — smaller files, but decode can be **slower** than JPEG for AVIF on older mobile CPUs. Not a silver bullet.

**Verdict:** Without server-side resizing, no combination of decoding="async" + content-visibility will save you on low-end Android. The CPU cost is proportional to pixel count, and the pixel count is what thumbnails reduce.

---

## 7. Memory usage — the invisible killer

### Hard math
Every decoded image in browser memory is stored as an uncompressed bitmap, roughly **width × height × 4 bytes** (RGBA).

| Source | Per-image decoded size | 500 images | 1000 images |
|---|---|---|---|
| 1280×1280 original | **6.55 MB** | **3.28 GB** | **6.55 GB** |
| 640×640 thumbnail | 1.64 MB | 820 MB | 1.64 GB |
| 320×320 thumbnail | **0.41 MB** | **205 MB** | **410 MB** |

Sources: [Sciter forum — why images add 10-20 MB to RAM](https://sciter.com/forums/topic/why-do-images-add-10-20mb-to-ram-usage/), [Mozilla bugzilla on decoded image memory](https://bugzilla.mozilla.org/show_bug.cgi?id=1277397), [image-cache-pro docs](https://github.com/savanesoff/image-cache-pro).

### What actually happens
Browsers don't keep *every* decoded image in RAM forever. They cache decoded forms of *visible* and *recently-visible* images and evict the rest — but the eviction heuristic is not under your control. On memory-pressured mobile Chrome, the tab can be killed before eviction protects you. Users see "Aw, Snap!" and the tab reloads, which is catastrophic UX for a workflow where they're reviewing drone detections.

### The 320x320 column
Serving 320 px thumbnails means **500 images = 205 MB** of decoded bitmap even in the worst case where everything is decoded at once. That's survivable on a 4 GB Android. The 3.28 GB number at 1280 px is not.

**Virtual scrolling helps here** by keeping only the visible DOM, which lets the browser evict decoded bitmaps for unmounted items. Combined with thumbnails, this is the difference between "smooth scroll" and "tab dies."

**Verdict:** Memory alone forces the thumbnail decision. A 1280² source × 500+ list is incompatible with phone RAM budgets.

---

## 8. Putting it together — the real answer

### "Is lazy load + HTTP/2 enough?" — No. Here's why in one paragraph:
Native lazy loading fixes **network stampede** (too many concurrent downloads). HTTP/2 fixes **connection limits** (too few TCP sockets). Neither fixes **per-image decode cost** or **per-image memory footprint**, and those are the costs that scale linearly with (pixels × number of items) — exactly the dimension that grows from 50 to 1000 in this app. Only serving smaller files at the source attacks those costs. Browser techniques cap how *many* images are "in flight" at once; server-side thumbnails reduce how *much* each one costs.

### Recommended frontend implementation
```vue
<UScrollArea>
  <!-- TanStack Virtual wrapper for 200+ items -->
  <div v-for="item in virtualItems" :key="item.id" :style="{ height: '300px' }">
    <NuxtImg
      :src="item.snapshotUrl"
      :alt="item.label"
      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
      :width="320"
      :height="320"
      loading="lazy"
      decoding="async"
      format="webp"
      densities="x1 x2"
    />
  </div>
</UScrollArea>
```

### Required server-side capability
Two options for thumbnail generation (to be resolved with the S3/MinIO and imgproxy tracks — tasks #1, #4, #5, #8):
- **Pre-generate** 2-3 sizes at upload time, store all in MinIO. Predictable cost, dumb serving.
- **On-the-fly** via imgproxy / IPX in front of MinIO. Flexible, but adds CPU on the edge.

Either works for the frontend — the frontend just needs distinct URLs for 320w / 640w / 1280w (or a query param).

### Rules of thumb
| List size | Strategy |
|---|---|
| <50 | Native lazy + correctly-sized `srcset` |
| 50-200 | Above + `content-visibility: auto` on list items |
| 200-1000 | Above + **virtual scrolling** (TanStack Virtual) |
| 1000+ | Above + pagination or "load more" as a safety net |

### Attributes to always set
- `width` and `height` — prevents CLS, reserves layout space before load
- `loading="lazy"` — except for LCP candidate
- `decoding="async"`
- `fetchpriority="high"` on the LCP image only
- `sizes` — reflecting real CSS box width
- `srcset` — at least 3 variants

### Unknowns / flagged for other researchers
- **Format choice** (WebP vs AVIF decode cost on mid-range Android) — task #2 owns this.
- **Storage / URL pattern** for multi-variant snapshots in MinIO — tasks #1 and #4.
- **Server CPU cost** of on-the-fly resize vs pre-gen — task #5.

---

## Sources
- [MDN — Using responsive images in HTML](https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images)
- [MDN — Lazy loading](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Lazy_loading)
- [web.dev — Browser-level image lazy loading](https://web.dev/articles/browser-level-image-lazy-loading)
- [web.dev — Image performance](https://web.dev/learn/performance/image-performance)
- [web.dev — content-visibility is now Baseline](https://web.dev/blog/css-content-visibility-baseline)
- [Ctrl.blog — Inconsistent UX with native lazy-loading](https://www.ctrl.blog/entry/lazy-loading-viewports.html)
- [Lazy Loading and SEO 2026 guide](https://ighenatt.es/en/resources/velocidad-web/lazy-loading-seo/)
- [State of Cloud — Lazy Loading Images 2025](https://stateofcloud.com/lazy-loading-images-implementation-guide-for-2025/)
- [Walmart Global Tech — IntersectionObserver (now outdated)](https://medium.com/walmartglobaltech/lazy-loading-images-intersectionobserver-8c5bff730920)
- [Cloudflare — HTTP/3 vs HTTP/2](https://blog.cloudflare.com/http-3-vs-http-2/)
- [DebugBear — HTTP/3 vs HTTP/2 performance](https://www.debugbear.com/blog/http3-vs-http2-performance)
- [DebugBear — HTTP/1 vs HTTP/2](https://www.debugbear.com/blog/http1-vs-http2)
- [Krunkit — Responsive Images 2026 guide](https://krunkit.me/blog/responsive-images-complete-guide)
- [DebugBear — Ultimate guide to responsive images](https://www.debugbear.com/blog/responsive-images)
- [dev.to — Responsive Images best practices 2025](https://dev.to/razbakov/responsive-images-best-practices-in-2025-4dlb)
- [Nuxt Image — NuxtImg docs](https://image.nuxt.com/usage/nuxt-img)
- [Nuxt Image — IPX provider](https://image.nuxt.com/providers/ipx)
- [Nuxt UI — ScrollArea](https://ui.nuxt.com/docs/components/scroll-area)
- [TanStack Virtual — Vue docs](https://tanstack.com/virtual/v3/docs/framework/vue/vue-virtual)
- [Akryum vue-virtual-scroller](https://github.com/Akryum/vue-virtual-scroller)
- [Akryum vue-virtual-scroller issue #832 — Nuxt compat](https://github.com/Akryum/vue-virtual-scroller/issues/832)
- [VueUse — useVirtualList](https://vueuse.org/core/usevirtuallist/)
- [Vue Script — 7 best virtual scrolling 2026](https://www.vuescript.com/best-virtual-scrolling/)
- [Industrial Empathy — Maximally optimizing image loading](https://www.industrialempathy.com/posts/image-optimizations/)
- [images.guide — Essential Image Optimization](https://images.guide/)
- [Sciter forum — Image RAM usage](https://sciter.com/forums/topic/why-do-images-add-10-20mb-to-ram-usage/)
- [Mozilla bugzilla — decoded image memory](https://bugzilla.mozilla.org/show_bug.cgi?id=1277397)
- [Mozilla bugzilla — decode-and-downsample](https://bugzilla.mozilla.org/show_bug.cgi?id=854795)
- [image-cache-pro — decoded bitmap RAM/GPU caching](https://github.com/savanesoff/image-cache-pro)
- [Cekrem — content-visibility: auto](https://cekrem.github.io/posts/content-visibility-auto-performance/)
- [DebugBear — content-visibility](https://www.debugbear.com/blog/content-visibility-api)
- [Nolan Lawson — content-visibility trade-offs](https://nolanlawson.com/2024/09/18/improving-rendering-performance-with-css-content-visibility/)
- [corewebvitals.io — Defer offscreen images](https://www.corewebvitals.io/pagespeed/fix-defer-offscreen-images-lighthouse)
- [Chrome dev docs — Defer offscreen images](https://developer.chrome.com/docs/lighthouse/performance/offscreen-images)
