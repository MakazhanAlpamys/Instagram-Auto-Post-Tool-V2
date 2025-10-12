// State
let selectedPhotosForPost = [];
let allPhotos = [];
let previewPhotos = []; // Photos in the preview
let currentPostTopic = ''; // Store current topic for regeneration

// Check Instagram login status on load
window.addEventListener('DOMContentLoaded', async () => {
    // Показываем загрузку
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');
    
    const status = await checkInstagramStatus();
    if (status.logged_in) {
        showMainApp(status.username);
    } else {
        // Показываем экран входа, если не залогинен
        loginScreen.classList.add('active');
    }
});

// ==================== AUTH ====================

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('login-error');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    errorDiv.classList.remove('show');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading"></span> Вход...';
    
    try {
        const response = await fetch('/api/instagram/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMainApp(username);
        } else {
            errorDiv.textContent = data.error || 'Ошибка входа';
            errorDiv.classList.add('show');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Войти';
        }
    } catch (error) {
        errorDiv.textContent = 'Ошибка подключения к серверу';
        errorDiv.classList.add('show');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Войти';
    }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    if (confirm('Вы уверены, что хотите выйти?')) {
        await fetch('/api/instagram/logout', { method: 'POST' });
        showLoginScreen();
    }
});

async function checkInstagramStatus() {
    try {
        const response = await fetch('/api/instagram/status');
        return await response.json();
    } catch (error) {
        return { logged_in: false };
    }
}

function showMainApp(username) {
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('main-app').classList.add('active');
    document.getElementById('username-display').textContent = `@${username}`;
    
    // Обновляем статус подключения
    const statusElement = document.getElementById('connection-status');
    statusElement.textContent = '● Подключено';
    statusElement.style.color = '#22c55e';
    
    loadLibrary();
}

function updateConnectionStatus(connected, username = '') {
    const statusElement = document.getElementById('connection-status');
    if (connected) {
        statusElement.textContent = '● Подключено';
        statusElement.style.color = '#22c55e';
        if (username) {
            document.getElementById('username-display').textContent = `@${username}`;
        }
    } else {
        statusElement.textContent = '● Не подключено';
        statusElement.style.color = '#ef4444';
    }
}

function showLoginScreen() {
    document.getElementById('main-app').classList.remove('active');
    document.getElementById('login-screen').classList.add('active');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
}

// ==================== NAVIGATION ====================

document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        showPage(page);
    });
});

function showPage(pageName) {
    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.dataset.page === pageName) {
            link.classList.add('active');
        }
    });
    
    // Update pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(`page-${pageName}`).classList.add('active');
    
    // Load data for specific pages
    if (pageName === 'library') {
        loadLibrary();
    } else if (pageName === 'history') {
        loadHistory();
    }
}

// ==================== UNIFIED POST CREATION ====================

// Toggle auto-prompt
document.getElementById('auto-prompt').addEventListener('change', function() {
    const manualContainer = document.getElementById('manual-prompt-container');
    manualContainer.style.display = this.checked ? 'none' : 'block';
});

// Update photo size for create post
function updateCreatePhotoSize() {
    const preset = document.getElementById('create-photo-preset').value;
    const widthSelect = document.getElementById('create-photo-width');
    const heightSelect = document.getElementById('create-photo-height');
    
    const presets = {
        'square': { width: 1024, height: 1024 },
        'portrait': { width: 1024, height: 1280 },
        'story': { width: 1080, height: 1920 },
        'landscape': { width: 1920, height: 1080 }
    };
    
    if (preset !== 'custom' && presets[preset]) {
        widthSelect.value = presets[preset].width;
        heightSelect.value = presets[preset].height;
        
        if (!widthSelect.value) widthSelect.value = '1024';
        if (!heightSelect.value) heightSelect.value = preset === 'story' ? '1920' : '1024';
    }
}

// Main post generation button
document.getElementById('generate-post-btn').addEventListener('click', async () => {
    const topic = document.getElementById('post-topic').value.trim();
    
    if (!topic) {
        showStatus(document.getElementById('create-post-status'), 'Введите тему для поста', 'error');
        return;
    }
    
    currentPostTopic = topic;
    const btn = document.getElementById('generate-post-btn');
    const statusDiv = document.getElementById('create-post-status');
    
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Создание поста...';
    
    try {
        // Step 1: Generate text
        showStatus(statusDiv, '📝 Генерация текста...', 'loading');
        const postText = await generatePostText(topic);
        
        // Step 2: Generate or get photo prompt
        showStatus(statusDiv, '🎨 Подготовка изображения...', 'loading');
        let photoPrompt;
        
        if (document.getElementById('auto-prompt').checked) {
            photoPrompt = await generateAutoPrompt(topic);
        } else {
            photoPrompt = document.getElementById('manual-photo-prompt').value.trim();
            if (!photoPrompt) {
                showStatus(statusDiv, 'Введите промпт для изображения', 'error');
                btn.disabled = false;
                btn.textContent = '🚀 Создать Пост';
                return;
            }
        }
        
        // Step 3: Generate photo
        showStatus(statusDiv, '🖼️ Генерация изображения...', 'loading');
        const photoData = await generatePostPhoto(photoPrompt);
        
        // Step 4: Show preview
        showStatus(statusDiv, '✅ Пост готов! Проверьте предпросмотр ниже', 'success');
        showPreview(postText, [photoData]);
        
    } catch (error) {
        showStatus(statusDiv, '❌ ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Создать Пост';
    }
});

// Generate post text
async function generatePostText(topic) {
    const postSize = document.getElementById('create-post-size').value;
    const addHashtags = document.getElementById('create-add-hashtags').checked;
    const hashtagCount = parseInt(document.getElementById('create-hashtag-count').value);
    
    const response = await fetch('/api/generate-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt: topic,
            post_size: postSize,
            add_hashtags: addHashtags,
            hashtag_count: hashtagCount
        })
    });
    
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Ошибка генерации текста');
    return data.text;
}

// Generate auto prompt
async function generateAutoPrompt(topic) {
    const response = await fetch('/api/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
    });
    
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Ошибка генерации промпта');
    return data.prompt;
}

// Generate photo for post
async function generatePostPhoto(prompt) {
    const width = parseInt(document.getElementById('create-photo-width').value);
    const height = parseInt(document.getElementById('create-photo-height').value);
    const model = document.getElementById('create-photo-model').value;
    const seed = document.getElementById('create-photo-seed').value;
    
    const response = await fetch('/api/generate-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt,
            width,
            height,
            model,
            seed: seed || null
        })
    });
    
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Ошибка генерации изображения');
    return { filename: data.filename, url: data.url };
}

// Show preview section
function showPreview(text, photos) {
    previewPhotos = photos;
    
    // Update preview displays
    document.getElementById('preview-caption').value = text;
    document.getElementById('preview-caption-display').textContent = text;
    
    updatePreviewPhotosDisplay();
    updateCaptionCharCount(); // Update character count
    
    // Show preview section
    document.getElementById('post-preview-section').style.display = 'block';
    
    // Scroll to preview
    document.getElementById('post-preview-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Update preview photos display
function updatePreviewPhotosDisplay() {
    const displayContainer = document.getElementById('preview-photos-display');
    const managementContainer = document.getElementById('preview-photos-container');
    
    // Update display
    displayContainer.innerHTML = previewPhotos.map(photo => `
        <div class="preview-photo-item">
            <img src="${photo.url}" alt="Preview">
        </div>
    `).join('');
    
    // Update management (with remove buttons)
    managementContainer.innerHTML = previewPhotos.map((photo, index) => `
        <div class="selected-photo" draggable="true" data-index="${index}">
            <img src="${photo.url}" alt="${photo.filename}">
            <span class="photo-order">${index + 1}</span>
            <button class="remove-photo" onclick="removePreviewPhoto(${index})">&times;</button>
        </div>
    `).join('');
    
    addPreviewPhotoDragAndDrop();
}

// Remove photo from preview
function removePreviewPhoto(index) {
    previewPhotos.splice(index, 1);
    updatePreviewPhotosDisplay();
}

// Drag and drop for preview photos
function addPreviewPhotoDragAndDrop() {
    const photos = document.querySelectorAll('#preview-photos-container .selected-photo');
    let draggedElement = null;
    
    photos.forEach(photo => {
        photo.addEventListener('dragstart', function() {
            draggedElement = this;
            this.style.opacity = '0.5';
        });
        
        photo.addEventListener('dragend', function() {
            this.style.opacity = '1';
        });
        
        photo.addEventListener('dragover', function(e) {
            e.preventDefault();
        });
        
        photo.addEventListener('drop', function() {
            if (draggedElement !== this) {
                const draggedIndex = parseInt(draggedElement.dataset.index);
                const targetIndex = parseInt(this.dataset.index);
                
                const temp = previewPhotos[draggedIndex];
                previewPhotos[draggedIndex] = previewPhotos[targetIndex];
                previewPhotos[targetIndex] = temp;
                
                updatePreviewPhotosDisplay();
            }
        });
    });
}

// Toggle preview settings
document.getElementById('preview-settings-toggle').addEventListener('click', () => {
    const panel = document.getElementById('preview-settings-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

// Update caption display when editing
document.getElementById('preview-caption').addEventListener('input', function() {
    document.getElementById('preview-caption-display').textContent = this.value;
    updateCaptionCharCount();
});

// Update character count
function updateCaptionCharCount() {
    const caption = document.getElementById('preview-caption').value;
    const charCount = caption.length;
    const countElement = document.getElementById('caption-char-count');
    
    if (charCount > 2200) {
        countElement.textContent = `${charCount} / 2200 символов ⚠️ Превышен лимит на ${charCount - 2200}!`;
        countElement.style.color = 'var(--error)';
    } else if (charCount > 2000) {
        countElement.textContent = `${charCount} / 2200 символов (близко к лимиту)`;
        countElement.style.color = 'var(--tertiary)';
    } else {
        countElement.textContent = `${charCount} / 2200 символов`;
        countElement.style.color = 'var(--text-secondary)';
    }
}

// Regenerate text
document.getElementById('regenerate-text-btn').addEventListener('click', async () => {
    if (!currentPostTopic) {
        alert('Тема поста не найдена');
        return;
    }
    
    const btn = document.getElementById('regenerate-text-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Генерация...';
    
    try {
        const newText = await generatePostText(currentPostTopic);
        document.getElementById('preview-caption').value = newText;
        document.getElementById('preview-caption-display').textContent = newText;
        updateCaptionCharCount(); // Update character count
    } catch (error) {
        alert('Ошибка: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '🔄 Создать новый текст';
    }
});

// Generate another photo
document.getElementById('generate-another-photo-btn').addEventListener('click', async () => {
    if (!currentPostTopic) {
        alert('Тема поста не найдена');
        return;
    }
    
    const btn = document.getElementById('generate-another-photo-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Генерация...';
    
    try {
        let photoPrompt;
        
        if (document.getElementById('auto-prompt').checked) {
            photoPrompt = await generateAutoPrompt(currentPostTopic);
        } else {
            photoPrompt = document.getElementById('manual-photo-prompt').value.trim();
            if (!photoPrompt) {
                alert('Введите промпт для изображения');
                btn.disabled = false;
                btn.textContent = '➕ Создать еще фото';
                return;
            }
        }
        
        const photoData = await generatePostPhoto(photoPrompt);
        previewPhotos.push(photoData);
        updatePreviewPhotosDisplay();
    } catch (error) {
        alert('Ошибка: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '➕ Создать еще фото';
    }
});

// Add from library
document.getElementById('add-from-library-btn').addEventListener('click', () => {
    selectedPhotosForPost = previewPhotos.map(p => p.filename);
    showPhotoSelectionModal();
});

// Publish final post
document.getElementById('publish-final-btn').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.add('show');
});

// Confirmation modal handlers
document.getElementById('confirm-yes').addEventListener('click', async () => {
    document.getElementById('confirm-modal').classList.remove('show');
    await publishFinalPost();
});

document.getElementById('confirm-no').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.remove('show');
});

// Publish the final post
async function publishFinalPost() {
    const caption = document.getElementById('preview-caption').value.trim();
    const photoFilenames = previewPhotos.map(p => p.filename);
    
    if (photoFilenames.length === 0) {
        showStatus(document.getElementById('preview-publish-status'), 'Добавьте хотя бы одно фото', 'error');
        return;
    }
    
    // Проверка на лимит Instagram
    if (caption.length > 2200) {
        showStatus(document.getElementById('preview-publish-status'), `❌ Текст слишком длинный! Instagram лимит: 2200 символов. Ваш текст: ${caption.length} символов. Сократите текст на ${caption.length - 2200} символов.`, 'error');
        return;
    }
    
    const btn = document.getElementById('publish-final-btn');
    const statusDiv = document.getElementById('preview-publish-status');
    
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Публикация...';
    showStatus(statusDiv, 'Публикация поста в Instagram...', 'loading');
    
    try {
        const response = await fetch('/api/publish-post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                caption,
                photos: photoFilenames
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showStatus(statusDiv, '✅ Пост успешно опубликован в Instagram!', 'success');
            
            // Clear everything
            setTimeout(() => {
                resetPostCreation();
                showStatus(statusDiv, '', '');
            }, 3000);
        } else {
            if (response.status === 401) {
                showStatus(statusDiv, '❌ ' + (data.error || 'Сессия устарела. Обновите страницу.'), 'error');
                updateConnectionStatus(false);
            } else {
                showStatus(statusDiv, '❌ ' + (data.error || 'Ошибка публикации'), 'error');
            }
            btn.disabled = false;
            btn.textContent = '📤 Опубликовать Пост';
        }
    } catch (error) {
        showStatus(statusDiv, '❌ Ошибка подключения к серверу', 'error');
        btn.disabled = false;
        btn.textContent = '📤 Опубликовать Пост';
    }
}

// Reset post creation form
function resetPostCreation() {
    document.getElementById('post-topic').value = '';
    document.getElementById('preview-caption').value = '';
    document.getElementById('preview-caption-display').textContent = '';
    document.getElementById('post-preview-section').style.display = 'none';
    previewPhotos = [];
    currentPostTopic = '';
    
    document.getElementById('publish-final-btn').disabled = false;
    document.getElementById('publish-final-btn').textContent = '📤 Опубликовать Пост';
}

// ==================== OLD PAGES (REMOVED) ====================
// Photo generation, text generation, and publish pages have been combined into unified post creation

// ==================== LIBRARY ====================

async function loadLibrary() {
    try {
        const response = await fetch('/api/photos');
        const data = await response.json();
        
        if (data.success) {
            allPhotos = data.photos;
            displayLibrary(data.photos);
        }
    } catch (error) {
        console.error('Error loading library:', error);
    }
}

function displayLibrary(photos) {
    const grid = document.getElementById('library-grid');
    
    if (photos.length === 0) {
        grid.innerHTML = '<p style="color: var(--text-secondary);">Библиотека пуста. Сгенерируйте изображения на странице "Генерация фото"</p>';
        return;
    }
    
    grid.innerHTML = photos.map(photo => `
        <div class="photo-item" onclick='showPhotoDetail(${JSON.stringify(photo.filename)}, ${JSON.stringify(photo.prompt || 'Промпт недоступен')}, ${JSON.stringify(photo.timestamp || '')})'>
            <img src="${photo.url}" alt="${photo.filename}">
            <div class="photo-info">
                <div>${formatTimestamp(photo.timestamp)}</div>
            </div>
        </div>
    `).join('');
}

function showPhotoDetail(filename, prompt, timestamp) {
    const modal = document.getElementById('detail-modal');
    document.getElementById('detail-image').src = `/api/photos/${filename}`;
    document.getElementById('detail-prompt').innerHTML = `<strong>Промпт:</strong> ${prompt}`;
    document.getElementById('detail-timestamp').innerHTML = `<strong>Создано:</strong> ${formatTimestamp(timestamp)}`;
    modal.classList.add('show');
}

// ==================== PHOTO SELECTION (UPDATED FOR PREVIEW) ====================

function showPhotoSelectionModal() {
    const modal = document.getElementById('photo-modal');
    const grid = document.getElementById('modal-photo-grid');
    
    // Get already selected filenames from preview
    const previewFilenames = previewPhotos.map(p => p.filename);
    
    grid.innerHTML = allPhotos.map(photo => `
        <div class="photo-item ${previewFilenames.includes(photo.filename) ? 'selected' : ''}" 
             data-filename="${photo.filename}"
             onclick="togglePhotoSelectionForPreview('${photo.filename}', '${photo.url}')">
            <img src="${photo.url}" alt="${photo.filename}">
        </div>
    `).join('');
    
    modal.classList.add('show');
}

function togglePhotoSelectionForPreview(filename, url) {
    const index = previewPhotos.findIndex(p => p.filename === filename);
    
    if (index > -1) {
        previewPhotos.splice(index, 1);
    } else {
        previewPhotos.push({ filename, url });
    }
    
    // Update visual selection
    const photoItem = document.querySelector(`#modal-photo-grid .photo-item[data-filename="${filename}"]`);
    photoItem.classList.toggle('selected');
}

document.getElementById('confirm-selection-btn').addEventListener('click', () => {
    updatePreviewPhotosDisplay();
    document.getElementById('photo-modal').classList.remove('show');
});

// ==================== HISTORY ====================

async function loadHistory() {
    try {
        const response = await fetch('/api/posts/history');
        const data = await response.json();
        
        if (data.success) {
            displayHistory(data.posts);
        }
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

function displayHistory(posts) {
    const container = document.getElementById('history-list');
    
    if (posts.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary);">История постов пуста</p>';
        return;
    }
    
    container.innerHTML = posts.map(post => `
        <div class="history-item">
            <div class="history-header">
                <div class="history-date">${formatDateTime(post.timestamp)}</div>
            </div>
            <div class="history-caption">${escapeHtml(post.caption) || '<em>Без текста</em>'}</div>
            <div class="history-photos">
                ${post.photos.map(photo => `
                    <div class="history-photo">
                        <img src="/api/photos/${photo}" alt="${photo}">
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

// ==================== MODAL MANAGEMENT ====================

document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', function() {
        this.closest('.modal').classList.remove('show');
    });
});

document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', function(e) {
        if (e.target === this) {
            this.classList.remove('show');
        }
    });
});

// ==================== UTILITY FUNCTIONS ====================

function showStatus(element, message, type) {
    element.textContent = message;
    element.className = 'status-message show ' + type;
}

function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    const year = timestamp.substr(0, 4);
    const month = timestamp.substr(4, 2);
    const day = timestamp.substr(6, 2);
    const hour = timestamp.substr(9, 2);
    const minute = timestamp.substr(11, 2);
    return `${day}.${month}.${year} ${hour}:${minute}`;
}

function formatDateTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString('ru-RU');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


