const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
	notify: (title, body) => ipcRenderer.send('deposits:notify', title, body),
	setPendingCount: (count) => ipcRenderer.send('deposits:count', count)
});
