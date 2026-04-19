const { parentPort, workerData } = require('worker_threads');
const sharp = require('sharp');
const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);
const path = require('path');
const fs = require('fs').promises;

// Worker function to generate a single preview
async function generatePreview(filePath, previewPath, largePreviewPath, size = 300) {
  try {
    const tempFile = previewPath + '.temp.jpg';
    
    try {
      await execPromise(`exiftool -b -PreviewImage "${filePath}" > "${tempFile}"`);
      const stats = await fs.stat(tempFile);
      
      if (stats.size > 1000) {
        // Generate thumbnail
        await sharp(tempFile)
          .resize(size, size, { fit: 'inside' })
          .jpeg({ quality: 85 })
          .toFile(previewPath);
        
        // Generate large preview
        await sharp(tempFile)
          .resize(1200, 1200, { fit: 'inside' })
          .jpeg({ quality: 90 })
          .toFile(largePreviewPath);
        
        await fs.unlink(tempFile).catch(() => {});
        
        parentPort.postMessage({ 
          success: true, 
          file: path.basename(filePath),
          previewPath,
          largePreviewPath
        });
        return;
      }
    } catch (err) {
      // No embedded preview, create placeholder
    }
    
    // Create placeholder
    const svgContent = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f0f4ff"/>
      <rect x="10" y="10" width="${size-20}" height="${size-20}" fill="none" stroke="#667eea" stroke-width="3"/>
      <text x="50%" y="50%" font-family="Arial" font-size="${Math.floor(size/15)}" fill="#667eea" text-anchor="middle" dy=".3em">📷</text>
    </svg>`;
    
    await fs.writeFile(previewPath, svgContent);
    await fs.writeFile(largePreviewPath, svgContent);
    
    parentPort.postMessage({ 
      success: true, 
      file: path.basename(filePath),
      previewPath,
      largePreviewPath,
      placeholder: true
    });
    
  } catch (err) {
    parentPort.postMessage({ 
      success: false, 
      file: path.basename(filePath),
      error: err.message 
    });
  }
}

// Start processing
generatePreview(
  workerData.filePath,
  workerData.previewPath,
  workerData.largePreviewPath,
  workerData.size
);