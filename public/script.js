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
        this.outputDir = '';

        this.init();
    }

    async init() {
        console.log('Initializing Sony Lens Manager...');
        this.bindEvents();

        // Load lenses FIRST, then populate dropdown
        await this.loadLenses();
        this.renderLenses();
        // Check for cloud updates on startup
        if (navigator.onLine) {
            this.checkSyncStatus();
        }
        this.populateSelectionBarLenses(); // Explicit call after lenses loaded

        await this.loadOutputDirectory();
        await this.cleanupTempFiles();

        // Sync button
        const syncBtn = document.getElementById('syncBtn');
        if (syncBtn) {
            syncBtn.addEventListener('click', () => this.syncApp());
        }

        // Reload lenses button
        const reloadBtn = document.getElementById('reloadLensesBtn');
        if (reloadBtn) {
            reloadBtn.addEventListener('click', async () => {
                await this.loadLenses();
                this.renderLenses();
                this.showNotification('Lenses reloaded', 'success');
            });
        }

        // Check for cloud updates on startup
        if (navigator.onLine) {
            this.checkSyncStatus();
        }

        this.showNotification('Application ready. Shift+click to select multiple photos!', 'success');

        // Expose modal functions globally
        window.closePhotoModal = () => this.closePhotoModal();
        window.closeLensManagerModal = () => this.closeLensManagerModal();

        // Listen for messages from the lens manager iframe
        window.addEventListener('message', (event) => {
            if (event.data.type === 'LENSES_UPDATED') {
                console.log('Lenses updated, refreshing...');
                this.refreshLenses();
            } else if (event.data.type === 'CLOSE_LENS_MANAGER') {
                this.closeLensManagerModal();
            }
        });
    }

    async checkSyncStatus() {
        try {
            const response = await fetch('/api/sync/status');
            const status = await response.json();

            const syncBtn = document.getElementById('syncBtn');
            if (!status.syncAvailable && syncBtn) {
                syncBtn.style.display = 'none';
                return;
            }

            if (status.updatesAvailable && syncBtn) {
                syncBtn.classList.add('has-updates');
                syncBtn.innerHTML = `<i class="fas fa-cloud-download-alt"></i> Sync (${status.behindCount})`;
            }
        } catch (err) {
            console.log('Sync check skipped');
        }
    }

    async syncApp() {
        const syncBtn = document.getElementById('syncBtn');
        if (!syncBtn) return;

        const originalHTML = syncBtn.innerHTML;
        syncBtn.innerHTML = '<i class="fas fa-sync fa-spin"></i> Syncing...';
        syncBtn.disabled = true;

        try {
            const response = await fetch('/api/sync/lenses', { method: 'POST' });
            const result = await response.json();

            if (result.lenses) {
                this.lenses = result.lenses;
                this.renderLenses();
            }

            syncBtn.classList.remove('has-updates');
            syncBtn.innerHTML = '<i class="fas fa-check-circle"></i> Synced';
            this.showNotification(result.message || 'Synced!', 'success');

            setTimeout(() => {
                syncBtn.innerHTML = originalHTML;
                syncBtn.disabled = false;
            }, 3000);
        } catch (err) {
            syncBtn.innerHTML = originalHTML;
            syncBtn.disabled = false;
            this.showNotification('Sync failed', 'error');
        }
    }

    async refreshLenses() {
        await this.loadLenses();
        this.renderLenses();
        this.populateSelectionBarLenses(); // Re-populate dropdown
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
    async getHomeDirectory() {
        if (window.electronAPI?.getHomeDir) {
            try {
                const homeDir = await window.electronAPI.getHomeDir();
                return homeDir;
            } catch (error) {
                console.warn('Could not get home directory:', error);
                return '';
            }
        }
        return '';
    }

    async loadOutputDirectory() {
        try {
            const response = await fetch('/api/output-dir');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            this.outputDir = result.outputDir;
        } catch (error) {
            console.warn('Could not load output directory, using default:', error.message);
            this.outputDir = '';
        } finally {
            await this.updateOutputFolderDisplay();
        }
    }

    async updateOutputFolderDisplay() {
        const display = document.getElementById('outputFolderDisplay');
        if (!display) return;

        const homeDir = await this.getHomeDirectory();

        if (this.outputDir) {
            if (homeDir && this.outputDir.startsWith(homeDir)) {
                display.textContent = '~' + this.outputDir.substring(homeDir.length);
            } else {
                display.textContent = this.outputDir;
            }
        } else {
            const defaultPath = homeDir ? `${homeDir}/Downloads/SonyLensManager` : '~/Downloads/SonyLensManager';
            if (homeDir && defaultPath.startsWith(homeDir)) {
                display.textContent = '~' + defaultPath.substring(homeDir.length);
            } else {
                display.textContent = defaultPath;
            }
        }
    }

    async selectOutputFolder() {
        // For Electron, we can use the electronAPI to open a folder dialog
        if (window.electronAPI && window.electronAPI.selectFolder) {
            const folder = await window.electronAPI.selectFolder();
            if (folder) {
                await this.setOutputDirectory(folder);
            }
        } else {
            // Fallback for browser testing
            const folder = prompt('Enter output directory path:', this.outputDir);
            if (folder) {
                await this.setOutputDirectory(folder);
            }
        }
    }

    async setOutputDirectory(dir) {
        try {
            const response = await fetch('/api/set-output-dir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ outputDir: dir })
            });

            const result = await response.json();
            if (result.success) {
                this.outputDir = result.outputDir;
                this.updateOutputFolderDisplay();
                this.showNotification(`Output folder set to: ${dir}`, 'success');
            }
        } catch (error) {
            this.showNotification('Failed to set output folder', 'error');
        }
    }
    // Add method to populate selection bar dropdown:
    populateSelectionBarLenses() {
        const select = document.getElementById('selectionLensSelect');
        if (!select) {
            console.error('selectionLensSelect element NOT FOUND in DOM');
            return;
        }

        console.log(`Populating dropdown with ${this.lenses.length} lenses`);

        // Clear existing options
        select.innerHTML = '<option value="">-- Select Lens --</option>';

        // Add lenses
        this.lenses.forEach(lens => {
            const option = document.createElement('option');
            option.value = lens.id;
            option.textContent = `${lens.name} (${lens.focalLength || 'Unknown'})`;
            select.appendChild(option);
        });

        // Sync with currently selected lens
        if (this.selectedLens) {
            select.value = this.selectedLens;
        }

        console.log('Dropdown populated with options:', select.options.length);
    }


    // Update when a lens is selected in main panel:
    selectLens(lensId) {
        this.selectedLens = lensId;
        this.renderLenses();
        this.updateApplyButton();

        // Sync dropdown
        const select = document.getElementById('selectionLensSelect');
        if (select) {
            select.value = lensId;
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

        document.getElementById('selectOutputFolderBtn')?.addEventListener('click', () => this.selectOutputFolder());

        fileInput.addEventListener('change', async (e) => {
            if (e.target.files.length) {
                await this.uploadFiles(e.target.files);
                fileInput.value = '';
            }
        });

        const selectionLensSelect = document.getElementById('selectionLensSelect');
        if (selectionLensSelect) {
            selectionLensSelect.addEventListener('change', (e) => {
                const lensId = e.target.value;
                if (lensId) {
                    // Update the selected lens in the class
                    this.selectedLens = lensId;

                    // Re-render left panel to highlight the correct card
                    this.renderLenses();

                    // Update apply buttons
                    this.updateApplyButton();

                    const applyBtn = document.getElementById('applyToSelectedBtn');
                    if (applyBtn) {
                        applyBtn.disabled = this.selectedFiles.size === 0;
                    }

                    console.log(`Lens selected from dropdown: ${lensId}`);
                } else {
                    // No lens selected
                    this.selectedLens = null;
                    this.renderLenses();
                    this.updateApplyButton();

                    const applyBtn = document.getElementById('applyToSelectedBtn');
                    if (applyBtn) {
                        applyBtn.disabled = true;
                    }
                }
            });
        }

        // Sync button
        const syncBtn = document.getElementById('syncBtn');
        if (syncBtn) {
            syncBtn.addEventListener('click', () => this.syncApp());
        }

        // Reload lenses button
        const reloadBtn = document.getElementById('reloadLensesBtn');
        if (reloadBtn) {
            reloadBtn.addEventListener('click', async () => {
                await this.loadLenses();
                this.renderLenses();
                this.showNotification('Lenses reloaded', 'success');
            });
        }



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
        progressText.textContent = `Uploading ${validFiles.length} file(s) in parallel...`;

        // Create file list
        fileListContainer.innerHTML = validFiles.map((file, idx) => `
        <div class="file-progress-item" data-index="${idx}">
            <span class="file-name">${this.escapeHtml(file.name)}</span>
            <span class="file-status" id="fileStatus-${idx}">⏳ Pending</span>
        </div>
    `).join('');

        let completedUploads = 0;
        const totalFiles = validFiles.length;

        // Function to update a single file's status
        const updateFileStatus = (idx, status, text, color) => {
            const statusEl = document.getElementById(`fileStatus-${idx}`);
            if (statusEl) {
                statusEl.textContent = text;
                statusEl.style.color = color;
            }
        };

        // Function to update overall progress
        const updateOverallProgress = () => {
            completedUploads++;
            const percent = Math.round((completedUploads / totalFiles) * 100);
            progressFill.style.width = `${percent}%`;
            progressText.textContent = `Uploading: ${completedUploads}/${totalFiles} files (${percent}%)`;
        };

        // Create upload promises for ALL files (parallel execution)
        const uploadPromises = validFiles.map(async (file, idx) => {
            // Update status to uploading
            updateFileStatus(idx, 'uploading', '⬆️ Uploading...', '#3498db');

            const formData = new FormData();
            formData.append('photos', file);

            try {
                const response = await fetch('/api/upload-single', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (result.success) {
                    updateFileStatus(idx, 'completed', '✅ Uploaded', '#27ae60');
                    updateOverallProgress();

                    const fileInfo = result.file;
                    fileInfo.preview = null;
                    fileInfo.previewStatus = 'pending';

                    return { success: true, fileInfo, index: idx };
                } else {
                    throw new Error(result.error || 'Upload failed');
                }
            } catch (error) {
                updateFileStatus(idx, 'failed', '❌ Failed', '#e74c3c');
                updateOverallProgress();
                return { success: false, error: error.message, index: idx };
            }
        });

        // Wait for ALL uploads to complete in parallel
        const uploadResults = await Promise.all(uploadPromises);

        const successfulUploads = uploadResults.filter(r => r.success);
        const failedUploads = uploadResults.filter(r => !r.success);

        // Add uploaded files to the grid immediately
        const newFiles = successfulUploads.map(r => r.fileInfo);
        this.uploadedFiles = [...this.uploadedFiles, ...newFiles];
        this.renderPreviews();
        this.updateFileCount();

        progressFill.style.width = '100%';
        progressText.textContent = `✓ ${successfulUploads.length} files uploaded!`;

        if (failedUploads.length > 0) {
            this.showNotification(`${successfulUploads.length} uploaded, ${failedUploads.length} failed`, 'error');
        } else {
            this.showNotification(`${successfulUploads.length} files uploaded successfully!`, 'success');
        }

        // Hide progress section after delay
        setTimeout(() => {
            progressSection.style.display = 'none';
        }, 2000);

        // Start background preview generation
        if (successfulUploads.length > 0) {
            this.generatePreviewsInBackground(successfulUploads.map(r => r.fileInfo));
        }
    }

    // Helper: Update single file status in progress list
    updateFileStatus(index, status, text) {
        const container = document.getElementById('uploadFileList');
        if (!container) return;

        const item = container.querySelector(`.file-progress-item[data-index="${index}"]`);
        if (item) {
            const statusSpan = item.querySelector('.file-status');
            if (statusSpan) {
                statusSpan.className = `file-status upload-status ${status}`;
                statusSpan.textContent = text;
            }
        }
    }

    // PHASE 2: Background preview generation (doesn't block UI)
    async generatePreviewsInBackground(files) {
        console.log(`Starting background preview generation for ${files.length} files...`);

        // Show a subtle indicator that previews are generating
        this.showPreviewGeneratingIndicator(files.length);

        // Process previews with concurrency for speed
        const CONCURRENT_PREVIEWS = 4; // Adjust based on your system

        const queue = [...files];
        let completed = 0;

        const processNext = async () => {
            if (queue.length === 0) return;

            const batch = queue.splice(0, CONCURRENT_PREVIEWS);
            const promises = batch.map(async (fileInfo) => {
                try {
                    const response = await fetch('/api/generate-preview', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename: fileInfo.uploadedName })
                    });

                    const result = await response.json();

                    if (result.success) {
                        // Update the file in the array
                        const index = this.uploadedFiles.findIndex(f => f.uploadedName === fileInfo.uploadedName);
                        if (index !== -1) {
                            this.uploadedFiles[index].preview = result.preview;
                            this.uploadedFiles[index].largePreview = result.largePreview;
                            this.uploadedFiles[index].previewStatus = 'ready';

                            // Update just this card in the UI
                            this.updateSinglePreviewCard(index);
                        }
                    }
                } catch (error) {
                    console.error(`Preview failed for ${fileInfo.originalName}:`, error);
                }

                completed++;
                this.updatePreviewProgress(completed, files.length);
            });

            await Promise.all(promises);

            // Process next batch
            if (queue.length > 0) {
                await processNext();
            }
        };

        await processNext();

        // All previews generated
        this.hidePreviewGeneratingIndicator();
        this.showNotification(`All ${files.length} previews ready!`, 'success');
        console.log('Background preview generation complete');
    }

    // Show subtle preview generation indicator
    showPreviewGeneratingIndicator(total) {
        let indicator = document.getElementById('previewGeneratingIndicator');

        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'previewGeneratingIndicator';
            indicator.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 30px;
            background: rgba(44, 62, 80, 0.95);
            color: white;
            padding: 12px 20px;
            border-radius: 30px;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.3);
            z-index: 1000;
            backdrop-filter: blur(10px);
        `;
            document.body.appendChild(indicator);
        }

        indicator.innerHTML = `
        <i class="fas fa-sync fa-spin"></i>
        <span>Generating previews: <span id="previewProgressCount">0</span>/${total}</span>
    `;
    }

    updatePreviewProgress(completed, total) {
        const countSpan = document.getElementById('previewProgressCount');
        if (countSpan) {
            countSpan.textContent = completed;
        }
    }

    hidePreviewGeneratingIndicator() {
        const indicator = document.getElementById('previewGeneratingIndicator');
        if (indicator) {
            indicator.style.transition = 'opacity 0.3s';
            indicator.style.opacity = '0';
            setTimeout(() => indicator.remove(), 300);
        }
    }

    // Update a single card's preview image
    updateSinglePreviewCard(index) {
        const card = document.querySelector(`.photo-card[data-index="${index}"]`);
        if (!card) return;

        const file = this.uploadedFiles[index];
        if (!file || !file.preview) return;

        const img = card.querySelector('.photo-preview img');
        if (img) {
            // Fade in the new image
            img.style.opacity = '0';
            img.src = file.preview;

            img.onload = () => {
                img.style.transition = 'opacity 0.3s';
                img.style.opacity = '1';
            };
        }

        // Remove placeholder styling
        const previewDiv = card.querySelector('.photo-preview');
        if (previewDiv) {
            previewDiv.classList.remove('preview-loading');
        }
    }

    // New helper method for preview progress
    async generatePreviewsWithProgress(successfulUploads, fileStatuses, totalFiles, progressFill, progressText) {
        let completedPreviews = 0;
        const previewStartPercent = 50; // Start at 50%

        for (const upload of successfulUploads) {
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
                    this.updateSinglePreview(fileIndex);
                } else {
                    throw new Error(result.error || 'Preview generation failed');
                }
            } catch (error) {
                console.error(`Preview failed:`, error);
                fileStatuses[originalIndex].previewStatus = 'failed';
                this.updateUploadStatus(originalIndex, 'failed', 'preview');
            }

            // Update preview progress (50-100%)
            completedPreviews++;
            const previewPercent = previewStartPercent + ((completedPreviews / successfulUploads.length) * 50);
            progressFill.style.width = `${previewPercent}%`;
            progressText.textContent = `Generating previews: ${completedPreviews}/${successfulUploads.length} (${Math.round(previewPercent)}%)`;
        }

        // Final re-render to ensure all previews are shown
        this.renderPreviews();
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
            const isSelected = this.selectedFiles.has(index);
            const hasPreview = file.preview && file.previewStatus === 'ready';
            const previewUrl = hasPreview ? file.preview : '/api/placeholder-preview';
            const isLoading = !hasPreview;

            return `
        <div class="photo-card ${isSelected ? 'selected' : ''}" data-index="${index}">
            <div class="photo-preview ${isLoading ? 'preview-loading' : ''}" data-index="${index}">
                ${file.metadata?.hasLensInfo ? '<div class="lens-warning" title="Already has lens info"><i class="fas fa-times"></i></div>' : ''}
                <img src="${previewUrl}" alt="${this.escapeHtml(file.originalName)}" 
                     style="opacity: ${hasPreview ? '1' : '0.6'}; transition: opacity 0.3s;">
                ${isLoading ? '<div class="preview-loader"><i class="fas fa-spinner fa-spin"></i></div>' : ''}
                <div class="checkbox ${isSelected ? 'checked' : ''}" data-index="${index}"></div>
                <button class="remove-btn" data-index="${index}" title="Remove from list">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div class="photo-info">
                <div class="photo-name" title="${this.escapeHtml(file.originalName)}">
                    ${this.truncateFileName(file.originalName)}
                </div>
                <div class="photo-meta">
    ${file.metadata && file.metadata.dateTime ?
                    `<div><i class="far fa-clock"></i> ${new Date(file.metadata.dateTime).toLocaleString()}</div>` : ''}
    ${file.metadata && file.metadata.cameraModel ?
                    `<div><i class="fas fa-camera"></i> ${this.escapeHtml(file.metadata.cameraModel)}</div>` : ''}
    ${file.metadata && file.metadata.lensModel ?
                    `<div><i class="fas fa-lens"></i> ${this.escapeHtml(file.metadata.lensModel)}</div>` :
                    `<div style="color: #e67e22;"><i class="fas fa-exclamation-triangle"></i> No lens info</div>`}
    ${file.metadata && file.metadata.focalLength ?
                    `<div><i class="fas fa-arrows-alt-h"></i> ${file.metadata.focalLength}</div>` : ''}
    ${file.metadata && file.metadata.aperture ?
                    `<div><i class="fas fa-dot-circle"></i> ${file.metadata.aperture}</div>` : ''}
    ${file.metadata && file.metadata.iso ?
                    `<div><i class="fas fa-sun"></i> ISO ${file.metadata.iso}</div>` : ''}
    ${file.metadata && file.metadata.exposureTime ?
                    `<div><i class="fas fa-stopwatch"></i> ${file.metadata.exposureTime}s</div>` : ''}
    <div><i class="fas fa-file"></i> ${this.formatFileSize(file.size)}</div>
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

    // When selection changes, update the selection bar
    updateSelectionBar() {
        const bar = document.getElementById('selectionBar');
        const count = document.getElementById('selectionCount');

        if (this.selectedFiles.size > 0) {
            bar.style.display = 'flex';
            count.textContent = this.selectedFiles.size;

            // Sync the dropdown with current selected lens
            const select = document.getElementById('selectionLensSelect');
            if (select && this.selectedLens) {
                select.value = this.selectedLens;
            }

            this.updateApplyButton();
        } else {
            bar.style.display = 'none';
        }
    }

    // When photos are selected/deselected, update both apply buttons
    updateApplyButton() {
        const mainApplyBtn = document.getElementById('applyBtn');
        const selectionApplyBtn = document.getElementById('applyToSelectedBtn');

        const hasSelection = this.selectedFiles.size > 0;
        const hasLens = this.selectedLens !== null;

        if (mainApplyBtn) {
            mainApplyBtn.disabled = !hasSelection || !hasLens;
        }

        if (selectionApplyBtn) {
            selectionApplyBtn.disabled = !hasSelection || !hasLens;
        }
    }

    updateFileCount() {
        document.getElementById('fileCount').textContent = this.uploadedFiles.length;
    }

    // When user clicks a lens card in the left panel
    selectLens(lensId) {
        this.selectedLens = lensId;
        this.renderLenses(); // Re-render to highlight the selected card

        // Sync with selection bar dropdown
        const select = document.getElementById('selectionLensSelect');
        if (select) {
            select.value = lensId;
        }

        this.updateApplyButton();

        // Also update the apply button in selection bar
        const applyBtn = document.getElementById('applyToSelectedBtn');
        if (applyBtn) {
            applyBtn.disabled = this.selectedFiles.size === 0;
        }

        console.log(`Lens selected: ${lensId}`);
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

    updateSelectionBar() {
        const bar = document.getElementById('selectionBar');
        const count = document.getElementById('selectionCount');
        const applyBtn = document.getElementById('applyToSelectedBtn');

        if (this.selectedFiles.size > 0) {
            bar.style.display = 'flex';
            count.textContent = this.selectedFiles.size;

            // Enable apply button only if a lens is selected
            const select = document.getElementById('selectionLensSelect');
            applyBtn.disabled = !select || !select.value;
        } else {
            bar.style.display = 'none';
        }
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.lensManager = new LensManager();
});