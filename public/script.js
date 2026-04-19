class LensManager {
    constructor() {
        this.uploadedFiles = [];
        this.selectedFiles = new Set();
        this.lenses = [];
        this.selectedLens = null;
        this.keepOriginalName = true;
        this.lastSelectedIndex = -1;
        this.isDragging = false;
        this.dragStartIndex = -1;

        this.init();
    }

    async init() {
        console.log('Initializing Sony Lens Manager...');
        this.bindEvents();
        await this.loadLenses();
        this.renderLenses();

        // Clean up temporary files on page load
        await this.cleanupTempFiles();

        this.showNotification('Application ready. Shift+click to select multiple photos!', 'success');

        // Expose modal functions globally
        window.closePhotoModal = () => this.closePhotoModal();
        window.closeLensManagerModal = () => this.closeLensManagerModal();

        // Listen for messages from the lens manager iframe
        window.addEventListener('message', (event) => {
            if (event.data.type === 'LENSES_UPDATED') {
                console.log('Lenses updated in modal, refreshing main page...');
                this.refreshLenses();
            } else if (event.data.type === 'CLOSE_LENS_MANAGER') {
                this.closeLensManagerModal();
            }
        });
    }

    // Add this method to refresh lenses
    // Add refreshLenses method (for modal close)
    async refreshLenses() {
        await this.loadLenses();
        this.renderLenses();
    }

    async cleanupTempFiles() {
        try {
            const response = await fetch('/api/cleanup-temp', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                console.log(`Cleaned up ${result.cleaned} temporary files`);
            }
        } catch (error) {
            console.error('Failed to cleanup temp files:', error);
        }
    }

    bindEvents() {
        // File upload
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');

        uploadArea.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = '#764ba2';
            uploadArea.style.background = '#f0f4ff';
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.style.borderColor = '#667eea';
            uploadArea.style.background = 'white';
        });

        uploadArea.addEventListener('drop', async (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = '#667eea';
            uploadArea.style.background = 'white';
            if (e.dataTransfer.files.length) {
                await this.uploadFiles(e.dataTransfer.files);
            }
        });
        document.getElementById('removeSelectedBtn')?.addEventListener('click', () => this.removeSelected());

        fileInput.addEventListener('change', async (e) => {
            if (e.target.files.length) {
                await this.uploadFiles(e.target.files);
                fileInput.value = '';
            }
        });



        // Clear button
        document.getElementById('clearBtn').addEventListener('click', () => this.clearAll());
        document.getElementById('clearDownloadsBtn')?.addEventListener('click', () => this.clearDownloads());
        document.getElementById('cleanupTempBtn')?.addEventListener('click', () => this.manualCleanup());

        // Apply button
        document.getElementById('applyBtn').addEventListener('click', () => this.applyLens());

        // Selection buttons
        document.getElementById('selectAllBtn').addEventListener('click', () => this.selectAll());
        document.getElementById('deselectAllBtn').addEventListener('click', () => this.deselectAll());

        // Selection bar buttons
        document.getElementById('clearSelectionBtn')?.addEventListener('click', () => this.deselectAll());
        document.getElementById('applyToSelectedBtn')?.addEventListener('click', () => this.applyLens());

        // Settings
        const keepOriginalToggle = document.getElementById('keepOriginalToggle');
        if (keepOriginalToggle) {
            keepOriginalToggle.addEventListener('change', (e) => {
                this.keepOriginalName = e.target.checked;
            });
        }

        // Downloads button
        document.getElementById('viewDownloadsBtn')?.addEventListener('click', () => this.viewDownloads());

        // Lens Manager Modal
        document.getElementById('openLensManagerBtn')?.addEventListener('click', () => this.openLensManagerModal());
        document.getElementById('closeLensManagerBtn')?.addEventListener('click', () => this.closeLensManagerModal());

        // Photo Modal close
        const modalCloseBtn = document.getElementById('modalCloseBtn');
        if (modalCloseBtn) {
            modalCloseBtn.addEventListener('click', () => this.closePhotoModal());
        }

        const photoModal = document.getElementById('photoModal');
        if (photoModal) {
            photoModal.addEventListener('click', (e) => {
                if (e.target === photoModal) {
                    this.closePhotoModal();
                }
            });
        }

        // Lens Manager Modal close on outside click
        const lensManagerModal = document.getElementById('lensManagerModal');
        if (lensManagerModal) {
            lensManagerModal.addEventListener('click', (e) => {
                if (e.target === lensManagerModal) {
                    this.closeLensManagerModal();
                }
            });
        }

        // Escape key to close modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closePhotoModal();
                this.closeLensManagerModal();
            }
        });

        // Prevent drag and drop default
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => e.preventDefault());
    }

    async loadLenses() {
        try {
            const response = await fetch('/api/lenses');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            this.lenses = await response.json();
            console.log(`Loaded ${this.lenses.length} lenses`);
        } catch (error) {
            console.error('Error loading lenses:', error);
            this.showNotification(`Failed to load lenses: ${error.message}`, 'error');
            this.lenses = [];
        }
    }

    closeLensManagerModal() {
        const modal = document.getElementById('lensManagerModal');
        if (modal) {
            modal.style.display = 'none';
            // Refresh the lens list on main page when modal closes
            this.refreshLenses();
            this.showNotification('Lens catalog updated. Refreshing list...', 'info');
        }
    }

    async uploadFiles(files) {
        const allowedTypes = ['.arw', '.ARW', '.jpg', '.jpeg', '.JPEG', '.JPG'];
        const validFiles = Array.from(files).filter(file => {
            const ext = '.' + file.name.split('.').pop().toLowerCase();
            return allowedTypes.includes(ext);
        });

        if (validFiles.length === 0) {
            this.showNotification('No valid files selected. Please upload Sony RAW (.arw) files.', 'error');
            return;
        }

        // Show progress section
        const progressSection = document.getElementById('uploadProgressSection');
        const progressFill = document.getElementById('uploadProgressFill');
        const progressText = document.getElementById('uploadProgressText');
        const fileListContainer = document.getElementById('uploadFileList');

        progressSection.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = `Uploading ${validFiles.length} file(s)...`;

        // Create file list with pending status
        const fileStatuses = validFiles.map(file => ({
            name: file.name,
            status: 'pending',
            uploadStatus: 'pending',
            previewStatus: 'pending',
            fileInfo: null,
            error: null
        }));

        fileListContainer.innerHTML = fileStatuses.map((fs, idx) => `
        <div class="file-progress-item" data-index="${idx}">
            <span class="file-name">${this.escapeHtml(fs.name)}</span>
            <div class="file-status-container">
                <span class="file-status upload-status pending">⏳ Upload</span>
                <span class="file-status preview-status pending">🖼️ Preview</span>
            </div>
        </div>
    `).join('');

        // Upload all files in parallel with Promise.all
        const uploadPromises = validFiles.map(async (file, idx) => {
            // Update status to uploading
            this.updateUploadStatus(idx, 'uploading', 'upload');

            const formData = new FormData();
            formData.append('photos', file);

            try {
                const response = await fetch('/api/upload-single', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (result.success) {
                    fileStatuses[idx].status = 'uploaded';
                    fileStatuses[idx].uploadStatus = 'completed';
                    fileStatuses[idx].fileInfo = result.file;
                    this.updateUploadStatus(idx, 'completed', 'upload');
                    return { success: true, fileInfo: result.file, index: idx };
                } else {
                    throw new Error(result.error || 'Upload failed');
                }
            } catch (error) {
                fileStatuses[idx].status = 'failed';
                fileStatuses[idx].uploadStatus = 'failed';
                fileStatuses[idx].error = error.message;
                this.updateUploadStatus(idx, 'failed', 'upload');
                return { success: false, error: error.message, index: idx };
            }
        });

        // Wait for all uploads to complete
        const uploadResults = await Promise.all(uploadPromises);
        const successfulUploads = uploadResults.filter(r => r.success);
        const failedUploads = uploadResults.filter(r => !r.success);

        // Update progress bar to show uploads complete
        progressFill.style.width = '100%';
        progressText.textContent = `Upload complete! ${successfulUploads.length} of ${validFiles.length} files uploaded. Generating previews...`;

        // Add successfully uploaded files to the list immediately
        const newFiles = successfulUploads.map(r => r.fileInfo);
        this.uploadedFiles = [...this.uploadedFiles, ...newFiles];
        this.renderPreviews();
        this.updateFileCount();

        // Start parallel preview generation for uploaded files
        if (successfulUploads.length > 0) {
            this.generatePreviewsInParallel(successfulUploads, fileStatuses, fileListContainer, progressText, progressFill);
        } else {
            // No files uploaded successfully
            setTimeout(() => {
                progressSection.style.display = 'none';
                this.showNotification(`Upload failed: ${failedUploads.length} files failed`, 'error');
            }, 3000);
        }
    }

    async generatePreviewsInParallel(successfulUploads, fileStatuses, fileListContainer, progressText, progressFill) {
    const totalPreviews = successfulUploads.length;
    let completedPreviews = 0;
    
    // CONFIGURATION: Change this number to control parallel previews
    const MAX_CONCURRENT_PREVIEWS = 60; // Increase this value (e.g., 20, 30, 50)
    
    // Update status text
    progressText.textContent = `Generating previews for ${totalPreviews} files (${MAX_CONCURRENT_PREVIEWS} at a time)...`;
    progressFill.style.width = '0%';
    
    // Process previews with concurrency limit
    const results = [];
    const queue = [...successfulUploads];
    
    async function processBatch() {
        const batch = queue.splice(0, MAX_CONCURRENT_PREVIEWS);
        if (batch.length === 0) return;
        
        const batchPromises = batch.map(async (upload) => {
            const fileInfo = upload.fileInfo;
            const originalIndex = upload.index;
            
            // Update status to generating preview
            this.updateUploadStatus(originalIndex, 'processing', 'preview');
            
            try {
                const response = await fetch('/api/generate-preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: fileInfo.uploadedName,
                        originalName: fileInfo.originalName
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // Update the file info with preview URLs
                    fileInfo.preview = result.preview;
                    fileInfo.largePreview = result.largePreview;
                    
                    // Update the file in the uploadedFiles array
                    const fileIndex = this.uploadedFiles.findIndex(f => f.uploadedName === fileInfo.uploadedName);
                    if (fileIndex !== -1) {
                        this.uploadedFiles[fileIndex].preview = result.preview;
                        this.uploadedFiles[fileIndex].largePreview = result.largePreview;
                    }
                    
                    fileStatuses[originalIndex].previewStatus = 'completed';
                    this.updateUploadStatus(originalIndex, 'completed', 'preview');
                    
                    completedPreviews++;
                    const percent = (completedPreviews / totalPreviews) * 100;
                    progressFill.style.width = `${percent}%`;
                    progressText.textContent = `Generating previews: ${completedPreviews}/${totalPreviews} (${MAX_CONCURRENT_PREVIEWS} parallel)...`;
                    
                    // Re-render the specific photo card to show preview
                    this.updateSinglePreview(fileIndex);
                    
                    return { success: true, index: originalIndex };
                } else {
                    throw new Error(result.error || 'Preview generation failed');
                }
            } catch (error) {
                console.error(`Preview failed for ${fileInfo.originalName}:`, error);
                fileStatuses[originalIndex].previewStatus = 'failed';
                this.updateUploadStatus(originalIndex, 'failed', 'preview');
                return { success: false, error: error.message, index: originalIndex };
            }
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Process next batch
        if (queue.length > 0) {
            await processBatch.call(this);
        }
    }
    
    // Start processing batches
    await processBatch.call(this);
    
    // Final update
    progressFill.style.width = '100%';
    const successfulPreviews = results.filter(r => r.success);
    progressText.textContent = `Complete! ${successfulUploads.length} files uploaded, ${successfulPreviews.length} previews generated.`;
    
    // Final re-render to ensure all previews are shown
    this.renderPreviews();
    
    // Hide progress section after delay
    setTimeout(() => {
        const progressSection = document.getElementById('uploadProgressSection');
        if (progressSection) {
            progressSection.style.display = 'none';
        }
    }, 3000);
    
    const failedPreviews = results.filter(r => !r.success);
    if (failedPreviews.length > 0) {
        console.warn(`${failedPreviews.length} previews failed to generate`);
    }
}
    updateUploadStatus(index, status, type) {
        const container = document.getElementById('uploadFileList');
        if (!container) return;

        const item = container.querySelector(`.file-progress-item[data-index="${index}"]`);
        if (item) {
            const statusSpan = item.querySelector(`.${type}-status`);
            if (statusSpan) {
                statusSpan.className = `file-status ${type}-status ${status}`;
                switch (status) {
                    case 'pending':
                        statusSpan.innerHTML = type === 'upload' ? '⏳ Upload' : '🖼️ Waiting';
                        break;
                    case 'uploading':
                        statusSpan.innerHTML = '⬆️ Uploading...';
                        break;
                    case 'processing':
                        statusSpan.innerHTML = '🎨 Generating...';
                        break;
                    case 'completed':
                        statusSpan.innerHTML = type === 'upload' ? '✅ Uploaded' : '✅ Ready';
                        break;
                    case 'failed':
                        statusSpan.innerHTML = '❌ Failed';
                        break;
                }
            }
        }
    }

    updateSinglePreview(index) {
        if (index === -1) return;

        const card = document.querySelector(`.photo-card[data-index="${index}"]`);
        if (card) {
            const img = card.querySelector('.photo-preview img');
            const file = this.uploadedFiles[index];
            if (img && file && file.preview) {
                img.src = file.preview;
            }
        }
    }

    pollForPreviews() {
        // Check every second if previews are ready
        let attempts = 0;
        const maxAttempts = 60; // 60 seconds max

        const checkInterval = setInterval(() => {
            attempts++;

            // Check if all previews are loaded
            const allLoaded = this.uploadedFiles.every(file => {
                if (!file.preview) return true;
                const img = new Image();
                let loaded = false;
                img.onload = () => { loaded = true; };
                img.onerror = () => { loaded = false; };
                img.src = file.preview + '?t=' + Date.now();
                return loaded;
            });

            if (allLoaded || attempts >= maxAttempts) {
                clearInterval(checkInterval);
                if (allLoaded) {
                    this.showNotification('All previews ready!', 'success');
                    this.renderPreviews(); // Re-render to ensure all images show
                } else {
                    console.log('Preview polling timeout, some previews may still be loading');
                }
            }
        }, 1000);
    }

    updateUploadFileStatus(container, index, status, statusText) {
        const item = container.querySelector(`.file-progress-item[data-index="${index}"]`);
        if (item) {
            const statusSpan = item.querySelector('.file-status');
            statusSpan.className = `file-status ${status}`;
            statusSpan.textContent = statusText;
        }
    }

    renderLenses() {
        const lensList = document.getElementById('lensList');
        lensList.innerHTML = '';

        if (this.lenses.length === 0) {
            lensList.innerHTML = '<div class="empty-state"><p>No lenses loaded. Add some in the Lens Manager!</p></div>';
            return;
        }

        this.lenses.forEach(lens => {
            const lensCard = document.createElement('div');
            lensCard.className = 'lens-card';
            lensCard.dataset.lensId = lens.id;

            const typeIcon = lens.type === 'prime' ? 'fa-dot-circle' : 'fa-search';

            lensCard.innerHTML = `
                <div class="lens-icon">
                    ${lens.imageUrl ?
                    `<img src="${lens.imageUrl}" alt="${this.escapeHtml(lens.name)}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 50%;">` :
                    `<i class="fas ${typeIcon}"></i>`
                }
                </div>
                <div class="lens-info">
                    <div class="lens-name">${this.escapeHtml(lens.name)}</div>
                    <div class="lens-specs">${this.escapeHtml(lens.focalLength)} • ${this.escapeHtml(lens.aperture)}</div>
                    ${lens.description ? `<div class="lens-description">${this.escapeHtml(lens.description)}</div>` : ''}
                </div>
            `;

            lensCard.addEventListener('click', () => this.selectLens(lens.id));

            if (this.selectedLens === lens.id) {
                lensCard.classList.add('selected');
            }

            lensList.appendChild(lensCard);
        });
    }

    renderPreviews() {
        const previewGrid = document.getElementById('previewGrid');

        if (this.uploadedFiles.length === 0) {
            previewGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-images fa-3x"></i>
                    <p>No photos uploaded yet</p>
                    <p>Upload Sony RAW (.arw) files to get started</p>
                    <p class="upload-hint">Shift+click to select multiple photos</p>
                </div>
            `;
            this.updateSelectionBar();
            return;
        }

        previewGrid.innerHTML = this.uploadedFiles.map((file, index) => {
            let dateDisplay = 'Date: Unavailable';
            if (file.metadata && file.metadata.dateTime) {
                try {
                    const date = new Date(file.metadata.dateTime);
                    if (!isNaN(date.getTime())) {
                        dateDisplay = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    }
                } catch (e) { }
            }

            const isSelected = this.selectedFiles.has(index);
            const originalName = this.escapeHtml(file.originalName || '');
            const truncatedName = this.truncateFileName(file.originalName);
            const fileType = (file.type || '.arw').toUpperCase().replace('.', '');
            const hasLensInfo = file.metadata && file.metadata.hasLensInfo;
            const previewUrl = file.preview || '/api/placeholder-preview';

            let exposureDisplay = '';
            if (file.metadata && file.metadata.exposureTime) {
                const exp = file.metadata.exposureTime;
                if (typeof exp === 'number') {
                    exposureDisplay = exp >= 1 ? `${exp}s` : `1/${Math.round(1 / exp)}s`;
                } else {
                    exposureDisplay = exp;
                }
            }

            return `
            <div class="photo-card ${isSelected ? 'selected' : ''}" data-index="${index}">
                <div class="photo-preview" data-index="${index}">
                    ${hasLensInfo ? '<div class="lens-warning" title="Already has lens info"><i class="fas fa-times"></i></div>' : ''}
                    <img src="${previewUrl}" alt="${originalName}" data-index="${index}">
                    <div class="checkbox ${isSelected ? 'checked' : ''}" data-index="${index}"></div>
                    <button class="remove-btn" data-index="${index}" title="Remove from list">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="photo-info">
                    <div class="photo-name" title="${originalName}">
                        ${this.escapeHtml(truncatedName)}
                        <span class="file-type">${this.escapeHtml(fileType)}</span>
                    </div>
                    <div class="photo-meta">
                        <div><i class="far fa-calendar"></i> ${dateDisplay}</div>
                        ${file.metadata && file.metadata.cameraModel ? `<div><i class="fas fa-camera"></i> ${this.escapeHtml(file.metadata.cameraModel)}</div>` : ''}
                        ${file.metadata && file.metadata.lensModel ?
                    `<div class="lens-info-existing"><i class="fas fa-lens"></i> ${this.escapeHtml(file.metadata.lensModel)}</div>` :
                    `<div class="no-lens-info"><i class="fas fa-lens"></i> No lens info</div>`}
                        <div class="photo-exif">
                            ${file.metadata && file.metadata.focalLength ? `<span><i class="fas fa-ruler"></i> ${this.escapeHtml(file.metadata.focalLength)}</span>` : ''}
                            ${file.metadata && file.metadata.aperture ? `<span><i class="fas fa-circle"></i> ${this.escapeHtml(file.metadata.aperture)}</span>` : ''}
                            ${file.metadata && file.metadata.iso ? `<span><i class="fas fa-sun"></i> ISO ${this.escapeHtml(file.metadata.iso)}</span>` : ''}
                            ${exposureDisplay ? `<span><i class="fas fa-stopwatch"></i> ${exposureDisplay}</span>` : ''}
                        </div>
                    </div>
                </div>
            </div>
            `;
        }).join('');

        this.attachPreviewEventListeners();
        this.updateSelectionBar();
    }

    attachPreviewEventListeners() {
        const cards = document.querySelectorAll('.photo-card');

        cards.forEach(card => {
            const index = parseInt(card.dataset.index);

            card.addEventListener('click', (e) => {
                if (!e.target.closest('.remove-btn') && !e.target.closest('.checkbox')) {
                    if (e.shiftKey && this.lastSelectedIndex !== -1 && this.lastSelectedIndex !== index) {
                        this.selectRange(this.lastSelectedIndex, index);
                    } else {
                        this.toggleFileSelection(index);
                        this.lastSelectedIndex = index;
                    }
                }
            });

            const checkbox = card.querySelector('.checkbox');
            if (checkbox) {
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (e.shiftKey && this.lastSelectedIndex !== -1 && this.lastSelectedIndex !== index) {
                        this.selectRange(this.lastSelectedIndex, index);
                    } else {
                        this.toggleFileSelection(index);
                        this.lastSelectedIndex = index;
                    }
                });
            }

            const removeBtn = card.querySelector('.remove-btn');
            if (removeBtn) {
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.removeFile(index);
                });
            }

            const previewDiv = card.querySelector('.photo-preview');
            previewDiv.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.openPhotoModal(index);
            });
        });

        const previewGrid = document.getElementById('previewGrid');
        let isDragging = false;
        let dragStartIndex = -1;

        previewGrid.addEventListener('mousedown', (e) => {
            const card = e.target.closest('.photo-card');
            if (card && !e.shiftKey && !e.target.closest('.remove-btn')) {
                isDragging = true;
                dragStartIndex = parseInt(card.dataset.index);
                e.preventDefault();
            }
        });

        previewGrid.addEventListener('mouseover', (e) => {
            if (isDragging && dragStartIndex !== -1) {
                const card = e.target.closest('.photo-card');
                if (card) {
                    const currentIndex = parseInt(card.dataset.index);
                    this.selectRange(dragStartIndex, currentIndex);
                }
            }
        });

        previewGrid.addEventListener('mouseup', () => {
            isDragging = false;
            dragStartIndex = -1;
        });

        previewGrid.addEventListener('dragstart', (e) => e.preventDefault());
    }

    selectRange(startIndex, endIndex) {
        const min = Math.min(startIndex, endIndex);
        const max = Math.max(startIndex, endIndex);

        this.selectedFiles.clear();
        for (let i = min; i <= max; i++) {
            this.selectedFiles.add(i);
        }

        this.renderPreviews();
        this.updateSelectionBar();
        this.updateApplyButton();
    }

    toggleFileSelection(index) {
        if (this.selectedFiles.has(index)) {
            this.selectedFiles.delete(index);
            if (this.lastSelectedIndex === index) {
                this.lastSelectedIndex = -1;
            }
        } else {
            this.selectedFiles.add(index);
            this.lastSelectedIndex = index;
        }

        this.renderPreviews();
        this.updateSelectionBar();
        this.updateApplyButton();
    }

    selectAll() {
        this.selectedFiles.clear();
        this.uploadedFiles.forEach((_, index) => this.selectedFiles.add(index));
        this.lastSelectedIndex = -1;
        this.renderPreviews();
        this.updateSelectionBar();
        this.updateApplyButton();
        this.showNotification(`Selected ${this.selectedFiles.size} photos`, 'info');
    }

    deselectAll() {
        this.selectedFiles.clear();
        this.lastSelectedIndex = -1;
        this.renderPreviews();
        this.updateSelectionBar();
        this.updateApplyButton();
        this.showNotification('Selection cleared', 'info');
    }

    removeFile(index) {
        if (confirm(`Remove "${this.uploadedFiles[index].originalName}" from the list?`)) {
            this.selectedFiles.delete(index);
            this.uploadedFiles.splice(index, 1);

            const newSelected = new Set();
            this.selectedFiles.forEach(selectedIndex => {
                if (selectedIndex > index) {
                    newSelected.add(selectedIndex - 1);
                } else if (selectedIndex < index) {
                    newSelected.add(selectedIndex);
                }
            });
            this.selectedFiles = newSelected;
            this.lastSelectedIndex = -1;

            this.renderPreviews();
            this.updateFileCount();
            this.updateSelectionBar();
            this.updateApplyButton();

            this.showNotification('File removed from list', 'success');
        }
    }
    // Add removeSelected method
    removeSelected() {
        if (this.selectedFiles.size === 0) {
            this.showNotification('No files selected to remove', 'info');
            return;
        }

        const count = this.selectedFiles.size;
        if (confirm(`Remove ${count} selected file${count !== 1 ? 's' : ''} from the list? This will NOT delete the original files.`)) {
            // Convert Set to array and sort in descending order to remove from end first
            const indicesToRemove = Array.from(this.selectedFiles).sort((a, b) => b - a);

            for (const index of indicesToRemove) {
                this.uploadedFiles.splice(index, 1);
            }

            // Clear selection
            this.selectedFiles.clear();
            this.lastSelectedIndex = -1;

            // Re-render
            this.renderPreviews();
            this.updateFileCount();
            this.updateSelectionBar();
            this.updateApplyButton();

            this.showNotification(`Removed ${count} file${count !== 1 ? 's' : ''} from list`, 'success');
        }
    }

    // Update updateSelectionBar method
    updateSelectionBar() {
        const selectionBar = document.getElementById('selectionBar');
        const selectionCount = document.getElementById('selectionCount');

        if (this.selectedFiles.size > 0 && selectionBar) {
            selectionBar.style.display = 'flex';
            selectionCount.textContent = this.selectedFiles.size;
        } else if (selectionBar) {
            selectionBar.style.display = 'none';
        }
    }

    updateApplyButton() {
        const applyBtn = document.getElementById('applyBtn');
        applyBtn.disabled = this.selectedFiles.size === 0 || !this.selectedLens;

        const selectionCount = this.selectedFiles.size;
        applyBtn.innerHTML = selectionCount === 0 || !this.selectedLens ?
            '<i class="fas fa-magic"></i> Apply Lens to Selected Photos' :
            `<i class="fas fa-magic"></i> Apply to ${selectionCount} Photo${selectionCount !== 1 ? 's' : ''}`;
    }

    updateFileCount() {
        document.getElementById('fileCount').textContent = this.uploadedFiles.length;
    }

    selectLens(lensId) {
        this.selectedLens = lensId;
        this.renderLenses();
        this.updateApplyButton();
    }

    openPhotoModal(index) {
        const file = this.uploadedFiles[index];
        if (!file) return;

        const modal = document.getElementById('photoModal');
        const modalImage = document.getElementById('modalImage');
        const modalPhotoName = document.getElementById('modalPhotoName');
        const modalMetadata = document.getElementById('modalMetadata');

        let imageUrl = '/api/placeholder-preview';
        if (file.largePreview) {
            imageUrl = file.largePreview;
        } else if (file.preview) {
            imageUrl = file.preview;
        }

        modalImage.src = imageUrl;
        modalPhotoName.textContent = file.originalName;

        let dateDisplay = 'Unavailable';
        if (file.metadata && file.metadata.dateTime) {
            try {
                const date = new Date(file.metadata.dateTime);
                if (!isNaN(date.getTime())) {
                    dateDisplay = date.toLocaleString();
                }
            } catch (e) { }
        }

        let exposureDisplay = 'Unavailable';
        if (file.metadata && file.metadata.exposureTime) {
            const exp = file.metadata.exposureTime;
            if (typeof exp === 'number') {
                exposureDisplay = exp >= 1 ? `${exp} sec` : `1/${Math.round(1 / exp)} sec`;
            } else if (typeof exp === 'string') {
                exposureDisplay = exp;
            } else if (exp && exp.toString) {
                exposureDisplay = exp.toString();
            }
        }

        let focalDisplay = file.metadata?.focalLength || 'Unavailable';
        let apertureDisplay = file.metadata?.aperture || 'Unavailable';
        let isoDisplay = file.metadata?.iso || 'Unavailable';

        modalMetadata.innerHTML = `
            <div><strong><i class="fas fa-calendar"></i> Date/Time:</strong> ${dateDisplay}</div>
            <div><strong><i class="fas fa-camera"></i> Camera:</strong> ${this.escapeHtml(file.metadata?.cameraModel || 'Unknown')}</div>
            <div><strong><i class="fas fa-lens"></i> Current Lens:</strong> ${this.escapeHtml(file.metadata?.lensModel || 'No lens info')}</div>
            <div class="exif-grid">
                <div><strong><i class="fas fa-ruler"></i> Focal Length:</strong> ${this.escapeHtml(focalDisplay)}</div>
                <div><strong><i class="fas fa-circle"></i> Aperture:</strong> ${this.escapeHtml(apertureDisplay)}</div>
                <div><strong><i class="fas fa-sun"></i> ISO:</strong> ${this.escapeHtml(isoDisplay)}</div>
                <div><strong><i class="fas fa-stopwatch"></i> Shutter Speed:</strong> ${this.escapeHtml(exposureDisplay)}</div>
            </div>
            <div><strong><i class="fas fa-file"></i> File Size:</strong> ${this.formatFileSize(file.size)}</div>
            <div><strong><i class="fas fa-hashtag"></i> Index:</strong> ${index + 1} of ${this.uploadedFiles.length}</div>
            <div><strong><i class="fas fa-info-circle"></i> File Name:</strong> ${this.escapeHtml(file.originalName)}</div>
        `;

        modal.dataset.currentIndex = index;

        const modalApplyBtn = document.getElementById('modalApplyBtn');
        const newApplyBtn = modalApplyBtn.cloneNode(true);
        modalApplyBtn.parentNode.replaceChild(newApplyBtn, modalApplyBtn);
        newApplyBtn.addEventListener('click', () => {
            this.selectedFiles.clear();
            this.selectedFiles.add(index);
            this.applyLens();
            this.closePhotoModal();
        });

        modal.style.display = 'flex';
    }

    closePhotoModal() {
        const modal = document.getElementById('photoModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // Update openLensManagerModal
    openLensManagerModal() {
        const modal = document.getElementById('lensManagerModal');
        if (modal) {
            modal.style.display = 'flex';
            const iframe = document.getElementById('lensManagerIframe');
            if (iframe) {
                // Store the current src to force reload
                const currentSrc = iframe.src;
                iframe.src = 'about:blank';
                setTimeout(() => {
                    iframe.src = currentSrc;
                }, 100);
            }
        }
    }

    removeSelected() {
        if (this.selectedFiles.size === 0) {
            this.showNotification('No files selected to remove', 'info');
            return;
        }

        const count = this.selectedFiles.size;
        if (confirm(`Remove ${count} selected file${count !== 1 ? 's' : ''} from the list? This will NOT delete the original files.`)) {
            // Convert Set to array and sort in descending order to remove from end first
            const indicesToRemove = Array.from(this.selectedFiles).sort((a, b) => b - a);

            for (const index of indicesToRemove) {
                this.uploadedFiles.splice(index, 1);
            }

            // Clear selection
            this.selectedFiles.clear();
            this.lastSelectedIndex = -1;

            // Re-render
            this.renderPreviews();
            this.updateFileCount();
            this.updateSelectionBar();
            this.updateApplyButton();

            this.showNotification(`Removed ${count} file${count !== 1 ? 's' : ''} from list`, 'success');
        }
    }

    // Update closeLensManagerModal
    closeLensManagerModal() {
        const modal = document.getElementById('lensManagerModal');
        if (modal) {
            modal.style.display = 'none';
            // Refresh lenses in case changes were made
            this.refreshLenses();
        }
    }

    async applyLens() {
        if (this.selectedFiles.size === 0 || !this.selectedLens) return;

        const selectedLens = this.lenses.find(l => l.id === this.selectedLens);
        if (!selectedLens) return;

        const confirmMessage = `Apply "${selectedLens.name}" to ${this.selectedFiles.size} selected photo${this.selectedFiles.size !== 1 ? 's' : ''}?\n\n` +
            `Files will be saved with original names in downloads folder.\n\n` +
            `After processing, these photos will be removed from the selection.`;

        if (!confirm(confirmMessage)) return;

        const selectedFileNames = Array.from(this.selectedFiles).map(index =>
            this.uploadedFiles[index].uploadedName
        );

        // Get progress elements
        const processingSection = document.getElementById('processingSection');
        const progressFill = document.getElementById('progressFill');
        const processingInfo = document.getElementById('processingInfo');
        const progressText = document.getElementById('progressText');
        const progressList = document.getElementById('progressList');

        // Make sure processing section is visible and reset
        processingSection.style.display = 'block';
        progressFill.style.width = '0%';
        processingInfo.innerHTML = `<i class="fas fa-sync fa-spin"></i> Processing ${this.selectedFiles.size} file(s)...`;

        if (progressText) {
            progressText.style.display = 'block';
            progressText.textContent = `Preparing to process ${this.selectedFiles.size} file(s)...`;
        }

        // Create progress list
        const fileStatuses = [];
        const selectedIndices = Array.from(this.selectedFiles);

        for (let i = 0; i < selectedIndices.length; i++) {
            const index = selectedIndices[i];
            fileStatuses.push({
                originalIndex: index,
                fileName: this.uploadedFiles[index].originalName,
                status: 'pending',
                error: null
            });
        }

        // Display progress list
        if (progressList) {
            progressList.style.display = 'block';
            progressList.innerHTML = fileStatuses.map((fs, idx) => `
            <div class="progress-item" data-idx="${idx}">
                <span class="progress-file-name">${this.escapeHtml(fs.fileName)}</span>
                <span class="progress-status pending">⏳ Pending</span>
            </div>
        `).join('');
        }

        // Animate selected cards
        selectedIndices.forEach(index => {
            const card = document.querySelector(`.photo-card[data-index="${index}"]`);
            if (card) card.classList.add('processing');
        });

        try {
            const processedResults = [];

            for (let i = 0; i < selectedFileNames.length; i++) {
                const fileName = selectedFileNames[i];

                // Update status to processing
                fileStatuses[i].status = 'processing';
                if (progressList) {
                    const item = progressList.querySelector(`.progress-item[data-idx="${i}"]`);
                    if (item) {
                        const statusSpan = item.querySelector('.progress-status');
                        statusSpan.className = 'progress-status processing';
                        statusSpan.innerHTML = '🔄 Processing...';
                    }
                }

                // Update progress bar
                const percent = (i / selectedFileNames.length) * 100;
                progressFill.style.width = `${percent}%`;

                if (progressText) {
                    progressText.textContent = `Processing file ${i + 1} of ${selectedFileNames.length}: ${fileStatuses[i].fileName}`;
                }
                processingInfo.innerHTML = `<i class="fas fa-sync fa-spin"></i> Processing ${i + 1} of ${selectedFileNames.length}...`;

                try {
                    const response = await fetch('/api/apply-lens-single', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            fileName: fileName,
                            lensId: this.selectedLens,
                            keepOriginalName: this.keepOriginalName
                        })
                    });

                    const result = await response.json();

                    if (result.success) {
                        fileStatuses[i].status = 'completed';
                        if (progressList) {
                            const item = progressList.querySelector(`.progress-item[data-idx="${i}"]`);
                            if (item) {
                                const statusSpan = item.querySelector('.progress-status');
                                statusSpan.className = 'progress-status completed';
                                statusSpan.innerHTML = '✅ Completed';
                            }
                        }
                        processedResults.push(result);
                    } else {
                        throw new Error(result.error || 'Processing failed');
                    }
                } catch (err) {
                    fileStatuses[i].status = 'failed';
                    if (progressList) {
                        const item = progressList.querySelector(`.progress-item[data-idx="${i}"]`);
                        if (item) {
                            const statusSpan = item.querySelector('.progress-status');
                            statusSpan.className = 'progress-status failed';
                            statusSpan.innerHTML = `❌ Failed: ${err.message.substring(0, 30)}`;
                        }
                    }
                }
            }

            // Final update
            progressFill.style.width = '100%';
            const completedCount = fileStatuses.filter(f => f.status === 'completed').length;
            const failedCount = fileStatuses.filter(f => f.status === 'failed').length;

            processingInfo.innerHTML = `<i class="fas fa-check-circle"></i> Completed: ${completedCount} | Failed: ${failedCount}`;
            if (progressText) {
                progressText.textContent = `Done! ${completedCount} of ${selectedFileNames.length} files processed.`;
            }

            // Remove processed files from uploadedFiles array
            const processedIndices = new Set();
            fileStatuses.forEach((fs, i) => {
                if (fs.status === 'completed') {
                    processedIndices.add(fs.originalIndex);
                }
            });

            this.uploadedFiles = this.uploadedFiles.filter((_, idx) => !processedIndices.has(idx));

            // Clear selection
            this.selectedFiles.clear();
            this.lastSelectedIndex = -1;

            // Re-render previews
            this.renderPreviews();
            this.updateFileCount();
            this.updateSelectionBar();
            this.updateApplyButton();

            setTimeout(() => {
                processingSection.style.display = 'none';
                if (progressList) progressList.innerHTML = '';
                if (completedCount > 0) {
                    this.showNotification(`${completedCount} file(s) processed with ${selectedLens.name}!`, 'success');
                    if (failedCount > 0) {
                        this.showNotification(`${failedCount} file(s) failed. Check console for details.`, 'error');
                    }
                }
            }, 2000);

        } catch (error) {
            processingSection.style.display = 'none';
            this.showNotification(`Failed to apply lens: ${error.message}`, 'error');
            console.error('Apply lens error:', error);

            // Remove processing animation
            selectedIndices.forEach(index => {
                const card = document.querySelector(`.photo-card[data-index="${index}"]`);
                if (card) card.classList.remove('processing');
            });
        }
    }

    async manualCleanup() {
        if (confirm('Clean up temporary files? This will clear all uploaded files and previews.')) {
            const response = await fetch('/api/cleanup-temp', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                this.uploadedFiles = [];
                this.selectedFiles.clear();
                this.renderPreviews();
                this.updateFileCount();
                this.updateSelectionBar();
                this.updateApplyButton();
                this.showNotification(`Cleaned ${result.cleaned} temporary files`, 'success');
            }
        }
    }

    async viewDownloads() {
        try {
            const response = await fetch('/api/open-downloads-folder', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                this.showNotification('Opening downloads folder...', 'info');
            } else {
                this.showNotification('Failed to open downloads folder', 'error');
            }
        } catch (error) {
            console.error('Error opening downloads:', error);
            this.showNotification('Failed to open downloads folder', 'error');
        }
    }

    async clearAll() {
        if (!this.uploadedFiles.length) return;

        if (!confirm('Are you sure you want to clear all uploaded files and previews? This cannot be undone.')) return;

        try {
            const response = await fetch('/api/clear-uploads', { method: 'POST' });
            const result = await response.json();

            if (result.success) {
                this.uploadedFiles = [];
                this.selectedFiles.clear();
                this.lastSelectedIndex = -1;
                this.renderPreviews();
                this.updateFileCount();
                this.updateSelectionBar();
                this.updateApplyButton();
                this.showNotification('All files cleared', 'success');
            }
        } catch (error) {
            this.showNotification('Failed to clear files', 'error');
        }
    }

    async clearDownloads() {
        if (!confirm('Are you sure you want to clear the downloads folder? This will delete all processed files.')) return;

        try {
            const response = await fetch('/api/clear-downloads', { method: 'POST' });
            const result = await response.json();
            if (result.success) this.showNotification('Downloads folder cleared', 'success');
        } catch (error) {
            this.showNotification('Failed to clear downloads', 'error');
        }
    }

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.style.display = 'block';
        setTimeout(() => notification.style.display = 'none', 4000);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    truncateFileName(name, maxLength = 25) {
        if (!name) return '';
        const ext = name.split('.').pop();
        const baseName = name.slice(0, name.lastIndexOf('.'));
        if (baseName.length <= maxLength) return name;
        return baseName.slice(0, maxLength - 3) + '...' + ext;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.lensManager = new LensManager();
});