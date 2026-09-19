import { execFile } from "child_process";

// macos ships these; sosumi is short and cuts through background noise
const SOUND_FILE = "/System/Library/Sounds/Sosumi.aiff";

// applescript string literals are double-quoted, so anything quote-ish has to be escaped
const escapeForAppleScript = (text) => text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// gets a person's attention when the bot hits something only they can clear.
const alertUser = (title, message) => {
  console.log(`${title}: ${message}`);

  // the terminal bell costs nothing and is the only part of this that works off macos
  process.stdout.write("\x07");

  if (process.platform !== "darwin") return;

  // the sound is played separately rather than via the notification's `sound name` because
  // a notification is silently dropped when the terminal has no notification permission,
  // while afplay makes noise regardless.
  execFile("afplay", [SOUND_FILE], () => {});
  execFile(
    "osascript",
    ["-e", `display notification "${escapeForAppleScript(message)}" with title "${escapeForAppleScript(title)}"`],
    () => {},
  );
};

module.exports = { alertUser };
