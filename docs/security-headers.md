# Security headers

Configured in `vercel.json`. Applied to every route.

## Enforced

| Header | Value | Why |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | Stops the browser second-guessing a declared content type |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | A note URL contains a class slug, a note slug and a document id. None of that should travel to a third party in a `Referer` |
| `X-Frame-Options` | `DENY` | Nothing here should ever be framed; clickjacking an editor means clickjacking "delete note" |
| `Permissions-Policy` | camera, microphone, geolocation, interest-cohort all `()` | The app asks for none of these. Denying them means a future dependency cannot quietly start |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Sessions travel on every request |

## Report-only, deliberately

The Content-Security-Policy ships as **`Content-Security-Policy-Report-Only`**.

This is not a placeholder or a weaker setting chosen for convenience — it is
the first half of a two-step rollout, and the second step is real work that has
not been done yet.

The blocker is printing. `src/editor/printDocument.ts` builds a separate
document in an iframe and injects the app's stylesheets into it as `<style>`
elements, then measures and paginates the result. A `style-src` that the print
document does not satisfy would not produce a visible error — it would produce
an unstyled or mis-paginated printout, which is the kind of failure a user
discovers at a printer and cannot diagnose.

Verifying that requires driving a real browser through the print path and
reading the violation reports. That is Playwright work, and until it is done,
enforcing this policy would mean shipping a change to printing that nobody has
looked at.

### Flipping it on

1. Run the app against a production build.
2. Exercise: sign in, edit a note, print, export PDF, open a share link, use
   the AI panel, load every font in the font menu.
3. Read the console for `Content-Security-Policy-Report-Only` violations.
4. Fix the policy — or the code — until there are none.
5. Rename the header to `Content-Security-Policy`.

Do not skip step 2's print and PDF paths. They are the reason this is not
already enforced.

### Notes on the policy as written

- `style-src` needs `'unsafe-inline'`: React writes inline `style` attributes,
  and the pagination engine positions pages that way. Removing it requires
  moving that layout into classes or nonces, which is a real refactor.
- `connect-src` uses `https://*.supabase.co` rather than the project host,
  because `vercel.json` is static and the project ref differs per deployment.
  Narrowing it to the exact host is worth doing if the config ever becomes
  build-time generated.
- `img-src` allows `https:` broadly because notes can contain images added by
  URL. Tightening it means deciding what happens to existing notes that use
  one, which is a product decision, not just a header change.
