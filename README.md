# poshmark-share-script

A small Selenium bot that shares your Poshmark closet to your followers, over and over,
so you don't have to sit there clicking "Share to Followers" all day.

## What it does

Each run drives a real Chrome window through the same steps you'd do by hand:

1. Opens your closet (`/closet/<USERNAME>?availability=available`) and dismisses the cookie
   banner.
2. Checks whether the saved Chrome profile still holds a Poshmark session. If it doesn't, it
   logs in with the credentials from `.env` and clears whatever Poshmark puts in the way
   afterwards — the verify-email modal, the data-consent prompt, the promoted-closet promo.
3. Scrolls the closet for ~10 seconds so every listing lazy-loads in.
4. Opens the closet dropdown, hits **Share to Followers**, selects all listings, and shares.
5. Waits for the "Sharing …" banner to disappear, pauses for a random 3–10 seconds, and goes
   again. It does 20 passes and then quits.

Two things it can't do on its own, so it asks for help instead:

- **One-time verification codes.** If login stalls on a code, it plays a sound, posts a macOS
  notification, and waits up to 5 minutes for you to type the code into the Chrome window.
- **Captchas.** While sharing, it polls for a reCAPTCHA challenge every 5 seconds. When one
  shows up it alerts you, re-alerts every 30 seconds in case you walked away, and sits idle
  until you've solved it — then picks up where it left off. It never tries to solve one itself.

The Chrome session is persisted to a dedicated profile directory, so the login in step 2 is
normally a one-time cost — later runs reuse the cookie jar.

## Requirements

- **Node.js 18+** (the script is an ESM module and uses `timers/promises`).
- **Google Chrome** installed. You don't need to install ChromeDriver — `selenium-webdriver`
  4.x resolves a matching driver automatically via Selenium Manager.
- **macOS** for the audible alert and notification (`afplay` + `osascript`). Everything else
  runs anywhere; on other platforms you just get the terminal bell.
- A Poshmark account.

## Setup

```bash
git clone <this repo>
cd poshmark-share-script
npm install
```

Create a `.env` in the project root:

```dotenv
EMAIL=you@example.com
PASSWORD=your-poshmark-password
USERNAME=your-poshmark-username
USER_DATA_DIRECTORY=/absolute/path/to/a/chrome/profile
```

| Variable              | Required | Notes                                                                     |
| --------------------- | -------- | ------------------------------------------------------------------------- |
| `EMAIL`               | yes      | Poshmark login email.                                                      |
| `PASSWORD`            | yes      | Poshmark password.                                                         |
| `USERNAME`            | yes      | Your Poshmark handle — used to build the closet URL.                       |
| `USER_DATA_DIRECTORY` | no       | Where to keep the bot's Chrome profile. Defaults to `~/.poshmark-chrome-profile`. |

`.env*` is gitignored, so your credentials stay local.

> **Use a profile directory of its own.** It must not be a profile that another running Chrome
> already has open — the two will fight over the directory lock and Chrome won't start. The
> default path is already separate from your everyday profile, which means you can keep
> browsing normally while the bot runs.

## Running it

```bash
npm run bot
```

A Chrome window opens and drives itself. Keep an ear out: if you hear the alert sound, the bot
needs you to type a verification code or clear a captcha in that window.
## Tuning

The knobs are constants at the top of `src/script.js`:

| Constant               | Default | What it controls                                                    |
| ---------------------- | ------- | ------------------------------------------------------------------- |
| `SCROLL_DURATION`      | 10s     | How long to scroll the closet. Raise it if a large closet isn't fully loading. |
| `VERIFICATION_TIMEOUT` | 5 min   | How long to wait for you to enter a one-time code.                   |
| `CAPTCHA_REALERT`      | 30s     | How often to re-alert while a captcha sits unsolved.                 |
| `LOGIN_CTA_TIMEOUT`    | 10s     | How long to wait for the header before deciding you're signed in.    |
| `MAX_RUNS`             | 20      | How many share passes to make before quitting.                       |

## Layout

```
src/script.js   the bot: login, session reuse, scroll, share, captcha handling
src/notify.js   the alert helper (terminal bell, macOS sound + notification)
```

## Notes

This automates a site that doesn't publish an API for it, against selectors
(`data-et-name`, `data-test`, class names) that Poshmark can change at any time. When a run
starts failing, a changed selector is the first thing to check. Share rate limits and captchas
are Poshmark's way of telling you to slow down — the random delays between passes exist for
that reason, so be reasonable about how often you run it.
