# Troubleshooting

## Startup fails because secret files are missing
- Verify `SECRETS_DIR` points to a real host directory outside the repo
- Verify each required file exists and has readable permissions for the runtime
- Check that `*_FILE` env vars point to `/app/.secrets/...` inside the container

## Login fails after restart
- Ensure `JWT_SECRET_FILE` points to a stable secret file
- Verify system time is correct
- Confirm cookies are not being stripped by a proxy or mismatched origin

## Database errors
- Check container status:
  - `docker compose ps`
- Check API logs:
  - `docker compose logs -f api`
- Check DB logs:
  - `docker compose logs -f db`

## Client IPs look wrong
- Keep `TRUST_PROXY=0` unless traffic always comes through a trusted reverse proxy
- If you do run behind Caddy or Nginx, set `TRUST_PROXY=1`

## QR scanning does not work on device
- Chrome on Android has the best `BarcodeDetector` support
- If camera scanning is unavailable, use the manual token field on the staff page

## Messaging does not send
- `MESSAGE_PROVIDER=dev` logs codes/messages locally
- WhatsApp Cloud requires `WA_PHONE_NUMBER_ID` and `WA_ACCESS_TOKEN`
- SMTP requires `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`
- SMS gateway mode requires `SMS_GATEWAY_URL`
