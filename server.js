const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const sharp = require('sharp');
const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Suppress deprecation warnings
process.noDeprecation = true;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// ===== CONFIGURATION =====

// Determine if running in Electron production mode
const isElectronProduction = process.env.NODE_ENV === 'production' && 
                             process.resourcesPath !== undefined;

// Set up user data directory for storing files
let userDataPath;

if (isElectronProduction) {
    userDataPath = process.env.USER_DATA_PATH || path.join(os.homedir(), '.sony-lens-manager');
} else {
    userDataPath = __dirname;
}

console.log(`Running in ${isElectronProduction ? 'production' : 'development'} mode`);
console.log(`User data path: ${userDataPath}`);

// ===== EXIFTOOL PATH RESOLUTION =====
let EXIFTOOL_CMD = 'exiftool';
const exiftoolPaths = [
    '/opt/homebrew/bin/exiftool',  // Apple Silicon Mac
    '/usr/local/bin/exiftool',      // Intel Mac
    '/usr/bin/exiftool',
    '/bin/exiftool'
];

for (const p of exiftoolPaths) {
    if (fsSync.existsSync(p)) {
        EXIFTOOL_CMD = p;
        console.log(`✓ Found exiftool at: ${EXIFTOOL_CMD}`);
        break;
    }
}

if (EXIFTOOL_CMD === 'exiftool') {
    console.warn('⚠️ exiftool not found in common paths, relying on PATH');
}

// Helper functions for exiftool
const readExif = async (filePath) => {
    try {
        const { stdout } = await execPromise(`"${EXIFTOOL_CMD}" -j "${filePath}"`);
        const data = JSON.parse(stdout);
        return data[0] || {};
    } catch (err) {
        console.error('EXIF read error:', err);
        return {};
    }
};

const writeExif = async (filePath, tags) => {
    let command = `"${EXIFTOOL_CMD}" -overwrite_original`;
    for (const [key, value] of Object.entries(tags)) {
        if (value !== undefined && value !== null && value !== '') {
            command += ` -${key}="${value}"`;
        }
    }
    command += ` "${filePath}"`;
    
    try {
        await execPromise(command);
        console.log(`✓ EXIF written to ${path.basename(filePath)}`);
    } catch (err) {
        console.error('EXIF write error:', err);
        throw err;
    }
};

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadsDir = app.locals.uploadsDir || path.join(userDataPath, 'uploads');
        await fs.mkdir(uploadsDir, { recursive: true });
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.()[\]# -]/g, '_');
        cb(null, uniqueSuffix + '_' + safeName);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.arw', '.ARW', '.jpg', '.jpeg', '.JPEG', '.JPG'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${ext} not allowed`));
        }
    },
    limits: {
        fileSize: 100 * 1024 * 1024,
        files: 100
    }
});

// Configure multer for lens images
const lensImageStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const lensImagesDir = app.locals.lensImagesDir || path.join(userDataPath, 'lens-images');
        await fs.mkdir(lensImagesDir, { recursive: true });
        cb(null, lensImagesDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, uniqueSuffix + '_' + safeName);
    }
});

const uploadLensImage = multer({
    storage: lensImageStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Ensure directories exist
const ensureDirectories = async () => {
    let uploadsDir, processedDir, previewsDir, downloadsDir, lensImagesDir;
    
    if (isElectronProduction) {
        uploadsDir = path.join(userDataPath, 'uploads');
        processedDir = path.join(userDataPath, 'processed');
        previewsDir = path.join(userDataPath, 'previews');
        downloadsDir = path.join(userDataPath, 'downloads');
        lensImagesDir = path.join(userDataPath, 'lens-images');
    } else {
        uploadsDir = path.join(__dirname, 'uploads');
        processedDir = path.join(__dirname, 'processed');
        previewsDir = path.join(__dirname, 'previews');
        downloadsDir = path.join(__dirname, 'downloads');
        lensImagesDir = path.join(__dirname, 'public', 'lens-images');
    }
    
    const dirs = [uploadsDir, processedDir, previewsDir, downloadsDir, lensImagesDir];
    
    for (const dir of dirs) {
        try {
            await fs.mkdir(dir, { recursive: true });
            console.log(`Ensured directory: ${dir}`);
        } catch (err) {
            if (err.code !== 'EEXIST') {
                console.error(`Error creating directory ${dir}:`, err);
            }
        }
    }
    
    app.locals.uploadsDir = uploadsDir;
    app.locals.processedDir = processedDir;
    app.locals.previewsDir = previewsDir;
    app.locals.downloadsDir = downloadsDir;
    app.locals.lensImagesDir = lensImagesDir;
};

// Load lenses database
const loadLenses = async () => {
    let lensesPath;
    
    if (isElectronProduction) {
        lensesPath = path.join(userDataPath, 'lenses.json');
        if (!fsSync.existsSync(lensesPath)) {
            const packagedLensesPath = path.join(__dirname, 'lenses.json');
            if (fsSync.existsSync(packagedLensesPath)) {
                await fs.copyFile(packagedLensesPath, lensesPath);
                console.log(`Copied default lenses.json to ${lensesPath}`);
            }
        }
    } else {
        lensesPath = path.join(__dirname, 'lenses.json');
    }
    
    try {
        const data = await fs.readFile(lensesPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        const defaultLenses = {
            lenses: [
                {
                    id: "sony-24-70-gm",
                    name: "Sony FE 24-70mm F2.8 GM",
                    maker: "Sony",
                    type: "zoom",
                    focalLength: "24-70mm",
                    fixedFocalLength: null,
                    minFocalLength: 24,
                    maxFocalLength: 70,
                    aperture: "F2.8",
                    minAperture: 2.8,
                    exifLensID: "Model 1",
                    exifLensModel: "FE 24-70mm F2.8 GM",
                    description: "Standard zoom lens",
                    imageUrl: null,
                    isManual: false,
                    isActive: true,
                    createdAt: new Date().toISOString()
                }
            ]
        };
        await fs.writeFile(lensesPath, JSON.stringify(defaultLenses, null, 2));
        return defaultLenses;
    }
};

// Extract date from EXIF
const extractDateTime = (tags) => {
    try {
        const dateFields = [
            tags.DateTimeOriginal,
            tags.CreateDate,
            tags.ModifyDate,
            tags.FileModifyDate
        ];
        
        for (const dateField of dateFields) {
            if (dateField) {
                if (typeof dateField === 'string') {
                    const dateStr = dateField.replace(/(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
                    const date = new Date(dateStr);
                    if (!isNaN(date.getTime())) {
                        return date.toISOString();
                    }
                }
            }
        }
        return null;
    } catch (err) {
        return null;
    }
};

// Create placeholder image using SVG
const createPlaceholderImage = async (imagePath, size, label) => {
    const svgContent = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f0f4ff"/>
        <rect x="10" y="10" width="${size-20}" height="${size-20}" fill="none" stroke="#667eea" stroke-width="3"/>
        <text x="50%" y="45%" font-family="Arial" font-size="${Math.floor(size/15)}" fill="#667eea" text-anchor="middle" dy=".3em">📷</text>
        <text x="50%" y="60%" font-family="Arial" font-size="${Math.floor(size/20)}" fill="#667eea" text-anchor="middle" dy=".3em">${label || 'No Preview'}</text>
    </svg>`;
    
    await fs.writeFile(imagePath, svgContent);
    console.log(`Created placeholder at ${imagePath}`);
};

// Generate preview for ARW files with orientation support
// Generate preview for ARW files with orientation support
const generateARWPreview = async (arwPath, previewPath, size = 300) => {
    try {
        const dir = path.dirname(previewPath);
        await fs.mkdir(dir, { recursive: true });
        
        const tempFile = previewPath + '.temp.jpg';
        
        // First, get the orientation from the ARW file
        let orientationValue = 1;
        try {
            const { stdout } = await execPromise(`"${EXIFTOOL_CMD}" -Orientation -j "${arwPath}"`);
            const data = JSON.parse(stdout);
            const orientationRaw = data[0]?.Orientation || 1;
            
            // Convert string to number (e.g., "Rotate 90 CW" -> 6)
            if (typeof orientationRaw === 'string') {
                if (orientationRaw.includes('90 CW')) orientationValue = 6;
                else if (orientationRaw.includes('90 CCW') || orientationRaw.includes('270 CW')) orientationValue = 8;
                else if (orientationRaw.includes('180')) orientationValue = 3;
                else orientationValue = 1;
            } else {
                orientationValue = orientationRaw;
            }
            
            console.log(`File ${path.basename(arwPath)} orientation: ${orientationRaw} -> ${orientationValue}`);
        } catch (err) {
            console.log(`Could not read orientation for ${path.basename(arwPath)}`);
        }
        
        try {
            await execPromise(`"${EXIFTOOL_CMD}" -b -PreviewImage "${arwPath}" > "${tempFile}"`);
            const stats = await fs.stat(tempFile);
            
            if (stats.size > 1000) {
                let sharpInstance = sharp(tempFile);
                
                // Apply rotation based on orientation value (now a number)
                switch (orientationValue) {
                    case 3:
                        sharpInstance = sharpInstance.rotate(180);
                        console.log(`  → Applying 180° rotation`);
                        break;
                    case 6:
                        sharpInstance = sharpInstance.rotate(90);
                        console.log(`  → Applying 90° rotation`);
                        break;
                    case 8:
                        sharpInstance = sharpInstance.rotate(270);
                        console.log(`  → Applying 270° rotation`);
                        break;
                    default:
                        console.log(`  → No rotation needed`);
                        break;
                }
                
                await sharpInstance
                    .resize(size, size, { fit: 'inside' })
                    .jpeg({ quality: 85 })
                    .toFile(previewPath);
                
                await fs.unlink(tempFile).catch(() => {});
                console.log(`✓ Generated preview (${size}px)`);
                return true;
            }
        } catch (err) {
            console.log(`No embedded preview in ${path.basename(arwPath)}`);
        }
        
        await createPlaceholderImage(previewPath, size, 'ARW');
        return false;
    } catch (err) {
        console.error(`Error generating preview:`, err);
        await createPlaceholderImage(previewPath, size, 'ARW');
        return false;
    }
};

app.locals.uploadedFiles = [];

// ===== API ROUTES =====

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        exiftool: EXIFTOOL_CMD
    });
});

// Get active lenses
app.get('/api/lenses', async (req, res) => {
    try {
        const lensesData = await loadLenses();
        const activeLenses = lensesData.lenses.filter(l => l.isActive !== false);
        res.json(activeLenses);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load lenses' });
    }
});

// Get all lenses
app.get('/api/lenses/all', async (req, res) => {
    try {
        const lensesData = await loadLenses();
        res.json(lensesData.lenses);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load lenses' });
    }
});

// Get single lens
app.get('/api/lenses/:id', async (req, res) => {
    try {
        const lensesData = await loadLenses();
        const lens = lensesData.lenses.find(l => l.id === req.params.id);
        if (!lens) return res.status(404).json({ error: 'Lens not found' });
        res.json(lens);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load lens' });
    }
});

// Create lens
app.post('/api/lenses', uploadLensImage.single('lensImage'), async (req, res) => {
    try {
        let lensData = JSON.parse(req.body.lensData);
        const lensesData = await loadLenses();
        
        const newLens = {
            id: 'lens-' + Date.now(),
            ...lensData,
            imageUrl: req.file ? `/lens-images/${req.file.filename}` : null,
            createdAt: new Date().toISOString()
        };
        
        lensesData.lenses.push(newLens);
        const lensesPath = isElectronProduction ? 
            path.join(userDataPath, 'lenses.json') : 
            path.join(__dirname, 'lenses.json');
        await fs.writeFile(lensesPath, JSON.stringify(lensesData, null, 2));
        
        res.json({ success: true, lens: newLens });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update lens
app.put('/api/lenses/:id', uploadLensImage.single('lensImage'), async (req, res) => {
    try {
        const lensId = req.params.id;
        let lensData = JSON.parse(req.body.lensData);
        const lensesData = await loadLenses();
        const lensIndex = lensesData.lenses.findIndex(l => l.id === lensId);
        
        if (lensIndex === -1) return res.status(404).json({ error: 'Lens not found' });
        
        const updatedLens = {
            ...lensesData.lenses[lensIndex],
            ...lensData,
            id: lensId,
            updatedAt: new Date().toISOString()
        };
        
        if (req.file) {
            updatedLens.imageUrl = `/lens-images/${req.file.filename}`;
        }
        
        lensesData.lenses[lensIndex] = updatedLens;
        const lensesPath = isElectronProduction ? 
            path.join(userDataPath, 'lenses.json') : 
            path.join(__dirname, 'lenses.json');
        await fs.writeFile(lensesPath, JSON.stringify(lensesData, null, 2));
        
        res.json({ success: true, lens: updatedLens });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete lens
app.delete('/api/lenses/:id', async (req, res) => {
    try {
        const lensId = req.params.id;
        const lensesData = await loadLenses();
        lensesData.lenses = lensesData.lenses.filter(l => l.id !== lensId);
        
        const lensesPath = isElectronProduction ? 
            path.join(userDataPath, 'lenses.json') : 
            path.join(__dirname, 'lenses.json');
        await fs.writeFile(lensesPath, JSON.stringify(lensesData, null, 2));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Single file upload
app.post('/api/upload-single', upload.single('photos'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No file uploaded' });
        
        const fileInfo = {
            originalName: file.originalname,
            uploadedName: file.filename,
            path: file.path,
            size: file.size,
            type: path.extname(file.originalname).toLowerCase()
        };
        
        const previewsDir = app.locals.previewsDir;
        const baseName = path.parse(file.filename).name;
        const previewPath = path.join(previewsDir, `${baseName}_preview.jpg`);
        const largePreviewPath = path.join(previewsDir, `${baseName}_large.jpg`);
        
        let metadata = {};
        
        try {
            const tags = await readExif(file.path);
            const dateTime = extractDateTime(tags);
            
            metadata = {
                dateTime: dateTime,
                cameraModel: tags.Model || 'Unknown',
                lensModel: tags.LensModel || tags.LensID || null,
                focalLength: tags.FocalLength || tags.FocalLengthIn35mmFormat || null,
                aperture: tags.FNumber ? `F${tags.FNumber}` : null,
                iso: tags.ISO || null,
                exposureTime: tags.ExposureTime || null,
                hasLensInfo: !!(tags.LensModel || tags.LensID),
                width: tags.ImageWidth || 0,
                height: tags.ImageHeight || 0
            };
            
            await generateARWPreview(file.path, previewPath, 300);
            await generateARWPreview(file.path, largePreviewPath, 1500);
            
            fileInfo.preview = `/previews/${baseName}_preview.jpg`;
            fileInfo.largePreview = `/previews/${baseName}_large.jpg`;
            
        } catch (err) {
            metadata = { error: err.message, hasLensInfo: false };
            await createPlaceholderImage(previewPath, 300, 'Error');
            await createPlaceholderImage(largePreviewPath, 1200, 'Error');
            fileInfo.preview = `/previews/${baseName}_preview.jpg`;
            fileInfo.largePreview = `/previews/${baseName}_large.jpg`;
        }
        
        fileInfo.metadata = metadata;
        app.locals.uploadedFiles.push(fileInfo);
        
        res.json({ success: true, file: fileInfo });
        
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Apply lens single
app.post('/api/apply-lens-single', async (req, res) => {
    try {
        const { fileName, lensId, keepOriginalName = true } = req.body;
        
        if (!fileName || !lensId) {
            return res.status(400).json({ error: 'Missing file or lens selection' });
        }
        
        const lensesData = await loadLenses();
        const selectedLens = lensesData.lenses.find(l => l.id === lensId);
        if (!selectedLens) return res.status(404).json({ error: 'Lens not found' });
        
        const filePath = path.join(app.locals.uploadsDir, fileName);
        if (!fsSync.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const uploadedFile = app.locals.uploadedFiles.find(f => f.uploadedName === fileName);
        const originalName = uploadedFile?.originalName || fileName;
        const safeOriginalName = originalName.replace(/[^a-zA-Z0-9.()[\]# -]/g, '_');
        
        let outputFilename = safeOriginalName;
        let outputPath = path.join(app.locals.downloadsDir, outputFilename);
        
        let counter = 1;
        while (fsSync.existsSync(outputPath)) {
            const nameWithoutExt = path.basename(safeOriginalName, path.extname(safeOriginalName));
            const ext = path.extname(safeOriginalName);
            outputFilename = `${nameWithoutExt}_${counter}${ext}`;
            outputPath = path.join(app.locals.downloadsDir, outputFilename);
            counter++;
        }
        
        await fs.copyFile(filePath, outputPath);
        
        const lensTags = {
            LensModel: selectedLens.exifLensModel,
            LensID: selectedLens.exifLensID,
            LensMake: selectedLens.maker
        };
        
        if (selectedLens.type === 'prime' && selectedLens.fixedFocalLength) {
            lensTags.FocalLength = selectedLens.fixedFocalLength;
            lensTags.FocalLengthIn35mmFormat = selectedLens.fixedFocalLength;
        }
        
        if (selectedLens.minAperture) {
            lensTags.FNumber = selectedLens.minAperture;
        }
        
        await writeExif(outputPath, lensTags);
        
        res.json({ success: true, outputFilename, lens: selectedLens.name });
        
    } catch (err) {
        console.error('Apply lens error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Batch apply lens
app.post('/api/apply-lens', async (req, res) => {
    try {
        const { files, lensId, keepOriginalName = true } = req.body;
        
        if (!files || !files.length || !lensId) {
            return res.status(400).json({ error: 'Missing files or lens selection' });
        }
        
        const lensesData = await loadLenses();
        const selectedLens = lensesData.lenses.find(l => l.id === lensId);
        if (!selectedLens) return res.status(404).json({ error: 'Lens not found' });
        
        const processedFiles = [];
        
        for (const fileName of files) {
            try {
                const filePath = path.join(app.locals.uploadsDir, fileName);
                if (!fsSync.existsSync(filePath)) continue;
                
                const uploadedFile = app.locals.uploadedFiles.find(f => f.uploadedName === fileName);
                const originalName = uploadedFile?.originalName || fileName;
                const safeOriginalName = originalName.replace(/[^a-zA-Z0-9.()[\]# -]/g, '_');
                
                let outputFilename = safeOriginalName;
                let outputPath = path.join(app.locals.downloadsDir, outputFilename);
                
                let counter = 1;
                while (fsSync.existsSync(outputPath)) {
                    const nameWithoutExt = path.basename(safeOriginalName, path.extname(safeOriginalName));
                    const ext = path.extname(safeOriginalName);
                    outputFilename = `${nameWithoutExt}_${counter}${ext}`;
                    outputPath = path.join(app.locals.downloadsDir, outputFilename);
                    counter++;
                }
                
                await fs.copyFile(filePath, outputPath);
                
                const lensTags = {
                    LensModel: selectedLens.exifLensModel,
                    LensID: selectedLens.exifLensID,
                    LensMake: selectedLens.maker
                };
                
                if (selectedLens.type === 'prime' && selectedLens.fixedFocalLength) {
                    lensTags.FocalLength = selectedLens.fixedFocalLength;
                }
                
                if (selectedLens.minAperture) {
                    lensTags.FNumber = selectedLens.minAperture;
                }
                
                await writeExif(outputPath, lensTags);
                
                processedFiles.push({ original: fileName, processed: outputFilename, success: true });
                
            } catch (err) {
                processedFiles.push({ original: fileName, error: err.message, success: false });
            }
        }
        
        res.json({ success: true, processed: processedFiles });
        
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Generate preview for existing file (for frontend compatibility)
app.post('/api/generate-preview', async (req, res) => {
    try {
        const { filename } = req.body;
        
        if (!filename) {
            return res.status(400).json({ error: 'Filename required' });
        }
        
        const uploadsDir = app.locals.uploadsDir;
        const previewsDir = app.locals.previewsDir;
        
        const filePath = path.join(uploadsDir, filename);
        const baseName = path.parse(filename).name;
        const previewPath = path.join(previewsDir, `${baseName}_preview.jpg`);
        const largePreviewPath = path.join(previewsDir, `${baseName}_large.jpg`);
        
        if (!fsSync.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Check if preview already exists
        if (fsSync.existsSync(previewPath) && fsSync.existsSync(largePreviewPath)) {
            return res.json({ 
                success: true, 
                preview: `/previews/${baseName}_preview.jpg`,
                largePreview: `/previews/${baseName}_large.jpg`
            });
        }
        
        // Generate previews
        await generateARWPreview(filePath, previewPath, 300);
        await generateARWPreview(filePath, largePreviewPath, 1200);
        
        res.json({ 
            success: true, 
            preview: `/previews/${baseName}_preview.jpg`,
            largePreview: `/previews/${baseName}_large.jpg`
        });
        
    } catch (err) {
        console.error('Preview generation error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Download routes
app.get('/api/download/original/:filename', (req, res) => {
    const filePath = path.join(app.locals.downloadsDir, req.params.filename);
    if (!fsSync.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.download(filePath);
});

// Clear uploads
app.post('/api/clear-uploads', async (req, res) => {
    try {
        const files = await fs.readdir(app.locals.uploadsDir);
        for (const file of files) {
            await fs.unlink(path.join(app.locals.uploadsDir, file)).catch(() => {});
        }
        const previews = await fs.readdir(app.locals.previewsDir);
        for (const file of previews) {
            await fs.unlink(path.join(app.locals.previewsDir, file)).catch(() => {});
        }
        app.locals.uploadedFiles = [];
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Clear downloads
app.post('/api/clear-downloads', async (req, res) => {
  try {
    const downloadDir = './downloads';
    if (fsSync.existsSync(downloadDir)) {
      const files = await fs.readdir(downloadDir);
      for (const file of files) {
        await fs.unlink(path.join(downloadDir, file)).catch(() => { });
      }
    }
    res.json({ success: true, message: 'Downloads cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear downloads' });
  }
});

// Cleanup temp
app.post('/api/cleanup-temp', async (req, res) => {
    try {
        let cleaned = 0;
        const files = await fs.readdir(app.locals.uploadsDir);
        for (const file of files) {
            await fs.unlink(path.join(app.locals.uploadsDir, file)).catch(() => {});
            cleaned++;
        }
        const previews = await fs.readdir(app.locals.previewsDir);
        for (const file of previews) {
            await fs.unlink(path.join(app.locals.previewsDir, file)).catch(() => {});
            cleaned++;
        }
        app.locals.uploadedFiles = [];
        res.json({ success: true, cleaned });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Open downloads folder
app.post('/api/open-downloads-folder', (req, res) => {
    const command = process.platform === 'darwin' ? `open "${app.locals.downloadsDir}"` : 
                    process.platform === 'win32' ? `explorer "${app.locals.downloadsDir}"` : 
                    `xdg-open "${app.locals.downloadsDir}"`;
    exec(command, (error) => {
        if (error) return res.status(500).json({ error: 'Failed to open folder' });
        res.json({ success: true });
    });
});

// ===== PAGE ROUTES =====
app.get('/lens-manager', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'lens-manager.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== START SERVER =====
const startServer = async () => {
    try {
        await ensureDirectories();
        await loadLenses();
        
        // ===== STATIC FILES - REGISTER AFTER DIRECTORIES ARE CREATED =====
        app.use(express.static(path.join(__dirname, 'public')));
        
        // Only serve these directories if they exist
        if (app.locals.previewsDir && fsSync.existsSync(app.locals.previewsDir)) {
            app.use('/previews', express.static(app.locals.previewsDir));
            console.log(`✓ Serving previews from: ${app.locals.previewsDir}`);
        }
        
        if (app.locals.lensImagesDir && fsSync.existsSync(app.locals.lensImagesDir)) {
            app.use('/lens-images', express.static(app.locals.lensImagesDir));
            console.log(`✓ Serving lens images from: ${app.locals.lensImagesDir}`);
        }
        
        // ===== CATCH-ALL ROUTE (LAST!) =====
        app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
        
        app.listen(PORT, () => {
            console.log(`=================================`);
            console.log(`Sony Lens Manager is running!`);
            console.log(`=================================`);
            console.log(`Server listening on port ${PORT}`);
            console.log(`Exiftool path: ${EXIFTOOL_CMD}`);
            console.log(`=================================`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
};

startServer();