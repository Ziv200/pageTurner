// Loaded via <script> tag, so pdfjsLib is global
const pdfjsLib = window['pdfjs-dist/build/pdf'];

// Worker setup
pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker.js';

const socket = io();
const url = 'score.pdf';

let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
const canvas = document.getElementById('the-canvas');
const ctx = canvas.getContext('2d');

/**
 * Get page info from document, resize canvas accordingly, and render page.
 * @param num Page number.
 */
function renderPage(num) {
    pageRendering = true;

    // Fetch page
    pdfDoc.getPage(num).then(function (page) {
        const container = document.getElementById('container');
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        // Calculate scale to fit best
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(
            containerWidth / unscaledViewport.width,
            containerHeight / unscaledViewport.height
        );

        // Some minor padding reduction
        const viewport = page.getViewport({ scale: scale * 0.98 });

        canvas.height = viewport.height;
        canvas.width = viewport.width;
        document.getElementById('loading-message').style.display = 'none';

        // Render PDF page into canvas context
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        const renderTask = page.render(renderContext);

        // Wait for render to finish
        renderTask.promise.then(function () {
            pageRendering = false;
            canvas.style.display = 'block'; // Show canvas after rendering
            if (pageNumPending !== null) {
                // New page request while rendering
                renderPage(pageNumPending);
                pageNumPending = null;
            }

            // Update Page Indicator
            const indicator = document.getElementById('page-indicator');
            if (indicator) {
                indicator.innerText = `${pageNum} / ${pdfDoc.numPages}`;
            }
        });
    });
}

/**
 * If another page rendering in progress, waits until the rendering is
 * finised. Otherwise, executes rendering immediately.
 */
function queueRenderPage(num) {
    if (pageRendering) {
        pageNumPending = num;
    } else {
        renderPage(num);
    }
}



/**
 * Empty State Logic
 */
const emptyState = document.getElementById('empty-state');
const mainLoadBtn = document.getElementById('main-load-btn');
const loadingMessage = document.getElementById('loading-message');
const filenameDisplay = document.getElementById('filename-display');

function showEmptyState() {
    canvas.style.display = 'none';
    if (loadingMessage) loadingMessage.style.display = 'none';
    filenameDisplay.style.display = 'none';
    emptyState.style.display = 'flex';
}

function hideEmptyState() {
    emptyState.style.display = 'none';
    canvas.style.display = 'block';
    filenameDisplay.style.display = 'block';
}

// Initial state
showEmptyState();

// Main "Load PDF" button triggers the file input in settings
mainLoadBtn.addEventListener('click', () => {
    // We can just click the file input directly, or open settings.
    // Opening settings is clearer as it shows context.
    // user wants "load file button" -> clicking it should probably just pick file
    // but the input is in the modal. Let's trigger the input click directly for smoother UX
    // but note: file input is hidden in settings logic usually? 
    // It's visible in settings. Let's redirect to opening the file dialog directly.
    pdfUploadInput.click();
});


/**
 * Asynchronously downloads PDF.
 */
// REMOVED DEFAULT LOADING
// pdfjsLib.getDocument(url).promise.then(...)

// Socket Listeners
socket.on('connect', () => {
    console.log('Socket Connected! ID: ' + socket.id);
});

socket.on('page_change', function (data) {
    console.log('Event: page_change -> ' + data.page);
    const requestedPage = parseInt(data.page);

    if (pdfDoc && requestedPage >= 1 && requestedPage <= pdfDoc.numPages) {
        pageNum = requestedPage;
        queueRenderPage(pageNum);
    } else if (pdfDoc) {
        console.warn(`Requested page ${requestedPage} is out of bounds (1-${pdfDoc.numPages})`);
    }
});

// Manual Navigation (Tap/Click)
// Navigation Handler
function handleNavigation(e) {
    // If modal is open, verify clicks are not on the settings button
    if (document.getElementById('settings-modal').style.display === 'flex') {
        return;
    }

    if (!pdfDoc) return;

    // Prevent double firing if both touch and click events occur
    if (e.type === 'touchend') {
        e.preventDefault();
    }

    const width = window.innerWidth;
    // Handle both mouse/click and touch events
    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;

    // Check if click is on settings button - if so, ignore navigation
    // This is a safety check, though z-index should handle it
    const settingsBtn = document.getElementById('settings-btn');
    const rect = settingsBtn.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right &&
        (e.changedTouches ? e.changedTouches[0].clientY : e.clientY) >= rect.top &&
        (e.changedTouches ? e.changedTouches[0].clientY : e.clientY) <= rect.bottom) {
        return;
    }

    // Left 30% -> Previous Page
    if (clientX < width * 0.3) {
        if (pageNum <= 1) return;
        pageNum--;
        queueRenderPage(pageNum);
    }
    // Right 30% -> Next Page
    else if (clientX > width * 0.7) {
        if (pageNum >= pdfDoc.numPages) return;
        pageNum++;
        queueRenderPage(pageNum);
    }
}

// Manual Navigation (Tap/Click)
window.addEventListener('click', (e) => {
    // Check if target is inside modal or is settings button
    if (e.target.closest('#settings-modal') || e.target.closest('#settings-btn')) {
        return;
    }
    handleNavigation(e);
});
window.addEventListener('touchend', (e) => {
    // Check if target is inside modal or is settings button
    if (e.target.closest('#settings-modal') || e.target.closest('#settings-btn')) {
        return;
    }
    handleNavigation(e);
}, { passive: false });


// --- Settings UI Logic ---
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const midiPortSelect = document.getElementById('midi-port-select');
const pdfUploadInput = document.getElementById('pdf-upload');

// Open Modal
settingsBtn.addEventListener('click', () => {
    settingsModal.style.display = 'flex';
    socket.emit('get_midi_ports'); // Refresh ports when opening
});

// Close Modal
closeSettingsBtn.addEventListener('click', () => {
    settingsModal.style.display = 'none';
});

// Select MIDI Port
midiPortSelect.addEventListener('change', (e) => {
    const selectedPort = e.target.value;
    if (selectedPort) {
        socket.emit('set_midi_port', selectedPort);
    }
});

// Load Local PDF
pdfUploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
        const fileReader = new FileReader();

        fileReader.onload = function () {
            const typedarray = new Uint8Array(this.result);

            // Unload current PDF if any (optional, but good practice if we were tracking more state)
            pdfDoc = null;
            pageNum = 1;
            document.getElementById('loading-message').style.display = 'block';
            document.getElementById('loading-message').innerText = `Loading ${file.name}...`;
            canvas.style.display = 'none';

            // Load the new PDF
            pdfjsLib.getDocument(typedarray).promise.then(function (pdfDoc_) {
                pdfDoc = pdfDoc_;
                console.log('Local PDF Loaded. Pages: ' + pdfDoc.numPages);

                filenameDisplay.innerText = file.name;
                hideEmptyState(); // Show canvas, hide empty state

                // Close modal automatically on success (optional, user might prefer it stays open)
                // settingsModal.style.display = 'none'; 

                renderPage(pageNum);
            }, function (reason) {
                console.error('Error loading local PDF:', reason);
                alert('Error loading PDF: ' + reason);
            });
        };

        fileReader.readAsArrayBuffer(file);
    }
});

// --- Socket.io MIDI Events ---
socket.on('midi_status', (data) => {
    updateMidiList(data.availablePorts, data.connectedPort);
});

socket.on('midi_ports_list', (data) => {
    updateMidiList(data.ports, data.active);
});

function updateMidiList(ports, activePort) {
    midiPortSelect.innerHTML = ''; // Clear existing

    if (ports.length === 0) {
        const option = document.createElement('option');
        option.text = "No MIDI Ports Found";
        option.disabled = true;
        midiPortSelect.appendChild(option);
        return;
    }

    ports.forEach(port => {
        const option = document.createElement('option');
        option.value = port;
        option.text = port;
        if (port === activePort) {
            option.selected = true;
        }
        midiPortSelect.appendChild(option);
    });
}
