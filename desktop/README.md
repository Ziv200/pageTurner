# PageTurner for Mac

Shows your sheet music on an iPad and turns to the right song and page when your Mac sends a MIDI
Program Change (for example from Ableton). PageTurner lives in the **menu bar** (page icon, top right). It has no Dock icon.

Works on every Mac with macOS 11 or newer, Apple Silicon (M1–M4) and Intel (one "universal" download).

## Install
1. Open `PageTurner-1.0.0-universal.dmg` and drag **PageTurner** onto **Applications**.
2. Open PageTurner from Applications. The **first time**, macOS says it "can't be opened" or "cannot verify the developer".
   That's expected: the app isn't signed with a paid Apple developer certificate.
   - Click **Done** (not "Move to Trash").
   - Open **System Settings › Privacy & Security**, scroll down to *"PageTurner" was blocked…*, click **Open Anyway**, then confirm with your password or Touch ID.
   - You only have to do this once.
3. macOS may ask whether PageTurner may **find devices on your local network**. Click **Allow**, because the iPad needs it.

## First-run setup (opens automatically; later via menu bar › Setup…)
1. **Projects folder.** The default is `~/PageTurnerProjects`. Tick *Sample Project* to get 3 demo songs.
2. **MIDI.** Click *Open Audio MIDI Setup* › Window › Show MIDI Studio › double-click **IAC Driver** › tick **Device is online** › Apply.
   Choose the IAC bus under *Listen to*. Send a Program Change from Ableton, and *Last Program Change* will show it.
3. **iPad.** Put the iPad on the same Wi-Fi, or connect it by USB with *Internet Sharing* on. Scan the QR code with the iPad camera.
   In Safari, tap Share › **Add to Home Screen**.

## Using it
- **Composer** (menu bar › Open Composer): add PDFs, map Program Change numbers (1–128, as Ableton shows them) to a song and page,
  then press **Save & Activate**. Songs sort by the number at the start of the file name ("1 Intro.pdf", "2 …").
- **On the iPad**, page turns work by tapping the left or right edge, or with a Bluetooth page-turn pedal (arrow / Page keys).
  A red badge means the iPad lost the Mac, and it reconnects by itself. An orange badge means the MIDI input is missing.
- For gigs, set **iPad Settings › Display & Brightness › Auto-Lock › Never**.
- The menu bar shows the iPad address (click to copy), the MIDI input, the last Program Change, and the active project.
  It also has Open Projects Folder, Show Log, Launch at Login, and Quit. Quitting stops the server.
- If port 3000 is busy (for example by another PageTurner), the app uses the next free port and shows it in the menu. It never uses port 80, so AbleSet is safe.

## Troubleshooting
- **"No MIDI input"**: turn on the IAC Driver (step 2 above), then pick it in menu bar › MIDI input.
- **The iPad can't open the page**: make sure both devices are on the same network. Try the other address listed in the menu.
  With USB, switch Internet Sharing off and on again.
- **Saving over a project** keeps the previous version as `<name>.pdset.bak` in the projects folder.

## For developers
```
cd desktop
npm install            # if npm 11 skips Electron's download: node node_modules/electron/install.js
npm start              # dev run (copies ../server.js, ../composer-api.js, ../public into desktop/server/)
npm run dist           # universal .dmg in desktop/dist/   (npm run dist:split = separate arm64 + x64 dmgs)
```
The app runs the same `server.js` as `node server.js`. Env overrides: `PAGETURNER_PROJECTS` (projects folder),
`PAGETURNER_PORT` (preferred port). `PAGETURNER_SNAPSHOT=<dir>` is a test-only screenshot helper.
