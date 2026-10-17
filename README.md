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

The app listens for MIDI **Program Change** messages. It maps the Program Change number to the Page Number.

**Mapping Rule:** `Page Number = MIDI Program Value + 1`
*   MIDI `0` -> Page 1
*   MIDI `1` -> Page 2
*   MIDI `127` -> Page 128

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

Composer maps MIDI **Program Change** numbers to a **song (PDF) and page**. Your PDFs stay in one folder on the Mac; nothing is uploaded or merged.

**Run it:** start PageTurner as usual, then open **http://localhost:3000/composer/** in a browser on the Mac. (Composer only accepts requests from the Mac itself, because it reads and writes local files. Set `COMPOSER_REMOTE=1` before starting the server to allow other devices.)

**Workflow**
1. Type or paste the folder path (or press *Browse…*) and press *Load folder*. Only real `.pdf` files directly inside that folder are listed.
2. Build the table. Each row = `Program Change (0–127)` → `Song` → `Page`. Example: PC 1 → `example.pdf` page 2, PC 2 → `example.pdf` page 1. A song can appear in many rows, numbers can be in any order.
   - *Add row*, *Duplicate*, ✕ remove, *Sort by PC*.
   - *Auto-fill*: pick a song and a start number to create one row per page of that song.
   - Red rows: duplicate or invalid PC, missing file or folder, damaged PDF. Orange rows: page number beyond the PDF's page count.
3. *Save* writes `~/PageTurnerProjects/<name>.pdset`. *Save & set active* also makes it the project the viewer uses (it is remembered after a restart). *Deactivate* returns to the plain behaviour. *Download .pdset* / *Open .pdset file…* copy a project file manually.
4. *Test* on a row sends that Program Change through the same server code as real MIDI, so you can check the iPad without Ableton (the project must be saved and active).

**.pdset format** (JSON): `{ "version": 2, "name": "...", "folder": "/absolute/path", "rows": [ { "pc": 1, "song": "example.pdf", "page": 2 } ] }`

**Viewer / MIDI behaviour**
- *Active project:* a Program Change with a row in the table opens that song (if not already open) and jumps to the page. The top of the screen shows `PC · song · page`. A Program Change with no row shows a short red notice and changes nothing. The iPad downloads the PDFs from the Mac over HTTP and keeps them cached, so changing page inside the same song is instant. Tapping the left/right zones still turns pages within the current song. If the iPad reloads or reconnects, it returns to the song and page last selected.
- *No active project:* exactly as before. Load a PDF on the device, and Program Change *n* jumps to page *n + 1*.
- Program Change numbers in the table are the raw MIDI values (0–127), as Ableton sends them.

**Ports:** Composer uses the same server and port 3000 as PageTurner (`PORT=…` to change). It does not touch AbleSet on port 80.
