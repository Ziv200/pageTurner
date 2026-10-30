const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pt', {
    info: () => ipcRenderer.invoke('info'),
    chooseFolder: () => ipcRenderer.invoke('choose-folder'),
    openAudioMidiSetup: () => ipcRenderer.invoke('open-audio-midi-setup'),
    setMidi: n => ipcRenderer.invoke('set-midi', n),
    openUrl: u => ipcRenderer.invoke('open-url', u),
    finish: o => ipcRenderer.invoke('finish-setup', o)
});
