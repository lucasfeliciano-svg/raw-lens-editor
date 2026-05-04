const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const sharp = require('sharp'); // Uncomment this line at the top

const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);
const os = require('os');
const PDFDocument = require('pdfkit');
const GitService = require('./git-service');
const gitService = new GitService(__dirname);

gitService.initialize().catch(err => {
    console.log('Git service not available, running in local mode');
});

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

// Generate lens collection report (fixed version)
app.get('/api/lenses/report', async (req, res) => {
    try {
        const lensesData = await loadLenses();
        const lenses = lensesData.lenses.filter(l => l.isOwned !== false);

        const doc = new PDFDocument({
            size: 'A4',
            margin: 35,
            bufferPages: true,
            info: {
                Title: 'Lens Collection Report',
                Author: 'Sony Lens Manager'
            }
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="lens-collection.pdf"');

        doc.pipe(res);

        // ===== COVER PAGE =====
        doc.rect(0, 0, doc.page.width, 150)
            .fill('#667eea');

        doc.fontSize(28)
            .font('Helvetica-Bold')
            .fillColor('white')
            .text('Lens Collection', 0, 50, { align: 'center' })
            .fontSize(16)
            .text('Report', 0, 85, { align: 'center' });

        doc.fontSize(11)
            .fillColor('#2c3e50')
            .text(`Generated: ${new Date().toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric'
            })}`, 0, 180, { align: 'center' });

        doc.fontSize(13)
            .fillColor('#7f8c8d')
            .text(`Total Lenses in Collection: ${lenses.length}`, 0, 210, { align: 'center' });

        doc.rect(200, 240, 195, 2).fill('#667eea');

        // Mount summary
        const mountCounts = {};
        lenses.forEach(l => {
            if (l.mount) {
                mountCounts[l.mount] = (mountCounts[l.mount] || 0) + 1;
            }
        });

        doc.fontSize(13)
            .font('Helvetica-Bold')
            .fillColor('#2c3e50')
            .text('Collection by Mount', 0, 280, { align: 'center' });

        doc.fontSize(10).font('Helvetica');

        let mountY = 310;
        Object.entries(mountCounts).sort((a, b) => b[1] - a[1]).forEach(([mount, count]) => {
            doc.fillColor('#2c3e50').text(`• ${mount}: ${count} lens${count !== 1 ? 'es' : ''}`, 0, mountY, { align: 'center' });
            mountY += 18;
        });

        // ===== SUMMARY TABLE =====
        doc.addPage();

        doc.fontSize(16)
            .font('Helvetica-Bold')
            .fillColor('#2c3e50')
            .text('Collection Summary', 35, 35);

        const tableTop = 70;
        const headers = ['Lens Name', 'Mount', 'Focal', 'Aperture', 'Serial #'];
        const colWidths = [200, 80, 55, 55, 100];
        const rowHeight = 22;

        doc.rect(35, tableTop - 5, 525, 22).fill('#667eea');

        doc.fontSize(9).font('Helvetica-Bold').fillColor('white');

        let xPos = 40;
        headers.forEach((header, i) => {
            doc.text(header, xPos, tableTop, { width: colWidths[i] - 5 });
            xPos += colWidths[i];
        });

        doc.font('Helvetica').fillColor('#2c3e50');
        let yPos = tableTop + 22;

        lenses.forEach((lens, idx) => {
            if (idx % 2 === 0) {
                doc.rect(35, yPos - 5, 525, rowHeight).fill('#f8f9fa');
            }

            doc.fillColor('#2c3e50');
            xPos = 40;

            const rowData = [
                (lens.name || '').substring(0, 28),
                lens.mount || '-',
                lens.focalLength || '-',
                lens.aperture || '-',
                lens.serialNumber || '-'
            ];

            rowData.forEach((cell, i) => {
                doc.text(cell || '-', xPos, yPos, { width: colWidths[i] - 5 });
                xPos += colWidths[i];
            });

            yPos += rowHeight;

            if (yPos > 780) {
                doc.addPage();
                yPos = 50;
            }
        });

        
                // ===== INDIVIDUAL LENS PAGES (300x300 IMAGES WITH WEBP SUPPORT) =====
        for (const lens of lenses) {
            doc.addPage();
            
            // Header
            doc.rect(0, 0, doc.page.width, 55)
               .fill('#667eea');
            
            doc.fontSize(16)
               .font('Helvetica-Bold')
               .fillColor('white')
               .text(lens.name.substring(0, 40), 35, 18);
            
            doc.fontSize(10)
               .font('Helvetica')
               .text(`${lens.mount || ''}  •  ${lens.focalLength || ''}  •  ${lens.aperture || ''}`, 35, 38);
            
            // Larger image - 300x300
            const imageSize = 300;
            const imageX = 35;
            const imageY = 75;
            
            // Draw decorative frame
            doc.rect(imageX - 3, imageY - 3, imageSize + 6, imageSize + 6)
               .fill('#e9ecef');
            doc.rect(imageX - 1, imageY - 1, imageSize + 2, imageSize + 2)
               .fill('white');
            doc.rect(imageX, imageY, imageSize, imageSize)
               .fill('#f8f9fa');
            
            let imageDisplayed = false;
            
            // Helper: Check if file is a valid image
            const isValidImage = (filePath) => {
                try {
                    if (!fsSync.existsSync(filePath)) return false;
                    const stats = fsSync.statSync(filePath);
                    if (stats.size < 500) return false;
                    return true;
                } catch (err) {
                    return false;
                }
            };
            
            // Helper: Convert WebP to JPEG if needed
            const getDisplayableImagePath = async (inputPath) => {
                try {
                    const ext = path.extname(inputPath).toLowerCase();
                    
                    // If it's already JPEG or PNG, return as-is
                    if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
                        return inputPath;
                    }
                    
                    // For WebP or other formats, convert to JPEG
                    const tempDir = path.join(app.locals.previewsDir, 'temp');
                    await fs.mkdir(tempDir, { recursive: true });
                    
                    const tempFile = path.join(tempDir, `lens-${Date.now()}.jpg`);
                    
                    await sharp(inputPath)
                        .resize(imageSize, imageSize, { fit: 'inside', withoutEnlargement: true })
                        .jpeg({ quality: 90 })
                        .toFile(tempFile);
                    
                    console.log(`  ✓ Converted ${ext} to JPEG`);
                    return tempFile;
                } catch (err) {
                    console.error(`  ✗ Conversion failed:`, err.message);
                    return null;
                }
            };
            
            const tryImagePaths = [];
            if (lens.primaryImage) tryImagePaths.push(lens.primaryImage);
            if (lens.imageUrl) tryImagePaths.push(lens.imageUrl);
            
            for (const imgPath of tryImagePaths) {
                if (imageDisplayed) break;
                if (!imgPath || typeof imgPath !== 'string') continue;
                
                try {
                    const filename = path.basename(imgPath);
                    const possiblePaths = [
                        path.join(app.locals.lensImagesDir, filename),
                        path.join(__dirname, 'public', 'lens-images', filename),
                        path.join(userDataPath, 'lens-images', filename)
                    ];
                    
                    for (const testPath of possiblePaths) {
                        if (isValidImage(testPath)) {
                            // Convert if needed (handles WebP)
                            const displayPath = await getDisplayableImagePath(testPath);
                            
                            if (displayPath && fsSync.existsSync(displayPath)) {
                                // Get image dimensions to center it
                                const metadata = await sharp(displayPath).metadata();
                                
                                // Calculate centering offsets
                                const imgWidth = metadata.width;
                                const imgHeight = metadata.height;
                                
                                let offsetX = imageX;
                                let offsetY = imageY;
                                let finalWidth = imageSize;
                                let finalHeight = imageSize;
                                
                                // Center the image within the frame
                                if (imgWidth > imgHeight) {
                                    finalHeight = (imgHeight / imgWidth) * imageSize;
                                    offsetY = imageY + (imageSize - finalHeight) / 2;
                                } else {
                                    finalWidth = (imgWidth / imgHeight) * imageSize;
                                    offsetX = imageX + (imageSize - finalWidth) / 2;
                                }
                                
                                doc.image(displayPath, offsetX, offsetY, { 
                                    width: finalWidth, 
                                    height: finalHeight
                                });
                                
                                imageDisplayed = true;
                                console.log(`✓ Displayed image: ${filename}`);
                                break;
                            }
                        }
                    }
                } catch (err) {
                    console.log(`  Image error:`, err.message);
                }
            }
            
            if (!imageDisplayed) {
                // Larger placeholder
                doc.fontSize(80)
                   .fillColor('#bdc3c7')
                   .text('📷', imageX + 85, imageY + 90);
                doc.fontSize(12)
                   .fillColor('#95a5a6')
                   .text('No image available', imageX, imageY + imageSize + 5, { 
                       width: imageSize, 
                       align: 'center' 
                   });
            }
            
            // Details section - below the image since it's now larger
            const detailsY = imageY + imageSize + 20;
            
            doc.fontSize(10).font('Helvetica');
            
            // Two-column layout for details
            const leftColX = 35;
            const rightColX = 300;
            let leftY = detailsY;
            let rightY = detailsY;
            
            const detailItems = [
                { label: 'Maker', value: lens.maker },
                { label: 'Mount', value: lens.mount },
                { label: 'Serial Number', value: lens.serialNumber },
                { label: 'Condition', value: lens.condition },
                { label: 'Purchase Date', value: lens.purchaseDate },
                { label: 'Purchase Price', value: lens.purchasePrice ? `$${lens.purchasePrice}` : null }
            ].filter(item => item.value);
            
            detailItems.forEach((item, i) => {
                const xPos = i < 3 ? leftColX : rightColX;
                const yPos = i < 3 ? leftY : rightY;
                
                doc.fillColor('#7f8c8d').text(`${item.label}:`, xPos, yPos, { continued: true });
                doc.fillColor('#2c3e50').text(` ${item.value}`);
                
                if (i < 3) {
                    leftY += 18;
                } else {
                    rightY += 18;
                }
            });
            
            // Technical Specifications
            const specsY = Math.max(leftY, rightY) + 15;
            
            const specFields = [
                { label: 'Filter Thread', value: lens.filterThread },
                { label: 'Weight', value: lens.weight },
                { label: 'Dimensions', value: lens.dimensions },
                { label: 'Optical Design', value: lens.opticalDesign },
                { label: 'Min Focus Distance', value: lens.minFocusDistance },
                { label: 'Max Magnification', value: lens.maxMagnification },
                { label: 'Hood Model', value: lens.hoodModel }
            ];
            
            const populatedSpecs = specFields.filter(s => s.value && s.value.trim() !== '');
            
            if (populatedSpecs.length > 0) {
                doc.rect(35, specsY, 525, 75)
                   .fill('#f8f9fa')
                   .stroke('#e9ecef');
                
                doc.fontSize(11)
                   .font('Helvetica-Bold')
                   .fillColor('#2c3e50')
                   .text('Technical Specifications', 50, specsY + 12);
                
                doc.fontSize(9).font('Helvetica');
                
                let specX = 50;
                let specRowY = specsY + 32;
                
                populatedSpecs.forEach((item, i) => {
                    doc.fillColor('#7f8c8d').text(`${item.label}:`, specX, specRowY, { continued: true });
                    doc.fillColor('#2c3e50').text(` ${item.value}`);
                    
                    if (i % 2 === 0) {
                        specX = 300;
                    } else {
                        specX = 50;
                        specRowY += 18;
                    }
                });
            }
            
            // Footer at Y=780
            doc.fontSize(7)
               .fillColor('#95a5a6')
               .text(
                   `Lens ID: ${lens.id} | Created: ${lens.createdAt ? new Date(lens.createdAt).toLocaleDateString() : 'N/A'}`,
                   35, 780,
                   { align: 'center', width: 525 }
               );
        }
        
        doc.end();

    } catch (err) {
        console.error('Report generation error:', err);
        res.status(500).json({ error: 'Failed to generate report: ' + err.message });
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

    // Load saved preferences
    const prefsPath = path.join(userDataPath, 'preferences.json');
    try {
        const data = await fs.readFile(prefsPath, 'utf8');
        const prefs = JSON.parse(data);
        if (prefs.outputDirectory) {
            app.locals.downloadsDir = prefs.outputDirectory;
        }
    } catch (err) {
        // No preferences yet, use default
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
            console.log("the lens path is: "+__dirname);
            const packagedLensesPath = path.join(__dirname, 'lenses.json');
            if (fsSync.existsSync(packagedLensesPath)) {
                await fs.copyFile(packagedLensesPath, lensesPath);
                console.log(`Copied default lenses.json to ${lensesPath}`);
            }
        }
    } else {
        console.log("the lens path is: "+__dirname);
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
        <rect x="10" y="10" width="${size - 20}" height="${size - 20}" fill="none" stroke="#667eea" stroke-width="3"/>
        <text x="50%" y="45%" font-family="Arial" font-size="${Math.floor(size / 15)}" fill="#667eea" text-anchor="middle" dy=".3em">📷</text>
        <text x="50%" y="60%" font-family="Arial" font-size="${Math.floor(size / 20)}" fill="#667eea" text-anchor="middle" dy=".3em">${label || 'No Preview'}</text>
    </svg>`;

    await fs.writeFile(imagePath, svgContent);
    console.log(`Created placeholder at ${imagePath}`);
};

// Generate preview for ARW files - handles portrait rotation properly
const generateARWPreview = async (arwPath, previewPath, size = 300) => {
    try {
        const dir = path.dirname(previewPath);
        await fs.mkdir(dir, { recursive: true });

        const tempFile = previewPath + '.temp.jpg';

        // Step 1: Extract embedded preview
        try {
            await execPromise(`"${EXIFTOOL_CMD}" -b -PreviewImage "${arwPath}" > "${tempFile}"`);
        } catch (err) {
            try {
                await execPromise(`"${EXIFTOOL_CMD}" -b -ThumbnailImage "${arwPath}" > "${tempFile}"`);
            } catch (err2) {
                console.error('Preview extraction failed');
                await createPlaceholderImage(previewPath, size, 'ARW');
                return false;
            }
        }

        const stats = await fs.stat(tempFile);
        if (stats.size < 1000) {
            await createPlaceholderImage(previewPath, size, 'ARW');
            return false;
        }

        // Step 2: Get orientation and apply correct rotation
        let orientation = 1;
        try {
            const { stdout } = await execPromise(`"${EXIFTOOL_CMD}" -Orientation# -j "${arwPath}"`);
            const data = JSON.parse(stdout);
            orientation = parseInt(data[0]?.Orientation) || 1;
            console.log(`📐 Detected Orientation: ${orientation}`);
        } catch (err) {
            console.log('Could not read orientation, assuming landscape (1)');
        }

        // Orientation mapping:
        // 1 = Normal (no rotation)
        // 3 = Rotate 180° (upside down)
        // 6 = Rotate 90° CW (portrait - camera turned clockwise)
        // 8 = Rotate 90° CCW (portrait - camera turned counter-clockwise)

        let rotationDegrees = 0;
        if (orientation === 3) {
            rotationDegrees = 180;
            // console.log('↻ Applying 180° rotation (upside down fix)');
        } else if (orientation === 6) {
            rotationDegrees = 270;
            // console.log('↻ Applying 90° clockwise rotation (portrait fix)');
        } else if (orientation === 8) {
            rotationDegrees = 270;
            // console.log('↻ Applying 270° clockwise / 90° CCW rotation (portrait fix)');
        } else {
            console.log('✓ Landscape - no rotation needed');
        }

        // Step 3: Apply rotation if needed
        if (rotationDegrees > 0) {
            await execPromise(`sips -r ${rotationDegrees} "${tempFile}" --out "${previewPath}"`);
            await execPromise(`"${EXIFTOOL_CMD}" -overwrite_original -Orientation=1 "${previewPath}"`);
        } else {
            await fs.copyFile(tempFile, previewPath);
        }


        // Clean up temp file
        await fs.unlink(tempFile).catch(() => { });

        return true;

    } catch (err) {
        console.error(`Preview generation error:`, err.message);

        // Fallback: try to salvage whatever we can
        try {
            const tempFile = previewPath + '.temp.jpg';
            if (fsSync.existsSync(tempFile)) {
                await fs.copyFile(tempFile, previewPath);
                return true;
            }
        } catch (e) {
            // Give up
        }

        await createPlaceholderImage(previewPath, size, 'ARW');
        return false;
    }
};

app.locals.uploadedFiles = [];

// ===== API ROUTES =====


// Debug endpoint to check lens images
app.get('/api/debug/lens-images', async (req, res) => {
    try {
        const lensesData = await loadLenses();
        const debugInfo = [];

        for (const lens of lensesData.lenses) {
            const imageInfo = {
                name: lens.name,
                imageUrl: lens.imageUrl,
                primaryImage: lens.primaryImage,
                exists: false,
                fullPath: null,
                validImage: false
            };

            if (lens.primaryImage || lens.imageUrl) {
                const imgPath = lens.primaryImage || lens.imageUrl;
                const filename = path.basename(imgPath);
                const fullPath = path.join(app.locals.lensImagesDir, filename);

                imageInfo.fullPath = fullPath;
                imageInfo.exists = fsSync.existsSync(fullPath);

                if (imageInfo.exists) {
                    const stats = fsSync.statSync(fullPath);
                    imageInfo.size = stats.size;
                    imageInfo.validImage = stats.size > 500;
                }
            }

            debugInfo.push(imageInfo);
        }

        res.json({
            lensImagesDir: app.locals.lensImagesDir,
            lenses: debugInfo
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
// Batch file upload (frontend compatibility)
app.post('/api/upload', upload.array('photos', 100), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const uploadedFiles = [];
        const previewsDir = app.locals.previewsDir;

        for (const file of files) {
            const baseName = path.parse(file.filename).name;
            const previewPath = path.join(previewsDir, `${baseName}_preview.jpg`);
            const largePreviewPath = path.join(previewsDir, `${baseName}_large.jpg`);

            const fileInfo = {
                originalName: file.originalname,
                uploadedName: file.filename,
                path: file.path,
                size: file.size,
                type: path.extname(file.originalname).toLowerCase()
            };

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
            uploadedFiles.push(fileInfo);
            app.locals.uploadedFiles.push(fileInfo);
        }

        res.json({ 
            success: true, 
            files: uploadedFiles,
            message: `Successfully uploaded ${files.length} file(s)`
        });

    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: 'Upload failed', details: err.message });
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
            await fs.unlink(path.join(app.locals.uploadsDir, file)).catch(() => { });
        }
        const previews = await fs.readdir(app.locals.previewsDir);
        for (const file of previews) {
            await fs.unlink(path.join(app.locals.previewsDir, file)).catch(() => { });
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
        const downloadDir = app.locals.downloadsDir;
        if (fsSync.existsSync(downloadDir)) {
            const files = await fs.readdir(downloadDir);
            let cleared = 0;
            for (const file of files) {
                await fs.unlink(path.join(downloadDir, file)).catch(() => { });
                cleared++;
            }
            res.json({ success: true, message: `Cleared ${cleared} files`, cleared });
        } else {
            res.json({ success: true, message: 'No downloads to clear', cleared: 0 });
        }
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
            await fs.unlink(path.join(app.locals.uploadsDir, file)).catch(() => { });
            cleaned++;
        }
        const previews = await fs.readdir(app.locals.previewsDir);
        for (const file of previews) {
            await fs.unlink(path.join(app.locals.previewsDir, file)).catch(() => { });
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

// Set custom output directory
app.post('/api/set-output-dir', async (req, res) => {
    try {
        const { outputDir } = req.body;

        if (!outputDir) {
            return res.status(400).json({ error: 'No directory specified' });
        }

        // Verify directory exists and is writable
        try {
            await fs.access(outputDir, fs.constants.W_OK);
        } catch (err) {
            // Try to create it
            await fs.mkdir(outputDir, { recursive: true });
        }

        // Update the downloads directory
        app.locals.downloadsDir = outputDir;

        // Save to user preferences
        const prefsPath = path.join(userDataPath, 'preferences.json');
        const prefs = { outputDirectory: outputDir };
        await fs.writeFile(prefsPath, JSON.stringify(prefs, null, 2));

        res.json({ success: true, outputDir });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get current output directory
app.get('/api/output-dir', async (req, res) => {
    try {
        const prefsPath = path.join(userDataPath, 'preferences.json');

        let outputDir = app.locals.downloadsDir;

        try {
            const data = await fs.readFile(prefsPath, 'utf8');
            const prefs = JSON.parse(data);
            if (prefs.outputDirectory) {
                outputDir = prefs.outputDirectory;
                app.locals.downloadsDir = outputDir;
            }
        } catch (err) {
            // No preferences file yet, use default
        }

        res.json({ outputDir });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// Sync status endpoint
app.get('/api/sync/status', async (req, res) => {
    try {
        if (!gitService.isAvailable()) {
            return res.json({
                syncAvailable: false,
                localOnly: true,
                message: 'Running in local mode'
            });
        }
        const status = await gitService.syncStatus();
        res.json(status);
    } catch (err) {
        res.json({
            syncAvailable: false,
            localOnly: true,
            message: 'Sync check failed'
        });
    }
});

// Sync lenses endpoint
app.post('/api/sync/lenses', async (req, res) => {
    if (!gitService.isAvailable()) {
        const lensesData = await loadLenses();
        return res.json({
            success: true,
            localOnly: true,
            message: 'Lenses saved locally. Sync not available.',
            lenses: lensesData.lenses
        });
    }

    try {
        // Get the active lenses file path
        const activeLensesPath = isElectronProduction
            ? path.join(userDataPath, 'lenses.json')
            : path.join(__dirname, 'lenses.json');
        
        // Get the repo lenses file path (for git)
        const repoLensesPath = path.join(__dirname, 'lenses.json');
        
        // If they're different, copy active to repo
        if (activeLensesPath !== repoLensesPath) {
            const activeData = await fs.readFile(activeLensesPath, 'utf8');
            await fs.writeFile(repoLensesPath, activeData);
            console.log('✓ Copied active lenses to repo for sync');
        }
        
        // Backup
        const lensesBackup = await fs.readFile(repoLensesPath, 'utf8');
        await fs.writeFile(path.join(__dirname, 'lenses_backup.json'), lensesBackup);

        // Sync with git
        const result = await gitService.sync();
        const lensesData = await loadLenses();

        res.json({
            success: true,
            message: 'Lenses synced successfully',
            lenses: lensesData.lenses
        });
    } catch (err) {
        // Restore backup on failure
        try {
            const backupPath = path.join(__dirname, 'lenses_backup.json');
            if (fsSync.existsSync(backupPath)) {
                await fs.copyFile(backupPath, path.join(__dirname, 'lenses.json'));
            }
        } catch (e) {}

        const lensesData = await loadLenses();
        res.json({
            success: true,
            localOnly: true,
            message: 'Could not sync with remote, but lenses saved locally.',
            note: err.message,
            lenses: lensesData.lenses
        });
    }
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