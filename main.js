// main.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const http = require('http');



let mainWindow = null;
let backendProcess = null;

// Get the correct path for the backend
const getBackendPath = () => {
    if (process.env.NODE_ENV === 'development') {
        return path.join(__dirname, 'server.js');
    } else {
        // Check multiple possible locations
        const possiblePaths = [
            path.join(process.resourcesPath, 'app.asar', 'server.js'),
            path.join(process.resourcesPath, 'app', 'server.js'),
            path.join(__dirname, 'server.js'),
            path.join(process.cwd(), 'server.js')
        ];
        
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                console.log(`Found backend at: ${p}`);
                return p;
            }
        }
        return path.join(__dirname, 'server.js');
    }
};

const startBackend = () => {
    return new Promise((resolve, reject) => {
        const serverPath = getBackendPath();
        console.log('Starting backend from:', serverPath);
        
        if (!fs.existsSync(serverPath)) {
            console.error('Server.js not found at:', serverPath);
            reject(new Error(`Server.js not found at: ${serverPath}`));
            return;
        }
        
        // Set up data directories in user's home folder
        const userDataPath = app.getPath('userData');
        const uploadsDir = path.join(userDataPath, 'uploads');
        const previewsDir = path.join(userDataPath, 'previews');
        const downloadsDir = path.join(userDataPath, 'downloads');
        const processedDir = path.join(userDataPath, 'processed');
        const lensImagesDir = path.join(userDataPath, 'lens-images');
        
        // Create directories if they don't exist
        [uploadsDir, previewsDir, downloadsDir, processedDir, lensImagesDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`Created directory: ${dir}`);
            }
        });
        
        // Set environment variables for the backend
        const env = {
            ...process.env,
            NODE_ENV: 'production',
            ELECTRON_RUN_AS_NODE: '1',
            USER_DATA_PATH: userDataPath,
            UPLOADS_DIR: uploadsDir,
            PREVIEWS_DIR: previewsDir,
            DOWNLOADS_DIR: downloadsDir,
            PROCESSED_DIR: processedDir,
            LENS_IMAGES_DIR: lensImagesDir,
            PORT: '3000'
        };
        
        // Use fork with electron as the interpreter
        backendProcess = fork(serverPath, [], {
            execPath: process.execPath,
            stdio: 'pipe',
            env: env,
            detached: false,
            silent: false
        });
        
        let backendReady = false;
        
        backendProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`[Backend]: ${output}`);
            // Check if backend is ready
            if (output.includes('Sony Lens Manager is running') || output.includes('listening on port')) {
                if (!backendReady) {
                    backendReady = true;
                    resolve();
                }
            }
        });
        
        backendProcess.stderr.on('data', (data) => {
            console.error(`[Backend Error]: ${data}`);
        });
        
        backendProcess.on('error', (err) => {
            console.error('Failed to start backend:', err);
            reject(err);
        });
        
        backendProcess.on('exit', (code, signal) => {
            console.log(`Backend exited with code ${code}, signal ${signal}`);
            backendProcess = null;
        });
        
        // Timeout after 10 seconds
        setTimeout(() => {
            if (!backendReady) {
                reject(new Error('Backend startup timeout'));
            }
        }, 10000);
    });
};

const stopBackend = () => {
    if (backendProcess) {
        console.log('Stopping backend process...');
        backendProcess.kill('SIGTERM');
        backendProcess = null;
    }
};

// Helper to resolve paths correctly in asar
const resolveAppPath = (filePath) => {
    if (process.env.NODE_ENV === 'development') {
        return path.join(__dirname, filePath);
    }
    // In production, the file might be in asar
    const asarPath = path.join(process.resourcesPath, 'app.asar', filePath);
    const normalPath = path.join(__dirname, filePath);
    
    if (fs.existsSync(asarPath)) {
        return asarPath;
    }
    return normalPath;
};

const showErrorPage = (errorMessage) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(`data:text/html,
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        color: white;
                        padding: 20px;
                    }
                    .error-container {
                        text-align: center;
                        max-width: 600px;
                    }
                    .icon {
                        font-size: 64px;
                        margin-bottom: 20px;
                    }
                    h1 { font-size: 28px; margin-bottom: 10px; }
                    p { font-size: 16px; opacity: 0.9; margin-bottom: 20px; line-height: 1.5; }
                    .error-details {
                        background: rgba(0,0,0,0.2);
                        padding: 15px;
                        border-radius: 10px;
                        font-family: monospace;
                        font-size: 12px;
                        text-align: left;
                        word-break: break-all;
                        margin-top: 20px;
                    }
                    button {
                        background: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 8px;
                        font-size: 14px;
                        font-weight: 600;
                        cursor: pointer;
                        margin-top: 20px;
                        color: #667eea;
                    }
                    button:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
                    }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <div class="icon">❌</div>
                    <h1>Failed to Start Backend</h1>
                    <p>The backend server could not be started.</p>
                    <div class="error-details">
                        <strong>Error:</strong><br>${errorMessage}
                    </div>
                    <button onclick="location.reload()">Restart Application</button>
                </div>
            </body>
            </html>
        `).catch(err => console.error('Failed to load error page:', err));
    }
};

const createWindow = () => {
    // Create window only if it doesn't exist or is destroyed
    if (mainWindow && !mainWindow.isDestroyed()) {
        return;
    }
    
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        show: false,
        backgroundColor: '#f8f9fa',
        title: 'Sony Lens Manager'
    });
    
    // Show loading screen
    mainWindow.loadURL(`data:text/html,
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    color: white;
                }
                .loading-container {
                    text-align: center;
                    animation: fadeIn 0.5s ease;
                }
                .icon { font-size: 64px; margin-bottom: 20px; }
                h1 { font-size: 28px; margin-bottom: 10px; font-weight: 600; }
                p { font-size: 16px; opacity: 0.9; margin-bottom: 30px; }
                .progress-bar {
                    width: 200px;
                    height: 3px;
                    background: rgba(255,255,255,0.3);
                    margin: 0 auto;
                    border-radius: 3px;
                    overflow: hidden;
                }
                .progress-fill {
                    width: 30%;
                    height: 100%;
                    background: white;
                    animation: loading 1.5s infinite ease;
                    border-radius: 3px;
                }
                @keyframes loading {
                    0% { transform: translateX(-100%); width: 30%; }
                    50% { transform: translateX(100%); width: 70%; }
                    100% { transform: translateX(200%); width: 30%; }
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            </style>
        </head>
        <body>
            <div class="loading-container">
                <div class="icon">📷</div>
                <h1>Sony Lens Manager</h1>
                <p>Starting up... Please wait</p>
                <div class="progress-bar">
                    <div class="progress-fill"></div>
                </div>
            </div>
        </body>
        </html>
    `).catch(err => console.error('Failed to load loading screen:', err));
    
    mainWindow.show();
    
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    
    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }
};

const loadMainApp = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('Loading main application...');
        mainWindow.loadURL('http://localhost:3000').catch(err => {
            console.error('Failed to load main app:', err);
            showErrorPage(`Failed to load application: ${err.message}`);
        });
    } else {
        console.error('Window is null or destroyed, cannot load app');
        // Create a new window and try again
        createWindow();
        setTimeout(() => loadMainApp(), 1000);
    }
};

// App lifecycle
app.whenReady().then(async () => {
    console.log('App ready, creating window...');
    createWindow();
    
    console.log('Starting backend...');
    try {
        await startBackend();
        console.log('Backend started successfully!');
        loadMainApp();
    } catch (err) {
        console.error('Backend failed to start:', err);
        showErrorPage(err.message);
    }
});

app.on('window-all-closed', () => {
    stopBackend();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null || mainWindow.isDestroyed()) {
        createWindow();
        // Restart backend if needed
        if (!backendProcess) {
            startBackend().then(() => {
                loadMainApp();
            }).catch(err => {
                showErrorPage(err.message);
            });
        } else {
            loadMainApp();
        }
    }
});

// Cleanup on exit
process.on('exit', () => {
    stopBackend();
});

process.on('SIGINT', () => {
    stopBackend();
    process.exit();
});

process.on('SIGTERM', () => {
    stopBackend();
    process.exit();
});