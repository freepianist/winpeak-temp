const { app, BrowserWindow, Menu, Notification, Tray, clipboard, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');

const APP_ID = 'com.depositrequests.desktop';
const ICON_PATH = path.join(__dirname, 'build', 'icon.png');
const DASHBOARD_URL = new URL(process.env.DASHBOARD_URL || 'https://winpeak-temp.vercel.app').origin;

let win = null;
let tray = null;
let quitting = false;
let pendingCount = 0;

function loadApp() {
	win.loadURL(DASHBOARD_URL);
}

function showWindow() {
	if (!win) return;
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
	win.flashFrame(false);
}

function updateTray() {
	if (!tray) return;
	tray.setToolTip(pendingCount ? `Deposit Requests: ${pendingCount} pending` : 'Deposit Requests: nothing pending');
}

function buildTrayMenu() {
	const startup = app.getLoginItemSettings().openAtLogin;
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: 'Open', click: showWindow },
			{ label: 'Reload', click: () => win && win.reload() },
			{ type: 'separator' },
			{
				label: 'Start with Windows',
				type: 'checkbox',
				checked: startup,
				click: (item) => {
					app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
				}
			},
			{ type: 'separator' },
			{
				label: 'Quit',
				click: () => {
					quitting = true;
					app.quit();
				}
			}
		])
	);
}

function createWindow() {
	win = new BrowserWindow({
		width: 1000,
		height: 720,
		minWidth: 600,
		minHeight: 400,
		title: 'Deposit Requests',
		icon: ICON_PATH,
		show: !process.argv.includes('--hidden'),
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			// Polling for new deposits has to keep running while the window sits in the tray.
			backgroundThrottling: false
		}
	});

	win.on('close', (event) => {
		if (!quitting) {
			event.preventDefault();
			win.hide();
		}
	});

	win.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: 'deny' };
	});

	win.webContents.on('will-navigate', (event, url) => {
		if (new URL(url).origin === DASHBOARD_URL) return;
		event.preventDefault();
		shell.openExternal(url);
	});

	win.webContents.on('did-fail-load', (_event, code, description, url) => {
		if (code === -3) return;
		const retry = `<html><body style="font-family:system-ui;padding:40px;color:#1d2330">
			<h2>Can't reach the dashboard</h2><p>${description} — ${url}</p>
			<p>Retrying in 15 seconds.</p></body></html>`;
		win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(retry)}`);
		setTimeout(loadApp, 15_000);
	});

	loadApp();
}

ipcMain.on('deposits:notify', (_event, title, body) => {
	const notification = new Notification({
		title: String(title).slice(0, 120),
		body: String(body).slice(0, 300),
		icon: ICON_PATH
	});
	notification.on('click', showWindow);
	notification.show();

	if (win && !win.isFocused()) {
		win.flashFrame(true);
	}
});

ipcMain.handle('clipboard:write', (_event, text) => {
	clipboard.writeText(String(text).slice(0, 500));
	return true;
});

ipcMain.on('deposits:count', (_event, count) => {
	pendingCount = Math.max(0, Number(count) || 0);
	updateTray();
});

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', showWindow);

	app.whenReady().then(() => {
		app.setAppUserModelId(APP_ID);
		createWindow();

		tray = new Tray(nativeImage.createFromPath(ICON_PATH).resize({ width: 32, height: 32 }));
		tray.on('click', showWindow);
		buildTrayMenu();
		updateTray();
	});

	app.on('before-quit', () => {
		quitting = true;
	});

	app.on('window-all-closed', () => {
		// Kept alive in the tray; quitting is only done from the tray menu.
	});
}
