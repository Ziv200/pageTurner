# 🎵 MIDI Page Turner

**A real-time, MIDI-controlled PDF music score viewer for live performance.**

This application allows you to turn pages of a PDF score wirelessly on your iPad (or any device with a web browser) using MIDI messages sent from your DAW (Ableton Live, Logic Pro, etc.) running on your main computer.

---

## ✨ Features

*   **Wireless Page Turning:** View scores on an iPad while controlling them from your laptop.
*   **MIDI Integration:** Responds to MIDI `Program Change` messages to jump to specific pages instantly.
*   **Zero-Lag Manual Control:** Touch zones on the client device allow for manual turning (Left = Previous, Right = Next).
*   **Auto-Reconnect:** Automatically attempts to connect to available MIDI ports (e.g., IAC Driver).
*   **Local PDF Loading:** Load PDF files directly from the client device (iPad) without uploading them to the server for privacy and speed.
*   **Dynamic MIDI Routing:** Select and switch MIDI input ports directly from the web interface.

---

## 🛠️ System Requirements

### Hardware
1.  **Host Computer (Server):**
    *   Mac (recommended), Windows, or Linux.
    *   Must be connected to the same Wi-Fi network as the viewing device.
2.  **Viewing Device (Client):**
    *   iPad, Android Tablet, Laptop, or any device with a modern web browser (Safari, Chrome).
3.  **MIDI Connection:**
    *   **Internal:** Virtual MIDI bus (e.g., IAC Driver on macOS) if the DAW and Server are on the same machine.
    *   **External:** USB MIDI interface if connecting external hardware.

### Software
*   **Node.js**: Runtime environment required to run the server. [Download Node.js](https://nodejs.org/)
*   **DAW / MIDI Sender**: Ableton Live, Logic Pro, MainStage, or any software capable of sending MIDI `Program Change` messages.

---

## 🚀 Installation

1.  **Clone or Download** this repository to your computer.
2.  Open your terminal/command prompt.
3.  Navigate to the project folder:
    ```bash
    cd path/to/pageTurner
    ```
4.  **Install Dependencies**:
    ```bash
    npm install
    ```

---

## 📖 Usage Guide

### 1. Start the Server

**On macOS (Easy Method):**
*   Double-click the `PageTurner.command` file in the project folder.

**Via Terminal:**
```bash
npm start
```

*The server will start and display your local IP address, e.g., `http://192.168.1.5:3000`.*

### 2. Connect the Client (iPad/Tablet)
**Choose one of the following methods:**

#### Method A: Standard Wi-Fi Control
*Best for rehearsals or when a router is available.*
1.  Ensure both your computer and iPad are on the **exact same Wi-Fi network**.
2.  Use the IP address displayed in the terminal (usually `192.168.x.x` or `10.0.x.x`).

#### Method B: Wired Offline Control (USB) ⚡️
*Best for live shows. Low latency, no Wi-Fi interference, 100% reliable.*
1.  **Configure Mac Settings (Crucial!):**
    *   Go to **System Settings** -> **General** -> **Sharing**.
    *   **Do NOT** use "Content Caching" (common mistake).
    *   Find **Internet Sharing** (click the `i` info icon).
    *   "Share your connection from": Choose anything (e.g. Wi-Fi or Ethernet).
    *   "To computers using": **Check "iPhone USB"**.
    *   **Turn the main "Internet Sharing" toggle ON.**
2.  **Connect iPad in this order:**
    *   Unplug the iPad USB cable.
    *   Wait 5 seconds.
    *   Plug it back in (Say "Trust" on iPad if asked).
3.  **Find the Address:**
    *   **Recommended:** Use your computer's local name directly.
        Type this into Safari on iPad:
        👉 `http://MacBook-Pro-Ilan.local:3000`
        *(Replace `MacBook-Pro-Ilan` with your actual computer name found in System Settings -> General -> Sharing).*
    *   **Alternative:** Run `npm start` and look for a **Bridge** IP (often `192.168.2.x`) or a **Link-Local** IP (`169.254.x.x`).

### 3. Load a Score

1.  On the iPad, tap the **"Load PDF"** button (or the gear icon ⚙️ in the top right).
2.  Select a PDF file from your device's files (iCloud Drive, On My iPad, etc.).
3.  The score will render immediately.

### 4. Configure MIDI (The "Auto-Turn" Setup)

The app listens for MIDI **Program Change** messages. Numbers match what **Ableton displays** ("Pgm N", 1-128).

**Mapping Rule (no Composer project active):** `Ableton Pgm N -> Page N`
*   Ableton `Pgm 1` (MIDI value 0) -> Page 1
*   Ableton `Pgm 2` (MIDI value 1) -> Page 2
*   Ableton `Pgm 128` (MIDI value 127) -> Page 128

#### Setup in Ableton Live (Example):
1.  **Enable IAC Driver (macOS):**
    *   Open "Audio MIDI Setup" -> Window -> Show MIDI Studio.
    *   Double-click "IAC Driver" and ensure "Device is online" is checked.
2.  **App MIDI Settings:**
    *   In the web app on your iPad, click the **Gear Icon (⚙️)**.
    *   Under **MIDI Port**, select sending source (e.g., "IAC Driver Bus 1" or "Bus 2").
    *   *Note: The app tries to auto-connect to "Bus 2" or "IAC Driver" on startup.*
3.  **Ableton Clips:**
    *   Create a MIDI Clip.
    *   In the "Notes/Pgm Change" section, set **Pgm Change** to `1` (for Page 2), `2` (for Page 3), etc.
    *   Launch the clip to turn the page!

---

## 🕹️ Manual Controls

*   **Next Page:** Tap the **Right 30%** of the screen.
*   **Previous Page:** Tap the **Left 30%** of the screen.
*   **Settings:** Tap the **Gear Icon (⚙️)** (top-right) to change MIDI ports or load a new PDF.

---

## 🔧 Troubleshooting

*   **"npm command not found"**: You need to install Node.js.
*   **"OFFLINE MODE DETECTED"**:
    *   This means your Mac hasn't assigned an IP to the USB cable yet.
    *   **Fix:** Toggle "Internet Sharing" OFF -> Wait 5s -> Turn ON. Then Replug iPad.
*   **MIDI not working**:
    *   Check the server console log. It should say `Listening to MIDI Input: "Your Port"`.
    *   Open the Settings menu on the iPad and manually select the correct port.
    *   Ensure your DAW is sending to the *same* port name (e.g., "IAC Driver Bus 1").

---

## 🧩 Composer (Program Change table)

Composer maps MIDI **Program Change** numbers to a **song (PDF) and page**. You load PDFs into Composer, and the saved project (`.pdset`) contains the PDFs inside it, so it never depends on the original files. Nothing is uploaded anywhere or merged.

**Run it:** start PageTurner as usual, then open **http://localhost:3000/composer/** in a browser on the Mac. (Composer only accepts requests from the Mac itself, because it reads and writes local files. Set `COMPOSER_REMOTE=1` before starting the server to allow other devices.)

**Workflow**
1. Drag PDF files onto the page, or press *Choose PDFs…* (you can add more at any time; same-named files are renamed `name (2).pdf`). The list shows each PDF's pages and size, plus the project's total size. ✕ removes a PDF (it warns, and deletes the rows that use it).
2. Build the table. Each row = `Program Change (1–128)` → `Song` → `Page`. Example: Pgm 1 → `example.pdf` page 2, Pgm 2 → `example.pdf` page 1. A song can appear in many rows, numbers can be in any order.
   - *Add row*, *Duplicate*, ✕ remove, *Sort by PC*, *Sort by name*: orders rows by the number at the start of the PDF name (`1 Intro.pdf`, `02 - Song.pdf`, `10_Final.pdf`; numeric, so 2 comes before 10), then the rest of the name, then page; unnumbered names go last. PC numbers are never changed. The PDF list and *Add all songs* use the same order.
   - *Add all songs to table*: adds one row (page 1, lowest free PC) for every loaded PDF not already used in a row; songs already in the table are skipped.
   - *Auto-fill*: pick a song and a start number to create one row per page of that song.
   - Red rows: duplicate or invalid PC, a song that is not loaded, damaged PDF. Orange rows: page number beyond the PDF's page count.
3. *Save as project* writes one self-contained file, `~/PageTurnerProjects/<name>.pdset`, with all PDFs inside. After that you can move or delete the original PDFs. *Open…* lists saved projects; *Open .pdset file…* opens a `.pdset` from any folder (for example one you copied to another Mac). *Save & set active* also makes it the project the viewer uses (it is remembered after a restart). *Deactivate* returns to the plain behaviour. *Download .pdset* saves a copy through the browser.
4. *Test* on a row sends that Program Change through the same server code as real MIDI, so you can check the iPad without Ableton (the project must be saved and active).

**.pdset format (version 3)**: one binary file: the 8 bytes `PDSET3\0\0`, a 4-byte big-endian header length, a JSON header, then the raw PDF bytes one after another. Header: `{ "version": 3, "name": "...", "rows": [ { "pc": 1, "song": "example.pdf", "page": 2 } ], "pdfs": [ { "name": "example.pdf", "size": 12345, "pages": 3 } ] }`. PDF positions are derived from the sizes, and the PDFs are stored unchanged (no re-encoding, no base64), so the file is only slightly larger than the PDFs and big projects stream to disk without being loaded into memory twice. Limit: 2 GB per project (`COMPOSER_MAX_BYTES` to change). Old version 2 (folder-based) projects cannot be opened; load the PDFs and save again.

**Viewer / MIDI behaviour**
- *Active project:* a Program Change with a row in the table opens that song (if not already open) and jumps to the page. The top of the screen shows `Pgm N · song · page`. A Program Change with no row shows a short red notice and changes nothing. The server serves only the PDFs embedded in the active project; the iPad downloads them over HTTP and keeps them cached, so changing page inside the same song is instant. Tapping the left/right zones still turns pages within the current song. If the iPad reloads or reconnects, it returns to the song and page last selected.
- *No active project:* exactly as before. Load a PDF on the device, and Ableton `Pgm N` jumps to page *N*.
- Program Change numbers in the table are the numbers **as displayed by Ableton** (`Pgm N`, 1–128). The server converts the raw MIDI value (0–127) to N = value + 1, in one place, for both real MIDI and the Test button. Projects saved earlier keep their stored numbers unchanged (no migration): a row with number 0 now shows red as invalid and must be changed to 1–128, and other rows may need +1 if they were entered as raw values.

**Ports:** Composer uses the same server and port 3000 as PageTurner (`PORT=…` to change). It does not touch AbleSet on port 80.
