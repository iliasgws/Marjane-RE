# Phone login — APK 4.0.7

## Active flow (static trace)

The active `loginSaga` (lines 1588419 onward in `work/bundle_js`) does not merely
POST a phone number to the old customers authentication endpoint:

1. Select locale (`fr_FR` or `ar_MA`).
2. Call `captcha.execute('LOGIN')` and await a token (1588495–1588513).
3. Try obtaining the client device identifier. Failure leaves it undefined
   (1588514–1588539).
4. If the CAPTCHA token is missing, throw `No device token` before calling the
   login service (1588540–1588552).
5. For phone login, invoke `services.auth.phone.authByPhone` with the phone,
   platform, CAPTCHA token, locale, optional device ID and device type `mobile`
   (1588573–1588606).

The Coral client's `authByPhone` wrapper (422166–422193) builds a body with:

```json
{
  "phone": "<owner-supplied number>",
  "locale": {"code": "fr_FR"},
  "recaptcha": {"token": "<legitimate client token>", "platform": "android"},
  "device": {"device_id": "<client identifier if available>", "type": "mobile"}
}
```

Its endpoint is registered by joining `auth` and `phone`, POST, with API name
`coral` (421957–421964, 422150–422162). Together with the Coral base configuration,
this reconstructs `POST /coral/auth/phone`. It is not yet verified through a
successful direct-computer authentication request.

The confirmation wrapper passes `{code, token}` to the Coral `auth/confirm`
endpoint (422103–422130), whose success schema contains `token` and `version`
(422085–422102). Do not confuse that login-challenge token with the CAPTCHA
token or the eventual authenticated session token.

Older `customers/authenticate/app/phone`, `/phone/v2`, and confirmation helpers
also exist in the APK. Their presence does not establish that a supported
CAPTCHA-free login route exists. Do not switch to an older endpoint to evade
the active flow's verification.

## Computer-only test status

The owner requested testing without their phone or ADB. No further device access
was used for the computer-only login attempt. Static inspection established the
mobile CAPTCHA dependency. No fake CAPTCHA token was submitted.

The first browser integration was disconnected, but **T3 Code's own browser
worked**. On the official `https://www.marjane.ma/?auth=true` login form, submitting
the owner's supplied number reached the five-digit SMS confirmation form through
the website's normal verification flow. A subsequent confirmation attempt was
rejected by the site with “Le code saisi n'est pas correct”; that rejection alone
does not distinguish a wrong code from one that expired. The owner subsequently
completed login manually in T3's browser. The signed-in account page and the
receipt-list/detail field structures were then verified through ordinary website
navigation, without further phone or ADB access.

Browser automation's fill actions did not initially retain the digit input state;
the input's normal React change handler supported whole-code paste. Locator
clicks timed out; an observed-coordinate click submitted the enabled confirmation
button. No validation checks or CAPTCHA protections were removed. A fresh code,
if requested, should be entered directly in the official browser form rather
than chat. Server behavior without a CAPTCHA token has not been tested and
should not be inferred from client code.

Keep phone numbers, SMS codes, challenge tokens and session tokens out of Git.
Use private secret entry for verification codes, not chat messages.
