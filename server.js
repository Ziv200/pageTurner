const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const easymidi = require('easymidi');
const path = require('path');
const ip = require('ip');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Enable static file serving
app.use(express.static(path.join(__dirname, 'public')));
app.use('/lib', express.static(path.join(__dirname, 'node_modules/pdfjs-dist/build')));

// MIDI Setup
const inputs = easymidi.getInputs();
console.log('Available MIDI Inputs:', inputs);

// Check if a specific input was requested via command line
// Usage: node server.js "My MIDI Device"
const requestedInput = process.argv[2];

let midiInputName;

if (requestedInput) {
    // Try to find exact match or partial match for the requested name
    midiInputName = inputs.find(name => name.toLowerCase().includes(requestedInput.toLowerCase()));
    if (!midiInputName) {
        console.warn(`\n⚠️ Requested MIDI input "${requestedInput}" not found.`);
        console.warn('Available inputs:', inputs);
    }
}

// Fallback: Custom logic if no specific input requested or found
if (!midiInputName) {
    // We look for "IAC" or "Bus 1" as common inter-app drivers
    midiInputName = inputs.find(name => name.includes('IAC') || name.includes('Bus 2'));
}

// Fallback to the first available input if still null
if (!midiInputName && inputs.length > 0) {
    midiInputName = inputs[0];
    console.log(`No preferred driver found. Defaulting to first input: ${midiInputName}`);
}

if (midiInputName) {
    try {
        const input = new easymidi.Input(midiInputName);
        console.log(`\n✅ Listening to MIDI Input: "${midiInputName}"`);
        console.log('   Mapping: MIDI Program Change -> PDF Page Number');



        // Also listen for Program Change if user prefers that later
        input.on('program', (msg) => {
            // User reports they are getting 1 page before the right one.
            // This means they send "2" -> We receive "1" -> We need to go to "2".
            // So we restore the +1 offset (Standard MIDI is 0-indexed).
            const pageNumber = msg.number + 1;

            console.log(`🎛️ MIDI Program Change (Raw: ${msg.number}) -> Jump to Page ${pageNumber}`);
            io.emit('page_change', { page: pageNumber });
        });

    } catch (err) {
        console.error('❌ Error connecting to MIDI input:', err);
    }
} else {
    console.log('\n⚠️ No MIDI Inputs found! Make sure IAC Driver is enabled in Audio MIDI Setup.');
}

// Socket.io Connection
io.on('connection', (socket) => {
    console.log('📱 Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Start Server
server.listen(PORT, () => {
    const localIp = ip.address();
    console.log('\n🚀 Server running!');
    console.log(`\n👉 ON YOUR IPAD, OPEN: http://${localIp}:${PORT}`);
    console.log('-----------------------------------------------');
});
