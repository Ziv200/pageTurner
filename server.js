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

// MIDI State
let midiInput = null;
let currentMidiInputName = null;

function getMidiPorts() {
    return easymidi.getInputs();
}

function closeMidiPort() {
    if (midiInput) {
        try {
            midiInput.close();
        } catch (e) {
            console.error('Error closing MIDI port:', e);
        }
        midiInput = null;
    }
}

function setMidiPort(portName) {
    if (portName === currentMidiInputName && midiInput) {
        console.log(`Already connected to ${portName}`);
        return true;
    }

    closeMidiPort();

    try {
        const inputs = getMidiPorts();
        // Exact match or fallback to partial match
        const exactMatch = inputs.find(i => i === portName);
        // If exact match not found, try finding one that includes the name (logic from before)
        const targetName = exactMatch || inputs.find(i => i.toLowerCase().includes(portName.toLowerCase()));

        if (!targetName) {
            console.warn(`MIDI Input "${portName}" not found.`);
            return false;
        }

        midiInput = new easymidi.Input(targetName);
        currentMidiInputName = targetName;

        console.log(`\n✅ Listening to MIDI Input: "${targetName}"`);
        console.log('   Mapping: MIDI Program Change -> PDF Page Number');

        midiInput.on('program', (msg) => {
            const pageNumber = msg.number + 1;
            console.log(`🎛️ MIDI Program Change (Raw: ${msg.number}) -> Jump to Page ${pageNumber}`);
            io.emit('page_change', { page: pageNumber });
        });

        return true;
    } catch (err) {
        console.error('❌ Error connecting to MIDI input:', err);
        currentMidiInputName = null;
        return false;
    }
}

// Initial Setup
const inputs = getMidiPorts();
console.log('Available MIDI Inputs:', inputs);

// Check command line arg
const requestedInput = process.argv[2];
let initialPort = null;

if (requestedInput) {
    initialPort = inputs.find(name => name.toLowerCase().includes(requestedInput.toLowerCase()));
}

// Fallback logic
if (!initialPort) {
    // 1. Priority: Look specifically for "Bus 2" (common for this setup)
    initialPort = inputs.find(name => name.includes('Bus 2'));
}
if (!initialPort) {
    // 2. Secondary: Look for any "IAC" driver
    initialPort = inputs.find(name => name.includes('IAC'));
}
if (!initialPort && inputs.length > 0) {
    initialPort = inputs[0];
}

if (initialPort) {
    setMidiPort(initialPort);
} else {
    console.log('\n⚠️ No MIDI Inputs found! Make sure IAC Driver is enabled in Audio MIDI Setup.');
}

// Socket.io Connection
io.on('connection', (socket) => {
    console.log('📱 Client connected:', socket.id);

    // Send current state on connection
    socket.emit('midi_status', {
        connectedPort: currentMidiInputName,
        availablePorts: getMidiPorts()
    });

    socket.on('get_midi_ports', () => {
        socket.emit('midi_ports_list', {
            ports: getMidiPorts(),
            active: currentMidiInputName
        });
    });

    socket.on('set_midi_port', (portName) => {
        console.log(`Client requested to switch MIDI port to: ${portName}`);
        const success = setMidiPort(portName);
        // Broadcast new status to all clients
        io.emit('midi_status', {
            connectedPort: currentMidiInputName,
            availablePorts: getMidiPorts()
        });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Start Server
server.listen(PORT, () => {
    console.log('\n🚀 Server running!');
    console.log('-----------------------------------------------');
    console.log('📡 Available Network Addresses:');

    const os = require('os');
    const interfaces = os.networkInterfaces();
    let externalCount = 0;

    Object.keys(interfaces).forEach((ifname) => {
        interfaces[ifname].forEach((iface) => {
            // Only show IPv4, non-internal (skip localhost)
            if ('IPv4' === iface.family && !iface.internal) {
                console.log(`   👉 http://${iface.address}:${PORT}  (${ifname})`);
                externalCount++;
            }
        });
    });

    if (externalCount === 0) {
        console.log('   (No external network addresses found)');
        console.log('\n⚠️  OFFLINE MODE DETECTED');
        console.log('   Your Mac has not assigned an IP address to the USB cable yet.');
        console.log('   1. Toggle "Internet Sharing" OFF and back ON in System Settings.');
        console.log('   2. Unplug and replug the iPad.');
        console.log('   3. Restart this server.');

        console.log('\n🏠 Localhost (Mac only):');
        console.log(`   👉 http://127.0.0.1:${PORT}`);
    }

    console.log('\nℹ️  Tip: If offline/USB, try the address starting with 192.x or 169.x');
    console.log('-----------------------------------------------');
});

