// Global variables
let currentLenses = [];
let editingLensId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log('Lens Manager initializing...');
    loadLenses();
    setupEventListeners();
});

function setupEventListeners() {
    const searchInput = document.getElementById('searchLenses');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => filterLenses(e.target.value));
    }
    
    const lensForm = document.getElementById('lensForm');
    if (lensForm) {
        lensForm.addEventListener('submit', saveLens);
    }
    
    const lensType = document.getElementById('lensType');
    if (lensType) {
        lensType.addEventListener('change', (e) => handleLensTypeChange(e.target.value));
    }
    
    // Close modal on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

async function loadLenses() {
    try {
        console.log('Loading lenses...');
        const response = await fetch('/api/lenses/all');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        currentLenses = await response.json();
        console.log(`Loaded ${currentLenses.length} lenses`);
        renderLenses(currentLenses);
    } catch (error) {
        console.error('Error loading lenses:', error);
        showNotification('Failed to load lenses. Check if server is running.', 'error');
        document.getElementById('lensGrid').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle fa-3x"></i>
                <p>Failed to load lenses</p>
                <p>Make sure the server is running and try again.</p>
            </div>
        `;
    }
}

function renderLenses(lenses) {
    const grid = document.getElementById('lensGrid');
    if (!grid) return;
    
    if (lenses.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-camera fa-3x"></i>
                <p>No lenses in your catalog yet</p>
                <p>Click "Add New Lens" to get started</p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = lenses.map(lens => `
        <div class="lens-catalog-card" data-lens-id="${lens.id}">
            <div class="lens-card-image">
                ${lens.imageUrl ? 
                    `<img src="${lens.imageUrl}" alt="${escapeHtml(lens.name)}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'200\\' height=\\'200\\'%3E%3Crect width=\\'100%25\\' height=\\'100%25\\' fill=\\'%23f0f4ff\\'/%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\' dy=\\'.3em\\' fill=\\'%23667eea\\'%3E📷%3C/text%3E%3C/svg%3E'">` : 
                    `<div class="no-image">
                        <i class="fas fa-camera fa-3x"></i>
                        <p>No photo</p>
                    </div>`
                }
            </div>
            <div class="lens-card-info">
                <div class="lens-card-title">${escapeHtml(lens.name)}</div>
                <div class="lens-card-specs">
                    <span><i class="fas fa-ruler"></i> ${escapeHtml(lens.focalLength)}</span>
                    <span><i class="fas fa-circle"></i> ${escapeHtml(lens.aperture)}</span>
                    <span class="status-badge ${lens.isActive !== false ? 'status-active' : 'status-inactive'}">
                        ${lens.isActive !== false ? 'Active' : 'Inactive'}
                    </span>
                </div>
                <div class="lens-card-specs">
                    <small>${escapeHtml(lens.maker)}</small>
                    ${lens.isManual ? '<small><i class="fas fa-cogs"></i> Manual</small>' : ''}
                </div>
                ${lens.description ? `<div class="lens-description">${escapeHtml(lens.description)}</div>` : ''}
                <div class="lens-card-actions">
                    <button class="btn btn-secondary" onclick="editLens('${lens.id}')">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn btn-danger" onclick="deleteLens('${lens.id}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function filterLenses(searchTerm) {
    if (!searchTerm) {
        renderLenses(currentLenses);
        return;
    }
    
    const filtered = currentLenses.filter(lens => 
        lens.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lens.maker.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lens.focalLength.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (lens.description && lens.description.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    renderLenses(filtered);
}

// Global functions for HTML buttons
window.openLensModal = function(lens = null) {
    const modal = document.getElementById('lensModal');
    const title = document.getElementById('modalTitle');
    
    if (!modal) return;
    
    if (lens) {
        title.textContent = 'Edit Lens';
        editingLensId = lens.id;
        populateForm(lens);
    } else {
        title.textContent = 'Add New Lens';
        editingLensId = null;
        document.getElementById('lensForm').reset();
        document.getElementById('imagePreview').innerHTML = '';
        document.getElementById('isActive').checked = true;
        document.getElementById('lensType').value = 'prime';
        handleLensTypeChange('prime');
    }
    
    modal.style.display = 'flex';
};

window.closeModal = function() {
    const modal = document.getElementById('lensModal');
    if (modal) modal.style.display = 'none';
    editingLensId = null;
};

window.editLens = async function(lensId) {
    try {
        const response = await fetch(`/api/lenses/${lensId}`);
        if (!response.ok) throw new Error('Failed to load lens');
        const lens = await response.json();
        openLensModal(lens);
    } catch (error) {
        console.error('Error loading lens:', error);
        showNotification('Failed to load lens details', 'error');
    }
};

window.deleteLens = async function(lensId) {
    const lens = currentLenses.find(l => l.id === lensId);
    if (!lens) return;
    
    if (!confirm(`Are you sure you want to delete "${lens.name}"?\n\nThis action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/lenses/${lensId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('Lens deleted successfully', 'success');
            await loadLenses();
        } else {
            throw new Error(result.error || 'Delete failed');
        }
    } catch (error) {
        console.error('Error deleting lens:', error);
        showNotification(`Failed to delete lens: ${error.message}`, 'error');
    }
};

async function saveLens(event) {
    if (event) event.preventDefault();
    
    const formData = new FormData();
    
    const lensData = {
        name: document.getElementById('lensName')?.value || '',
        maker: document.getElementById('lensMaker')?.value || '',
        type: document.getElementById('lensType')?.value || 'prime',
        aperture: document.getElementById('lensAperture')?.value || '',
        focalLength: document.getElementById('focalLengthDisplay')?.value || '',
        fixedFocalLength: parseFloat(document.getElementById('fixedFocalLength')?.value) || null,
        minFocalLength: parseFloat(document.getElementById('minFocalLength')?.value) || null,
        maxFocalLength: parseFloat(document.getElementById('maxFocalLength')?.value) || null,
        minAperture: parseFloat(document.getElementById('minAperture')?.value) || null,
        exifLensID: document.getElementById('exifLensID')?.value || '',
        exifLensModel: document.getElementById('exifLensModel')?.value || '',
        description: document.getElementById('lensDescription')?.value || '',
        isManual: document.getElementById('isManual')?.checked || false,
        isActive: document.getElementById('isActive')?.checked !== false
    };
    
    // Validate required fields
    if (!lensData.name || !lensData.maker || !lensData.exifLensID || !lensData.exifLensModel) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }
    
    // Append lens data as JSON string
    formData.append('lensData', JSON.stringify(lensData));
    
    // Append image if selected
    const imageFile = document.getElementById('lensImage')?.files[0];
    if (imageFile) {
        formData.append('lensImage', imageFile);
        console.log('Appending image file:', imageFile.name);
    }
    
    try {
        let response;
        if (editingLensId) {
            response = await fetch(`/api/lenses/${editingLensId}`, {
                method: 'PUT',
                body: formData  // Don't set Content-Type header, let browser set it with boundary
            });
        } else {
            response = await fetch('/api/lenses', {
                method: 'POST',
                body: formData  // Don't set Content-Type header
            });
        }
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(editingLensId ? 'Lens updated!' : 'Lens added!', 'success');
            closeModal();
            await loadLenses();
        } else {
            throw new Error(result.error || 'Save failed');
        }
    } catch (error) {
        console.error('Error saving lens:', error);
        showNotification(`Failed to save lens: ${error.message}`, 'error');
    }
}
function handleLensTypeChange(type) {
    const fixedGroup = document.getElementById('fixedFocalGroup');
    const zoomGroup = document.getElementById('zoomFocalGroup');
    
    if (type === 'prime') {
        if (fixedGroup) fixedGroup.style.display = 'block';
        if (zoomGroup) zoomGroup.style.display = 'none';
    } else {
        if (fixedGroup) fixedGroup.style.display = 'none';
        if (zoomGroup) zoomGroup.style.display = 'block';
    }
}

function populateForm(lens) {
    document.getElementById('lensName').value = lens.name || '';
    document.getElementById('lensMaker').value = lens.maker || '';
    document.getElementById('lensType').value = lens.type || 'prime';
    document.getElementById('lensAperture').value = lens.aperture || '';
    document.getElementById('focalLengthDisplay').value = lens.focalLength || '';
    document.getElementById('fixedFocalLength').value = lens.fixedFocalLength || '';
    document.getElementById('minFocalLength').value = lens.minFocalLength || '';
    document.getElementById('maxFocalLength').value = lens.maxFocalLength || '';
    document.getElementById('minAperture').value = lens.minAperture || '';
    document.getElementById('exifLensID').value = lens.exifLensID || '';
    document.getElementById('exifLensModel').value = lens.exifLensModel || '';
    document.getElementById('lensDescription').value = lens.description || '';
    document.getElementById('isManual').checked = lens.isManual || false;
    document.getElementById('isActive').checked = lens.isActive !== false;
    
    handleLensTypeChange(lens.type || 'prime');
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 15px 25px;
        background: ${type === 'success' ? '#27ae60' : '#e74c3c'};
        color: white;
        border-radius: 8px;
        z-index: 1001;
        animation: slideIn 0.3s ease;
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}