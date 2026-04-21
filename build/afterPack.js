// build/afterPack.js
const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
    const { appOutDir, packager } = context;
    
    // Only run for macOS
    if (packager.platform.name !== 'mac') {
        return;
    }
    
    const appName = packager.appInfo.productFilename;
    const appPath = path.join(appOutDir, `${appName}.app`);
    const resourcesPath = path.join(appPath, 'Contents', 'Resources');
    
    console.log('Running afterPack hook for Sharp library...');
    
    // Find Sharp libvips in the unpacked node_modules
    const sharpLibvipsPath = path.join(
        resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        '@img',
        'sharp-libvips-darwin-arm64',
        'lib'
    );
    
    if (fs.existsSync(sharpLibvipsPath)) {
        console.log(`✓ Found Sharp libvips at: ${sharpLibvipsPath}`);
        
        // Create symlinks in Frameworks folder
        const frameworksPath = path.join(appPath, 'Contents', 'Frameworks');
        if (!fs.existsSync(frameworksPath)) {
            fs.mkdirSync(frameworksPath, { recursive: true });
        }
        
        const libFiles = fs.readdirSync(sharpLibvipsPath).filter(f => f.endsWith('.dylib'));
        libFiles.forEach(lib => {
            const srcPath = path.join(sharpLibvipsPath, lib);
            const destPath = path.join(frameworksPath, lib);
            
            try {
                if (!fs.existsSync(destPath)) {
                    fs.copyFileSync(srcPath, destPath);
                    console.log(`  ✓ Copied ${lib} to Frameworks`);
                }
            } catch (err) {
                console.error(`  ✗ Failed to copy ${lib}:`, err.message);
            }
        });
    } else {
        console.warn('⚠️ Sharp libvips not found at expected location');
        console.warn('   Expected:', sharpLibvipsPath);
    }
};