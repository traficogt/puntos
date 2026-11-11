# Public search improvements

User authorized current SEO research and implementation in parallel with native app work. Public PF marketing and support/legal pages only; authenticated application content excluded from indexing. Preserve existing design/fonts and verified product claims.

Research: Google's May 2026 generative-AI guide reinforces helpful original content and sound SEO, with no special AI text files or schema. Canonicals, sitemaps, Organization/WebSite markup, noindex, and Core Web Vitals official docs checked 2026-11-10.

Implementation: test host-aware middleware serving robots.txt and sitemap.xml with only four real public URLs; canonicalize .html marketing aliases; X-Robots-Tag noindex on app host, internal shells and APIs while permitting crawl so noindex can be read. Use configured origins, never client-supplied URLs for sitemap. Add unique titles/descriptions/canonicals/social metadata to all four public pages; truthful Organization/WebSite identity/contact markup on homepage. Improve homepage visible product description and POS/offline FAQs with actual limits, no unsupported claims. Preserve hero image priority/dimensions. Evaluate performance before optimizing assets. No fake reviews, ratings, prices, locations, keyword stuffing or mass generated landing pages.

Validation: middleware response tests (hosts, aliases, API, sitemap URLs, robots policies), static metadata/schema/internal-link checks, browser visual/contact-form regression, live headers/robots/sitemap after scoped deployment. Capture research/results and remaining Search Console/real-user Web Vitals measurement steps; do not claim ranking increases or field scores.
