require('dotenv').config()
const { By, Builder, Browser, until } = require('selenium-webdriver');
const { Options } = require('selenium-webdriver/chrome');
const { setTimeout: setTimeoutPromise } = require("timers/promises");
const { clearInterval } = require('timers');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { alertUser } = require('./notify');

const { EMAIL, PASSWORD, USERNAME, USER_DATA_DIRECTORY } = process.env

const CLOSET_URL = `https://poshmark.com/closet/${USERNAME}?availability=available`

// a chrome profile used only by this bot. keeping it out of the regular profile means the two
// never fight over the directory lock, and regular browsing can stay open while this runs.
const PROFILE_DIRECTORY = USER_DATA_DIRECTORY || path.join(os.homedir(), '.poshmark-chrome-profile')

// how long to spend scrolling the closet to pull in every listing
const SCROLL_DURATION = 10 * 1000

// the header renders this cta only when nobody is signed in
const LOGIN_CTA = '[data-et-name="intro_tap_login"]'

// how long to wait for the header to paint before trusting the absence of that cta
const LOGIN_CTA_TIMEOUT = 10 * 1000

// how long to give the user to type a one-time verification code by hand
const VERIFICATION_TIMEOUT = 5 * 60 * 1000

// how often to re-ping while a captcha is still sitting there unsolved
const CAPTCHA_REALERT = 30 * 1000

// chrome will populate the profile itself, but the directory has to be there first - and on a
// nested path chrome won't create the intermediate folders.
const ensureProfileDirectory = () => {
  fs.mkdirSync(PROFILE_DIRECTORY, { recursive: true })

  // an empty directory means chrome has never initialised this profile, so there's no session in it
  if (fs.readdirSync(PROFILE_DIRECTORY).length === 0) {
    console.log(`fresh chrome profile at ${PROFILE_DIRECTORY} - expect a one-time login`)
  }
}

const buildDriver = async () => {
  ensureProfileDirectory()

  const options = new Options()

  // point chrome at a persisted profile so the poshmark session outlives a single run.
  // this must NOT be a profile that another running chrome already has open.
  options.addArguments(`--user-data-dir=${PROFILE_DIRECTORY}`)
  // pin the profile so chrome doesn't stop on the picker, and skip the first-run screens
  options.addArguments('--profile-directory=Default')
  options.addArguments('--no-first-run', '--no-default-browser-check')
  console.log(`using chrome profile at ${PROFILE_DIRECTORY}`)

  return await new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeOptions(options)
    .build();
}

const main = async () => {
  const driver = await buildDriver();

  try {
    await loginAndRunInitialSetup(driver)

    let run = 0
    let maxRun = 20

   while (run <= maxRun) {
      console.log(`currentRun: ${run}`)
      await share(driver)
      await setTimeoutPromise(randomIntFromInterval(3000, 10000))
      run += 1
    }
  } catch (err) {
    console.log(err)
  } finally {
    await driver.quit();
    process.exit(0)
  }
}

const loginAndRunInitialSetup = async (driver) => {
  // a persisted profile may already hold a valid session, so try the closet before logging in
  await driver.get(CLOSET_URL);
  // if this doesn't say poshmark, the window selenium is driving isn't the one on screen
  console.log(`landed on ${await driver.getCurrentUrl()}`)
  await handleCookieBanner(driver)

  if (await isLoggedOut(driver)) {
    console.log("no saved session, logging in")
    await logIn(driver)
    await driver.get(CLOSET_URL);
  } else {
    console.log("reusing the session from the saved chrome profile")
  }

  await handlePromoDialog(driver)
}

// the "Log in / Sign up" cta in the header is only rendered for signed-out visitors, so its
// presence is a direct read on the session rather than an inference from the url.
const isLoggedOut = async (driver) => {
  try {
    // wait rather than checking once: a cta that simply hasn't painted yet would otherwise
    // look identical to a live session, and we'd carry on unauthenticated.
    await driver.wait(until.elementLocated(By.css(LOGIN_CTA)), LOGIN_CTA_TIMEOUT)
    return true
  } catch (err) {
    return false
  }
}

const logIn = async (driver) => {
  await driver.get('https://poshmark.com/login?pmrd%5Burl%5D=%2F');
  await handleCookieBanner(driver)
  const emailTextbox = await driver.findElement(By.name('login_form[username_email]'));
  await emailTextbox.sendKeys(EMAIL);
  const passwordTextbox = await driver.findElement(By.name('login_form[password]'));
  await passwordTextbox.sendKeys(PASSWORD);
  const loginButton = await driver.findElement(By.css("[data-et-name='login']"));
  await loginButton.click()

  // login can pause on a one-time code, so don't navigate away until we're actually through
  await handleVerificationCode(driver)
  // poshmark can also gate on a verify-email modal and a data-consent prompt once the
  // password is accepted. both no-op when they don't appear.
  await handleVerificationDialog(driver)
  await handleDataConsetDialog(driver)
}

const handleVerificationCode = async (driver) => {
  // poshmark sometimes asks for a one-time code after the password is accepted.
  // give the page 5 seconds to settle before deciding whether that happened.
  await setTimeoutPromise(5000);

  if (!(await isOnLoginPage(driver))) {
    console.log("no verification code required")
    return
  }

  alertUser('poshmark bot needs you', 'enter the verification code in chrome')
  await driver.wait(
    async () => !(await isOnLoginPage(driver)),
    VERIFICATION_TIMEOUT,
    "timed out waiting for the verification code to be entered",
    1000
  )
  console.log("verification complete")
}

// used both to detect a dead/absent session and to tell whether the one-time code went through.
// a mistyped code keeps us here too, re-rendered with an error_banner--type-InvalidOneTimePassword.
const isOnLoginPage = async (driver) => {
  const url = await driver.getCurrentUrl()
  return url.includes('/login')
}

const handleCookieBanner = async (driver) => {
  // the cookie banner sits on top of the login button, so dismiss it before filling in the form
  try {
    const okButton = await driver.wait(
      until.elementLocated(By.css('[data-et-on-name="info_cookie_banner"][data-et-name="ok"]')),
      5000
    );
    await driver.wait(until.elementIsVisible(okButton), 5000);
    await okButton.click()
    // let the banner finish animating out before anything tries to click through where it was
    await setTimeoutPromise(500);
    console.log("dismissed cookie banner")
  } catch (err) {
    console.log("cookie banner did not appear")
  }
}

const handleVerificationDialog = async (driver) => {
  // close the verification promo model if it appears
  let continueCheck = true
  while (continueCheck) {
    try {
      await setTimeoutPromise(5000);
      // const verificationDialog = await driver.findElement(By.xpath("//h5[contains(text(),'Verify Email')]"));
      await driver.findElement(By.css('[data-test="modal-body"]'));
    } catch (err) {
      console.log("verification dialog did not appear, continuing")
      continueCheck = false
    }
  }
}

const handleDataConsetDialog = async (driver) => {
  try {
    await setTimeoutPromise(5000);
    const consetButton = await driver.findElement(By.css('[aria-label="Consent"]'));
    await consetButton.click()
  } catch (err) {
    console.log("data consent dialog did not appear")
  }
}

const handlePromoDialog = async (driver) => {
  // close the promo model if it appears
  try {
    await setTimeoutPromise(3000);
    const promotedClosetCloseButton = await driver.findElement(By.css('[data-et-on-name="promoted_closet_invite_modal"]'));
    await promotedClosetCloseButton.click()
  } catch (err) {
    console.log("promo did not appear")
  }
}

const share = async (driver) => {
  let captchaCheckIntervalId = null
  let sharingIntervalId = null

  try {
    // keep jumping to the bottom of the page so the listings lazy-load in. if this isn't
    // long enough to reach the end of the closet, raise SCROLL_DURATION.
    const scrollUntil = Date.now() + SCROLL_DURATION
    while (Date.now() < scrollUntil) {
      await driver.executeScript('window.scrollTo(0, document.body.scrollHeight)')
      await setTimeoutPromise(randomIntFromInterval(500, 1000));
    }

    // scroll back up to the top
    const userInfo = driver.findElement(By.className("closet__header__info__user-details__actions"));
    const actions = driver.actions({ async: true });
    await actions.move({ origin: userInfo }).perform();

    const userDropdown = await userInfo.findElement(By.css('[data-test="dropdown-container"]'))
    await userDropdown.click()

    const shareToFollowersListingsDisplayButton = await userInfo.findElement(By.css('[data-et-name="share_to_followers"]'))
    await shareToFollowersListingsDisplayButton.click()
    // waiting for until selectAll checkbox is ready
    await setTimeoutPromise(2000);

    // check for captchas every 5 seconds. the check sits and waits while one is up, so guard
    // against the next tick re-entering it - otherwise every tick piles on another alert loop.
    let checkingForCaptcha = false
    captchaCheckIntervalId = setInterval(() => {
      if (checkingForCaptcha) return
      checkingForCaptcha = true
      waitOutCaptcha(driver)
        .catch((err) => console.log(`captcha check failed: ${err.message}`))
        .finally(() => { checkingForCaptcha = false })
    }, 5000)

    const selectAllCheckbox = await driver.findElement(By.className('tile__checkbox'))
    await selectAllCheckbox.click()

    const shareToFollowersButton = await driver.findElement(By.css('[data-et-name="share_to_followers"]'))
    await shareToFollowersButton.click()

    let sharing = true
    // while the h1 tag containing "Sharing " is on page, continually wait as the app is sharing closet
    sharingIntervalId = setInterval(async () => {
      try {
        await driver.findElement(By.xpath("//h1[contains(text(),'Sharing ')]"))
      } catch (err) {
        console.log("Can't find 'Sharing' h1 tag. Sharing is complete. Exiting")
        sharing = false
        clearInterval(sharingIntervalId)
      }
    }, 2000)

    while (sharing) {
      await setTimeoutPromise(5000);
    }

    clearInterval(captchaCheckIntervalId)
  } catch (err) {
    clearInterval(captchaCheckIntervalId)
    throw err
  }
}


// the recaptcha widget renders inside an iframe, so its checkbox markup is never reachable
// from the top-level document - the iframe itself is the only part of it we can see from
// out here, and it's enough to tell that a challenge is up.
const findCaptchaFrame = async (driver) => {
  const frames = await driver.findElements(By.css('iframe[src*="recaptcha"]'))

  for (const frame of frames) {
    try {
      if (!(await frame.isDisplayed())) continue

      // recaptcha keeps a hidden token-sized iframe on the page at all times, so size is
      // what separates a real challenge from the plumbing that's always there.
      const { width, height } = await frame.getRect()
      if (width >= 100 && height >= 50) return frame
    } catch (err) {
      // a frame can detach between the query and the checks, which just means it's gone
    }
  }

  return null
}

// nothing here tries to solve the captcha - only a person can clear it, so the job is to get
// their attention and then stay out of the way until the challenge is gone.
const waitOutCaptcha = async (driver) => {
  if (!(await findCaptchaFrame(driver))) return

  let alertedAt = 0
  while (await findCaptchaFrame(driver)) {
    // re-ping on a slow drumbeat rather than every poll, in case nobody was at the desk
    if (Date.now() - alertedAt >= CAPTCHA_REALERT) {
      alertUser('poshmark bot needs you', 'a captcha is blocking the share - solve it in chrome')
      alertedAt = Date.now()
    }
    await setTimeoutPromise(2000)
  }

  console.log("captcha cleared, back to sharing")
}

const randomIntFromInterval = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

main()
