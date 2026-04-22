class LensManagerApp {
    constructor() {
        this.lenses = [];
        this.currentLens = null;
        this.isEditing = false;
        this.searchTerm = '';

        this.init();
    }

    async init() {
        console.log('Initializing Lens Manager...');
        this.bindEvents();
        await this.loadLenses();
        this.renderLensList();
    }

    bindEvents() {
        // Add new lens button
        document.getElementById('addNewLensBtn')?.addEventListener('click', () => {
            this.createNewLens();
        });

        // Cancel edit button
        document.getElementById('cancelEditBtn')?.addEventListener('click', () => {
            this.cancelEdit();
        });

        // Save lens button
        document.getElementById('saveLensBtn')?.addEventListener('click', () => {
            this.saveLens();
        });

        // Delete lens button
        document.getElementById('deleteLensBtn')?.addEventListener('click', () => {
            this.deleteLens();
        });

        // Search input
        document.getElementById('lensSearchInput')?.addEventListener('input', (e) => {
            this.searchTerm = e.target.value.toLowerCase();
            this.renderLensList();
        });

        // Image upload
        document.getElementById('changeImageBtn')?.addEventListener('click', () => {
            document.getElementById('lensImageInput').click();
        });

        document.getElementById('removeImageBtn')?.addEventListener('click', () => {
            this.removeImage();
        });

        document.getElementById('lensImageInput')?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.previewImage(e.target.files[0]);
            }
        });

        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.dataset.tab;
                this.switchTab(tabId);
            });
        });

        // Lens type change
        document.getElementById('lensType')?.addEventListener('change', (e) => {
            this.updateFocalLengthField(e.target.value);
        });
        // Export report button
        document.getElementById('exportReportBtn')?.addEventListener('click', () => {
            this.exportReport();
        });
    }

    async loadLenses() {
        try {
            const response = await fetch('/api/lenses/all');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            this.lenses = await response.json();
            console.log(`Loaded ${this.lenses.length} lenses`);
        } catch (error) {
            console.error('Error loading lenses:', error);
            this.showNotification('Failed to load lenses', 'error');
            this.lenses = [];
        }
    }

    renderLensList() {
        const lensList = document.getElementById('lensList');
        if (!lensList) return;

        const filteredLenses = this.lenses.filter(lens =>
            lens.name.toLowerCase().includes(this.searchTerm) ||
            (lens.maker && lens.maker.toLowerCase().includes(this.searchTerm))
        );

        if (filteredLenses.length === 0) {
            lensList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-camera"></i>
                    <p>${this.searchTerm ? 'No lenses match your search' : 'No lenses yet'}</p>
                    <p>${this.searchTerm ? '' : 'Click "Add Lens" to get started'}</p>
                </div>
            `;
            return;
        }

        lensList.innerHTML = filteredLenses.map(lens => `
            <div class="lens-item ${this.currentLens?.id === lens.id ? 'active' : ''}" data-lens-id="${lens.id}">
                <div class="lens-item-image">
                    ${lens.primaryImage || lens.imageUrl ?
                `<img src="${lens.primaryImage || lens.imageUrl}" alt="${this.escapeHtml(lens.name)}">` :
                '<i class="fas fa-camera"></i>'
            }
                </div>
                <div class="lens-item-info">
                    <div class="lens-item-name">${this.escapeHtml(lens.name)}</div>
                    <div class="lens-item-specs">${lens.focalLength || ''} ${lens.aperture || ''}</div>
                    <span class="lens-item-badge">${lens.mount || 'No mount'}</span>
                </div>
            </div>
        `).join('');

        // Add click handlers to lens items
        lensList.querySelectorAll('.lens-item').forEach(item => {
            item.addEventListener('click', () => {
                const lensId = item.dataset.lensId;
                this.selectLens(lensId);
            });
        });
    }

    selectLens(lensId) {
        const lens = this.lenses.find(l => l.id === lensId);
        if (!lens) return;

        this.currentLens = JSON.parse(JSON.stringify(lens)); // Clone
        this.isEditing = true;

        this.populateForm(this.currentLens);
        this.showEditor();
        this.renderLensList();

        document.getElementById('editorTitle').textContent = `Editing: ${lens.name}`;
        document.getElementById('deleteLensBtn').style.display = 'inline-flex';
    }

    createNewLens() {
        this.currentLens = {
            id: 'lens-' + Date.now(),
            name: '',
            maker: '',
            type: 'prime',
            focalLength: '',
            fixedFocalLength: null,
            aperture: '',
            minAperture: null,
            exifLensModel: '',
            exifLensID: 'Manual Lens',
            description: '',
            imageUrl: null,
            primaryImage: null,
            isManual: true,
            isActive: true,
            isOwned: true,
            isWishlist: false,
            mount: '',
            serialNumber: '',
            manufactureDate: '',
            purchaseDate: '',
            purchasePrice: null,
            purchaseLocation: '',
            condition: '',
            filterThread: '',
            weight: '',
            dimensions: '',
            opticalDesign: '',
            minFocusDistance: '',
            maxMagnification: '',
            hoodModel: '',
            notes: '',
            tags: '',
            createdAt: new Date().toISOString()
        };

        this.isEditing = false;
        this.populateForm(this.currentLens);
        this.showEditor();
        this.renderLensList();

        document.getElementById('editorTitle').textContent = 'Create New Lens';
        document.getElementById('deleteLensBtn').style.display = 'none';
    }

    populateForm(lens) {
        // Basic Info
        document.getElementById('lensId').value = lens.id || '';
        document.getElementById('lensName').value = lens.name || '';
        document.getElementById('lensMaker').value = lens.maker || '';
        document.getElementById('lensType').value = lens.type || 'prime';
        document.getElementById('lensMount').value = lens.mount || '';
        document.getElementById('lensFocalLength').value = lens.focalLength || '';
        document.getElementById('lensFixedFocalLength').value = lens.fixedFocalLength || '';
        document.getElementById('lensAperture').value = lens.aperture || '';
        document.getElementById('lensMinAperture').value = lens.minAperture || '';
        document.getElementById('lensDescription').value = lens.description || '';
        document.getElementById('lensIsManual').checked = lens.isManual || false;

        // EXIF Data
        document.getElementById('lensExifLensID').value = lens.exifLensID || 'Manual Lens';
        document.getElementById('lensExifLensModel').value = lens.exifLensModel || '';

        // Collection Details
        document.getElementById('lensSerialNumber').value = lens.serialNumber || '';
        document.getElementById('lensCondition').value = lens.condition || '';
        document.getElementById('lensManufactureDate').value = lens.manufactureDate || '';
        document.getElementById('lensPurchaseDate').value = lens.purchaseDate ? lens.purchaseDate.substring(0, 10) : '';
        document.getElementById('lensPurchasePrice').value = lens.purchasePrice || '';
        document.getElementById('lensPurchaseLocation').value = lens.purchaseLocation || '';
        document.getElementById('lensNotes').value = lens.notes || '';
        document.getElementById('lensIsOwned').checked = lens.isOwned !== false;
        document.getElementById('lensIsWishlist').checked = lens.isWishlist || false;
        document.getElementById('lensIsActive').checked = lens.isActive !== false;

        // Specifications
        document.getElementById('lensFilterThread').value = lens.filterThread || '';
        document.getElementById('lensWeight').value = lens.weight || '';
        document.getElementById('lensDimensions').value = lens.dimensions || '';
        document.getElementById('lensHoodModel').value = lens.hoodModel || '';
        document.getElementById('lensOpticalDesign').value = lens.opticalDesign || '';
        document.getElementById('lensMinFocusDistance').value = lens.minFocusDistance || '';
        document.getElementById('lensMaxMagnification').value = lens.maxMagnification || '';

        // Tags - handle both array and string
        if (Array.isArray(lens.tags)) {
            document.getElementById('lensTags').value = lens.tags.join(', ');
        } else {
            document.getElementById('lensTags').value = lens.tags || '';
        }

        // Update image preview
        this.updateImagePreview(lens.primaryImage || lens.imageUrl);
    }

    updateImagePreview(imageUrl) {
        const previewContainer = document.getElementById('lensPreviewImage');
        if (!previewContainer) return;

        if (imageUrl) {
            previewContainer.innerHTML = `<img src="${imageUrl}" alt="Lens preview">`;
        } else {
            previewContainer.innerHTML = '<i class="fas fa-camera"></i>';
        }
    }

    previewImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            this.updateImagePreview(e.target.result);
            this.currentLens.imageFile = file;
            this.currentLens.imagePreview = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    removeImage() {
        this.updateImagePreview(null);
        this.currentLens.imageFile = null;
        this.currentLens.imagePreview = null;
        this.currentLens.primaryImage = null;
        this.currentLens.imageUrl = null;
        document.getElementById('lensImageInput').value = '';
    }

    getFormData() {
        const tagsInput = document.getElementById('lensTags').value;
        const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];

        return {
            id: document.getElementById('lensId').value,
            name: document.getElementById('lensName').value,
            maker: document.getElementById('lensMaker').value,
            type: document.getElementById('lensType').value,
            mount: document.getElementById('lensMount').value,
            focalLength: document.getElementById('lensFocalLength').value,
            fixedFocalLength: parseFloat(document.getElementById('lensFixedFocalLength').value) || null,
            aperture: document.getElementById('lensAperture').value,
            minAperture: parseFloat(document.getElementById('lensMinAperture').value) || null,
            description: document.getElementById('lensDescription').value,
            isManual: document.getElementById('lensIsManual').checked,
            exifLensID: document.getElementById('lensExifLensID').value,
            exifLensModel: document.getElementById('lensExifLensModel').value,
            serialNumber: document.getElementById('lensSerialNumber').value,
            condition: document.getElementById('lensCondition').value,
            manufactureDate: document.getElementById('lensManufactureDate').value,
            purchaseDate: document.getElementById('lensPurchaseDate').value,
            purchasePrice: parseFloat(document.getElementById('lensPurchasePrice').value) || null,
            purchaseLocation: document.getElementById('lensPurchaseLocation').value,
            notes: document.getElementById('lensNotes').value,
            isOwned: document.getElementById('lensIsOwned').checked,
            isWishlist: document.getElementById('lensIsWishlist').checked,
            isActive: document.getElementById('lensIsActive').checked,
            filterThread: document.getElementById('lensFilterThread').value,
            weight: document.getElementById('lensWeight').value,
            dimensions: document.getElementById('lensDimensions').value,
            hoodModel: document.getElementById('lensHoodModel').value,
            opticalDesign: document.getElementById('lensOpticalDesign').value,
            minFocusDistance: document.getElementById('lensMinFocusDistance').value,
            maxMagnification: document.getElementById('lensMaxMagnification').value,
            tags: tags
        };
    }

    async saveLens() {
        const lensData = this.getFormData();

        // Validation
        if (!lensData.name || !lensData.maker) {
            this.showNotification('Lens name and maker are required', 'error');
            return;
        }

        // Auto-generate EXIF model if empty
        if (!lensData.exifLensModel) {
            lensData.exifLensModel = `${lensData.maker} ${lensData.name}`;
        }

        const formData = new FormData();
        formData.append('lensData', JSON.stringify(lensData));

        if (this.currentLens.imageFile) {
            formData.append('lensImage', this.currentLens.imageFile);
        }

        const url = this.isEditing ? `/api/lenses/${lensData.id}` : '/api/lenses';
        const method = this.isEditing ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method: method,
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                this.showNotification(
                    this.isEditing ? 'Lens updated successfully' : 'Lens created successfully',
                    'success'
                );

                await this.loadLenses();
                this.cancelEdit();

                // Notify parent window
                window.parent.postMessage({ type: 'LENSES_UPDATED' }, '*');
            } else {
                throw new Error(result.error || 'Failed to save lens');
            }
        } catch (error) {
            console.error('Save error:', error);
            this.showNotification(`Failed to save lens: ${error.message}`, 'error');
        }
    }

    async deleteLens() {
        if (!this.currentLens || !this.currentLens.id) return;

        if (!confirm(`Are you sure you want to delete "${this.currentLens.name}"?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/lenses/${this.currentLens.id}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (result.success) {
                this.showNotification('Lens deleted successfully', 'success');
                await this.loadLenses();
                this.cancelEdit();

                // Notify parent window
                window.parent.postMessage({ type: 'LENSES_UPDATED' }, '*');
            } else {
                throw new Error(result.error || 'Failed to delete lens');
            }
        } catch (error) {
            console.error('Delete error:', error);
            this.showNotification(`Failed to delete lens: ${error.message}`, 'error');
        }
    }

    cancelEdit() {
        this.currentLens = null;
        this.isEditing = false;

        document.getElementById('lensForm').style.display = 'none';
        document.getElementById('noLensSelected').style.display = 'block';
        document.getElementById('cancelEditBtn').style.display = 'none';
        document.getElementById('saveLensBtn').style.display = 'none';
        document.getElementById('deleteLensBtn').style.display = 'none';
        document.getElementById('editorTitle').textContent = 'Select a lens or create new';

        // Reset to first tab
        this.switchTab('basic');

        this.renderLensList();
    }

    showEditor() {
        document.getElementById('lensForm').style.display = 'block';
        document.getElementById('noLensSelected').style.display = 'none';
        document.getElementById('cancelEditBtn').style.display = 'inline-flex';
        document.getElementById('saveLensBtn').style.display = 'inline-flex';
    }

    switchTab(tabId) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `tab-${tabId}`);
        });
    }

    updateFocalLengthField(type) {
        // Handle prime vs zoom lens UI changes if needed
        console.log('Lens type changed to:', type);
    }

    exportReport() {
        window.open('/api/lenses/report', '_blank');
        this.showNotification('Generating PDF report...', 'info');
    }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        if (!notification) return;

        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.style.display = 'block';

        setTimeout(() => {
            notification.style.display = 'none';
        }, 3000);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new LensManagerApp();
});