# Pertenece web service

Public origin: **https://pertenecegt.com/**. The edge proxy forwards to
**http://10.10.1.5:3100**. `www` redirects to the apex at the edge.

The independent Nginx container serves only the Pertenece landing assets, shared
fonts, robots.txt and sitemap.xml. It does not start another PF application or
database. The only forwarded application route is `POST /api/public/contact`.
That route retains PF validation, rate limiting and server-side Turnstile checks;
the server selects Pertenece's inbox (`hola@pertenecegt.com`) by the fixed upstream
Host header. Existing PF requests keep their configured destination and sender.

Client-IP resolution trusts the edge VM at `10.10.1.3` and Cloudflare's published
proxy CIDRs, verified on 2026-11-12. Nginx resolves the forwarded chain from the
right and supplies the resulting client address to PF (whose proxy hop count
remains one). This keeps the existing contact limit per visitor. Update this
explicit trust configuration when the edge address or CDN ranges change.

## Deployment on the PF VM

Runtime files live in `/var/lib/puntos/pertenece`, outside the git worktree.
Prepare the files from the reviewed source revision:

```sh
install -d /var/lib/puntos/pertenece/public/styles
cp deploy/pertenece/compose.yml deploy/pertenece/nginx.conf /var/lib/puntos/pertenece/
cp -a public/credenciales public/fonts /var/lib/puntos/pertenece/public/
cp public/styles/fonts.css /var/lib/puntos/pertenece/public/styles/
docker compose -p pertenece -f /var/lib/puntos/pertenece/compose.yml run --rm --no-deps web nginx -t
docker compose -p pertenece -f /var/lib/puntos/pertenece/compose.yml up -d --wait
docker compose -p pertenece -f /var/lib/puntos/pertenece/compose.yml exec web nginx -s reload
```

The image is pinned by digest, uses a read-only filesystem, and is capped at
64 MiB / 0.25 CPU. It joins the existing `puntos_default` network solely to reach
the existing API. No native application workflow is involved.

## Verify after publishing

- `/` returns 200 at the public origin, with Pertenece's title and canonical URL.
- `/robots.txt` advertises the canonical sitemap, which contains only the homepage.
- `/credenciales/` redirects to `/`; missing paths return 404, not a homepage.
- Images, fonts and styles load at mobile and desktop widths.
- Public form destination uses the Pertenece host and retains CAPTCHA validation.
  Browser fixtures must intercept submission; do not send test emails by default.
- Actual Turnstile rendering requires `pertenecegt.com` in the existing widget's
  Hostname Management. DNS configuration alone does not authorize the widget.
- The previous PF preview stays excluded from indexing by PF's HTTP headers.

The reception status card is a labeled simulation. Publishing this page does not
implement membership verification, identity verification, Stripe checkout or
live customer pass issuance. Wallet badge images illustrate the invitation step.

## Rollback

Restore the previous reviewed `public/credenciales` snapshot and configuration,
validate Nginx, then reload the service. For a complete shutdown, use
`docker compose -p pertenece -f /var/lib/puntos/pertenece/compose.yml down`;
this does not stop the PF API, worker or database.
