// State
let selectedPhotosForPost = [];
let allPhotos = [];
let allVideos = [];
let previewMedia = []; // Photos and videos in the preview (each item has { type: 'photo'|'video', filename, url })
let currentPostTopic = ''; // Store current topic for regeneration
let currentLibraryView = 'photos'; // 'photos' or 'videos'
let currentModalView = 'photos'; // 'photos' or 'videos' for modal

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

// Toggle auto-prompt for photo
document.getElementById('auto-prompt-photo').addEventListener('change', function() {
    const manualContainer = document.getElementById('manual-prompt-photo-container');
    manualContainer.style.display = this.checked ? 'none' : 'block';
});

// Toggle auto-prompt for video
document.getElementById('auto-prompt-video').addEventListener('change', function() {
    const manualContainer = document.getElementById('manual-prompt-video-container');
    manualContainer.style.display = this.checked ? 'none' : 'block';
});

// Toggle media type sections
document.getElementById('include-photo').addEventListener('change', function() {
    const photoSection = document.getElementById('photo-settings-section');
    photoSection.style.display = this.checked ? 'block' : 'none';
});

document.getElementById('include-video').addEventListener('change', function() {
    const videoSection = document.getElementById('video-settings-section');
    videoSection.style.display = this.checked ? 'block' : 'none';
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
    const includePhoto = document.getElementById('include-photo').checked;
    const includeVideo = document.getElementById('include-video').checked;
    
    if (!topic) {
        showStatus(document.getElementById('create-post-status'), 'Введите тему для поста', 'error');
        return;
    }
    
    if (!includePhoto && !includeVideo) {
        showStatus(document.getElementById('create-post-status'), 'Выберите минимум один тип медиа: фото или видео', 'error');
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
        
        const generatedMedia = [];
        
        // Step 2: Generate photo if selected
        if (includePhoto) {
            showStatus(statusDiv, '🎨 Подготовка фото...', 'loading');
            let photoPrompt;
            
            if (document.getElementById('auto-prompt-photo').checked) {
                photoPrompt = await generateAutoPrompt(topic);
            } else {
                photoPrompt = document.getElementById('manual-photo-prompt').value.trim();
                if (!photoPrompt) {
                    showStatus(statusDiv, 'Введите промпт для фото', 'error');
                    btn.disabled = false;
                    btn.textContent = '🚀 Создать Пост';
                    return;
                }
            }
            
            showStatus(statusDiv, '🖼️ Генерация фото...', 'loading');
            const photoData = await generatePostPhoto(photoPrompt);
            generatedMedia.push({ type: 'photo', ...photoData });
        }
        
        // Step 3: Generate video if selected
        if (includeVideo) {
            showStatus(statusDiv, '🎬 Подготовка видео...', 'loading');
            let videoPrompt;
            
            if (document.getElementById('auto-prompt-video').checked) {
                videoPrompt = await generateVideoPrompt(topic);
            } else {
                videoPrompt = document.getElementById('manual-video-prompt').value.trim();
                if (!videoPrompt) {
                    showStatus(statusDiv, 'Введите промпт для видео', 'error');
                    btn.disabled = false;
                    btn.textContent = '🚀 Создать Пост';
                    return;
                }
            }
            
            showStatus(statusDiv, '🎥 Генерация видео (это может занять 1-2 минуты)...', 'loading');
            const videoData = await generatePostVideo(videoPrompt);
            generatedMedia.push({ type: 'video', ...videoData });
        }
        
        // Step 4: Show preview
        showStatus(statusDiv, '✅ Пост готов! Проверьте предпросмотр ниже', 'success');
        showPreview(postText, generatedMedia);
        
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

// Generate auto prompt for photo
async function generateAutoPrompt(topic) {
    const response = await fetch('/api/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
    });
    
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Ошибка генерации промпта фото');
    return data.prompt;
}

// Generate auto prompt for video
async function generateVideoPrompt(topic) {
    const response = await fetch('/api/generate-video-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
    });
    
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Ошибка генерации промпта видео');
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

// Generate video for post
async function generatePostVideo(prompt) {
    const ratio = document.getElementById('create-video-ratio').value;
    const duration = document.getElementById('create-video-duration').value;
    const seed = document.getElementById('create-video-seed').value;
    
    const response = await fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt,
            aspect_ratio: ratio,
            duration,
            seed: seed || null
        })
    });
    
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Ошибка генерации видео');
    return { filename: data.filename, url: data.url };
}

// Show preview section
function showPreview(text, media) {
    previewMedia = media;
    
    // Update preview displays
    document.getElementById('preview-caption').value = text;
    document.getElementById('preview-caption-display').textContent = text;
    
    updatePreviewMediaDisplay();
    updateCaptionCharCount(); // Update character count
    
    // Show preview section
    document.getElementById('post-preview-section').style.display = 'block';
    
    // Scroll to preview
    document.getElementById('post-preview-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Update preview media display
function updatePreviewMediaDisplay() {
    const displayContainer = document.getElementById('preview-photos-display');
    const managementContainer = document.getElementById('preview-media-container');
    
    // Update display
    displayContainer.innerHTML = previewMedia.map(item => {
        if (item.type === 'video') {
            return `
                <div class="preview-photo-item">
                    <video src="${item.url}" controls autoplay loop muted style="width: 100%; height: 100%; object-fit: cover;"></video>
                </div>
            `;
        } else {
            return `
                <div class="preview-photo-item">
                    <img src="${item.url}" alt="Preview">
                </div>
            `;
        }
    }).join('');
    
    // Update management (with remove buttons)
    managementContainer.innerHTML = previewMedia.map((item, index) => {
        const icon = item.type === 'video' ? '🎬' : '📸';
        const mediaElement = item.type === 'video' 
            ? `<video src="${item.url}" style="width: 100%; height: 100%; object-fit: cover;"></video>`
            : `<img src="${item.url}" alt="${item.filename}">`;
        
        return `
            <div class="selected-photo" draggable="true" data-index="${index}">
                ${mediaElement}
                <span class="photo-order">${index + 1} ${icon}</span>
                <button class="remove-photo" onclick="removePreviewMedia(${index})">&times;</button>
            </div>
        `;
    }).join('');
    
    addPreviewMediaDragAndDrop();
}

// Remove media from preview
function removePreviewMedia(index) {
    previewMedia.splice(index, 1);
    updatePreviewMediaDisplay();
}

// Drag and drop for preview media
function addPreviewMediaDragAndDrop() {
    const items = document.querySelectorAll('#preview-media-container .selected-photo');
    let draggedElement = null;
    
    items.forEach(item => {
        item.addEventListener('dragstart', function() {
            draggedElement = this;
            this.style.opacity = '0.5';
        });
        
        item.addEventListener('dragend', function() {
            this.style.opacity = '1';
        });
        
        item.addEventListener('dragover', function(e) {
            e.preventDefault();
        });
        
        item.addEventListener('drop', function() {
            if (draggedElement !== this) {
                const draggedIndex = parseInt(draggedElement.dataset.index);
                const targetIndex = parseInt(this.dataset.index);
                
                const temp = previewMedia[draggedIndex];
                previewMedia[draggedIndex] = previewMedia[targetIndex];
                previewMedia[targetIndex] = temp;
                
                updatePreviewMediaDisplay();
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
        
        if (document.getElementById('auto-prompt-photo').checked) {
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
        previewMedia.push({ type: 'photo', ...photoData });
        updatePreviewMediaDisplay();
    } catch (error) {
        alert('Ошибка: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '➕ Создать еще фото';
    }
});

// Generate another video
document.getElementById('generate-another-video-btn').addEventListener('click', async () => {
    if (!currentPostTopic) {
        alert('Тема поста не найдена');
        return;
    }
    
    const btn = document.getElementById('generate-another-video-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Генерация...';
    
    try {
        let videoPrompt;
        
        if (document.getElementById('auto-prompt-video').checked) {
            videoPrompt = await generateVideoPrompt(currentPostTopic);
        } else {
            videoPrompt = document.getElementById('manual-video-prompt').value.trim();
            if (!videoPrompt) {
                alert('Введите промпт для видео');
                btn.disabled = false;
                btn.textContent = '➕ Создать еще видео';
                return;
            }
        }
        
        const videoData = await generatePostVideo(videoPrompt);
        previewMedia.push({ type: 'video', ...videoData });
        updatePreviewMediaDisplay();
    } catch (error) {
        alert('Ошибка: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '➕ Создать еще видео';
    }
});

// Add from library
document.getElementById('add-from-library-btn').addEventListener('click', () => {
    showMediaSelectionModal();
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
    const photoFilenames = previewMedia.filter(m => m.type === 'photo').map(m => m.filename);
    const videoFilenames = previewMedia.filter(m => m.type === 'video').map(m => m.filename);
    
    if (photoFilenames.length === 0 && videoFilenames.length === 0) {
        showStatus(document.getElementById('preview-publish-status'), 'Добавьте хотя бы одно фото или видео', 'error');
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
                photos: photoFilenames,
                videos: videoFilenames
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
    previewMedia = [];
    currentPostTopic = '';
    
    document.getElementById('publish-final-btn').disabled = false;
    document.getElementById('publish-final-btn').textContent = '📤 Опубликовать Пост';
}

// ==================== OLD PAGES (REMOVED) ====================
// Photo generation, text generation, and publish pages have been combined into unified post creation

// ==================== LIBRARY ====================

async function loadLibrary() {
    // Load both photos and videos
    await Promise.all([loadPhotos(), loadVideos()]);
    showLibraryPhotos(); // Default to photos
}

async function loadPhotos() {
    try {
        const response = await fetch('/api/photos');
        const data = await response.json();
        
        if (data.success) {
            allPhotos = data.photos;
            console.log('Загружено фотографий:', data.photos.length);
        }
    } catch (error) {
        console.error('Error loading photos:', error);
    }
}

async function loadVideos() {
    try {
        const response = await fetch('/api/videos');
        const data = await response.json();
        
        if (data.success) {
            allVideos = data.videos;
            console.log('Загружено видео:', data.videos.length);
        }
    } catch (error) {
        console.error('Error loading videos:', error);
    }
}

function showLibraryPhotos() {
    currentLibraryView = 'photos';
    displayLibraryMedia(allPhotos, 'photo');
}

function showLibraryVideos() {
    currentLibraryView = 'videos';
    displayLibraryMedia(allVideos, 'video');
}

function displayLibraryMedia(items, type) {
    const grid = document.getElementById('library-grid');
    
    if (items.length === 0) {
        const mediaType = type === 'video' ? 'видео' : 'фото';
        grid.innerHTML = `<p style="color: var(--text-secondary);">Библиотека ${mediaType} пуста. Сгенерируйте ${mediaType} на странице "Генерация Поста"</p>`;
        return;
    }
    
    grid.innerHTML = items.map((item, index) => {
        const mediaElement = type === 'video'
            ? `<video src="${item.url}" style="width: 100%; height: 100%; object-fit: cover;"></video>`
            : `<img src="${item.url}" alt="${item.filename}">`;
        
        return `
            <div class="photo-item" data-media-index="${index}" data-media-type="${type}">
                ${mediaElement}
                <div class="photo-info">
                    <div>${formatTimestamp(item.timestamp)}</div>
                </div>
            </div>
        `;
    }).join('');
    
    // Добавляем обработчики событий
    const mediaItems = grid.querySelectorAll('.photo-item');
    mediaItems.forEach((item, index) => {
        item.addEventListener('click', () => {
            const mediaItem = items[index];
            const prompt = (mediaItem.prompt && mediaItem.prompt.trim()) ? mediaItem.prompt : 'Промпт недоступен';
            showMediaDetail(mediaItem.filename, prompt, mediaItem.timestamp || '', type);
        });
    });
}

function showMediaDetail(filename, prompt, timestamp, type) {
    const modal = document.getElementById('detail-modal');
    const imageElement = document.getElementById('detail-image');
    
    if (type === 'video') {
        // Replace img with video
        const videoElement = document.createElement('video');
        videoElement.src = `/api/videos/${filename}`;
        videoElement.controls = true;
        videoElement.autoplay = true;
        videoElement.loop = true;
        videoElement.style.cssText = 'max-width: 100%; max-height: 70vh;';
        imageElement.replaceWith(videoElement);
        videoElement.id = 'detail-image';
    } else {
        // Ensure it's an img element
        if (imageElement.tagName !== 'IMG') {
            const imgElement = document.createElement('img');
            imgElement.id = 'detail-image';
            imageElement.replaceWith(imgElement);
        }
        document.getElementById('detail-image').src = `/api/photos/${filename}`;
    }
    
    // Безопасное отображение промпта
    const promptElement = document.getElementById('detail-prompt');
    promptElement.innerHTML = '<strong>Промпт:</strong> ';
    const promptText = document.createElement('span');
    promptText.textContent = prompt;
    promptElement.appendChild(promptText);
    
    document.getElementById('detail-timestamp').innerHTML = `<strong>Создано:</strong> ${formatTimestamp(timestamp)}`;
    modal.classList.add('show');
}

// ==================== MEDIA SELECTION (UPDATED FOR PREVIEW) ====================

function showMediaSelectionModal() {
    currentModalView = 'photos';
    showModalPhotos();
    document.getElementById('photo-modal').classList.add('show');
}

function showModalPhotos() {
    currentModalView = 'photos';
    const grid = document.getElementById('modal-photo-grid');
    const previewFilenames = previewMedia.filter(m => m.type === 'photo').map(m => m.filename);
    
    grid.innerHTML = allPhotos.map(photo => `
        <div class="photo-item ${previewFilenames.includes(photo.filename) ? 'selected' : ''}" 
             data-filename="${photo.filename}"
             data-type="photo"
             onclick="toggleMediaSelection('${photo.filename}', '${photo.url}', 'photo')">
            <img src="${photo.url}" alt="${photo.filename}">
        </div>
    `).join('');
}

function showModalVideos() {
    currentModalView = 'videos';
    const grid = document.getElementById('modal-photo-grid');
    const previewFilenames = previewMedia.filter(m => m.type === 'video').map(m => m.filename);
    
    grid.innerHTML = allVideos.map(video => `
        <div class="photo-item ${previewFilenames.includes(video.filename) ? 'selected' : ''}" 
             data-filename="${video.filename}"
             data-type="video"
             onclick="toggleMediaSelection('${video.filename}', '${video.url}', 'video')">
            <video src="${video.url}" style="width: 100%; height: 100%; object-fit: cover;"></video>
        </div>
    `).join('');
}

function toggleMediaSelection(filename, url, type) {
    const index = previewMedia.findIndex(m => m.filename === filename && m.type === type);
    
    if (index > -1) {
        previewMedia.splice(index, 1);
    } else {
        previewMedia.push({ type, filename, url });
    }
    
    // Update visual selection
    const mediaItem = document.querySelector(`#modal-photo-grid .photo-item[data-filename="${filename}"][data-type="${type}"]`);
    if (mediaItem) {
        mediaItem.classList.toggle('selected');
    }
}

document.getElementById('confirm-selection-btn').addEventListener('click', () => {
    updatePreviewMediaDisplay();
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
    
    container.innerHTML = posts.map(post => {
        const photos = post.photos || [];
        const videos = post.videos || [];
        
        const mediaHTML = [
            ...photos.map(photo => `
                <div class="history-photo">
                    <img src="/api/photos/${photo}" alt="${photo}">
                </div>
            `),
            ...videos.map(video => `
                <div class="history-photo">
                    <video src="/api/videos/${video}" controls style="width: 100%; height: 100%; object-fit: cover;"></video>
                </div>
            `)
        ].join('');
        
        return `
            <div class="history-item">
                <div class="history-header">
                    <div class="history-date">${formatDateTime(post.timestamp)}</div>
                </div>
                <div class="history-caption">${escapeHtml(post.caption) || '<em>Без текста</em>'}</div>
                <div class="history-photos">
                    ${mediaHTML}
                </div>
            </div>
        `;
    }).join('');
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

// ==================== CONTENT PAGE ====================

// Update photo size for content page
function updateContentPhotoSize() {
    const preset = document.getElementById('content-photo-preset').value;
    const widthSelect = document.getElementById('content-photo-width');
    const heightSelect = document.getElementById('content-photo-height');
    
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

// Content page - Generate Photo
document.getElementById('content-generate-photo-btn').addEventListener('click', async () => {
    const prompt = document.getElementById('content-photo-prompt').value.trim();
    
    if (!prompt) {
        showStatus(document.getElementById('content-photo-status'), 'Введите промпт для изображения', 'error');
        return;
    }
    
    const btn = document.getElementById('content-generate-photo-btn');
    const statusDiv = document.getElementById('content-photo-status');
    const previewDiv = document.getElementById('content-photo-preview');
    const previewImg = document.getElementById('content-photo-preview-img');
    
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Генерация...';
    showStatus(statusDiv, '🎨 Создание изображения...', 'loading');
    previewDiv.style.display = 'none';
    
    try {
        const width = parseInt(document.getElementById('content-photo-width').value);
        const height = parseInt(document.getElementById('content-photo-height').value);
        const model = document.getElementById('content-photo-model').value;
        const seed = document.getElementById('content-photo-seed').value;
        
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
        
        if (data.success) {
            showStatus(statusDiv, '✅ Изображение создано и сохранено в библиотеке!', 'success');
            previewImg.src = data.url;
            previewDiv.style.display = 'block';
            
            // Обновляем библиотеку
            await loadPhotos();
        } else {
            showStatus(statusDiv, '❌ ' + (data.error || 'Ошибка генерации'), 'error');
        }
    } catch (error) {
        showStatus(statusDiv, '❌ ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '📸 Создать фото';
    }
});

// Content page - Generate Video
document.getElementById('content-generate-video-btn').addEventListener('click', async () => {
    const prompt = document.getElementById('content-video-prompt').value.trim();
    
    if (!prompt) {
        showStatus(document.getElementById('content-video-status'), 'Введите промпт для видео', 'error');
        return;
    }
    
    const btn = document.getElementById('content-generate-video-btn');
    const statusDiv = document.getElementById('content-video-status');
    const previewDiv = document.getElementById('content-video-preview');
    const previewVid = document.getElementById('content-video-preview-vid');
    
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Генерация...';
    showStatus(statusDiv, '🎥 Создание видео через Kling 2.1 Pro (это займет 1-2 минуты)...', 'loading');
    previewDiv.style.display = 'none';
    
    try {
        const ratio = document.getElementById('content-video-ratio').value;
        const duration = document.getElementById('content-video-duration').value;
        const seed = document.getElementById('content-video-seed').value;
        
        const response = await fetch('/api/generate-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                aspect_ratio: ratio,
                duration,
                seed: seed || null
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showStatus(statusDiv, '✅ Видео создано и сохранено в библиотеке!', 'success');
            previewVid.src = data.url;
            previewDiv.style.display = 'block';
            
            // Обновляем библиотеку
            await loadVideos();
        } else {
            showStatus(statusDiv, '❌ ' + (data.error || 'Ошибка генерации видео'), 'error');
        }
    } catch (error) {
        showStatus(statusDiv, '❌ ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '🎥 Создать видео';
    }
});

// Image to Video - State
let selectedI2VImage = null;

// I2V - Select Image Button
document.getElementById('i2v-select-image-btn').addEventListener('click', () => {
    showI2VImageModal();
});

// I2V - Remove Image Button
document.getElementById('i2v-remove-image-btn').addEventListener('click', () => {
    selectedI2VImage = null;
    document.getElementById('i2v-selected-image-display').style.display = 'none';
    document.getElementById('i2v-select-image-btn').style.display = 'inline-block';
});

// Show I2V Image Selection Modal
function showI2VImageModal() {
    const modal = document.getElementById('i2v-image-modal');
    const grid = document.getElementById('i2v-image-grid');
    
    // Отображаем все фото
    grid.innerHTML = allPhotos.map(photo => `
        <div class="photo-item ${selectedI2VImage && selectedI2VImage.filename === photo.filename ? 'selected' : ''}" 
             data-filename="${photo.filename}"
             onclick="selectI2VImage('${photo.filename}', '${photo.url}')">
            <img src="${photo.url}" alt="${photo.filename}">
        </div>
    `).join('');
    
    modal.classList.add('show');
}

// Select image for I2V
function selectI2VImage(filename, url) {
    selectedI2VImage = { filename, url };
    
    // Update visual selection in modal
    document.querySelectorAll('#i2v-image-grid .photo-item').forEach(item => {
        item.classList.remove('selected');
        if (item.dataset.filename === filename) {
            item.classList.add('selected');
        }
    });
}

// Confirm I2V Image Selection
document.getElementById('i2v-confirm-image-btn').addEventListener('click', () => {
    if (selectedI2VImage) {
        document.getElementById('i2v-selected-image-preview').src = selectedI2VImage.url;
        document.getElementById('i2v-selected-image-display').style.display = 'block';
        document.getElementById('i2v-select-image-btn').style.display = 'none';
    }
    document.getElementById('i2v-image-modal').classList.remove('show');
});

// I2V - Generate Video from Image
document.getElementById('i2v-generate-btn').addEventListener('click', async () => {
    if (!selectedI2VImage) {
        showStatus(document.getElementById('i2v-status'), 'Выберите изображение из библиотеки', 'error');
        return;
    }
    
    const prompt = document.getElementById('i2v-prompt').value.trim();
    
    if (!prompt) {
        showStatus(document.getElementById('i2v-status'), 'Введите промпт для движения', 'error');
        return;
    }
    
    const btn = document.getElementById('i2v-generate-btn');
    const statusDiv = document.getElementById('i2v-status');
    const previewDiv = document.getElementById('i2v-preview');
    const previewVid = document.getElementById('i2v-preview-vid');
    
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Генерация...';
    showStatus(statusDiv, '🎬 Создание видео из изображения через Kling 2.1 Pro (это займет 1-2 минуты)...', 'loading');
    previewDiv.style.display = 'none';
    
    try {
        const ratio = document.getElementById('i2v-ratio').value;
        const duration = document.getElementById('i2v-duration').value;
        const seed = document.getElementById('i2v-seed').value;
        
        const response = await fetch('/api/generate-image-to-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_filename: selectedI2VImage.filename,
                prompt,
                aspect_ratio: ratio,
                duration,
                seed: seed || null
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showStatus(statusDiv, '✅ Видео создано из изображения и сохранено в библиотеке!', 'success');
            previewVid.src = data.url;
            previewDiv.style.display = 'block';
            
            // Обновляем библиотеку
            await loadVideos();
        } else {
            showStatus(statusDiv, '❌ ' + (data.error || 'Ошибка генерации видео'), 'error');
        }
    } catch (error) {
        showStatus(statusDiv, '❌ ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '🎬 Создать видео из изображения';
    }
});

// ==================== UPLOAD PHOTO FUNCTIONALITY ====================

let selectedFileForUpload = null;

// Open upload modal
document.getElementById('upload-photo-btn').addEventListener('click', () => {
    document.getElementById('upload-photo-modal').classList.add('show');
    // Reset form
    document.getElementById('photo-file-input').value = '';
    document.getElementById('selected-file-name').textContent = '';
    document.getElementById('upload-preview-container').style.display = 'none';
    document.getElementById('upload-photo-status').textContent = '';
    document.getElementById('upload-photo-status').className = 'status-message';
    document.getElementById('upload-photo-confirm-btn').disabled = true;
    selectedFileForUpload = null;
});

// Handle file selection
document.getElementById('photo-file-input').addEventListener('change', function(e) {
    const file = e.target.files[0];
    
    if (!file) {
        document.getElementById('selected-file-name').textContent = '';
        document.getElementById('upload-preview-container').style.display = 'none';
        document.getElementById('upload-photo-confirm-btn').disabled = true;
        selectedFileForUpload = null;
        return;
    }
    
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
        showStatus(document.getElementById('upload-photo-status'), '❌ Только JPG/JPEG файлы разрешены', 'error');
        document.getElementById('photo-file-input').value = '';
        document.getElementById('upload-photo-confirm-btn').disabled = true;
        selectedFileForUpload = null;
        return;
    }
    
    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxSize) {
        showStatus(document.getElementById('upload-photo-status'), '❌ Размер файла не должен превышать 5MB', 'error');
        document.getElementById('photo-file-input').value = '';
        document.getElementById('upload-photo-confirm-btn').disabled = true;
        selectedFileForUpload = null;
        return;
    }
    
    selectedFileForUpload = file;
    
    // Show file name
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
    document.getElementById('selected-file-name').textContent = `Выбран файл: ${file.name} (${fileSizeMB} MB)`;
    
    // Show preview
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('upload-preview-img').src = e.target.result;
        document.getElementById('upload-preview-container').style.display = 'block';
    };
    reader.readAsDataURL(file);
    
    // Enable upload button
    document.getElementById('upload-photo-confirm-btn').disabled = false;
    
    // Clear any previous error messages
    document.getElementById('upload-photo-status').textContent = '';
    document.getElementById('upload-photo-status').className = 'status-message';
});

// Upload photo
document.getElementById('upload-photo-confirm-btn').addEventListener('click', async () => {
    if (!selectedFileForUpload) {
        showStatus(document.getElementById('upload-photo-status'), 'Выберите файл', 'error');
        return;
    }
    
    const btn = document.getElementById('upload-photo-confirm-btn');
    const statusDiv = document.getElementById('upload-photo-status');
    
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Загрузка...';
    showStatus(statusDiv, '📤 Загрузка фото...', 'loading');
    
    try {
        const formData = new FormData();
        formData.append('photo', selectedFileForUpload);
        
        const response = await fetch('/api/upload-photo', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            showStatus(statusDiv, '✅ Фото успешно загружено в библиотеку!', 'success');
            
            // Reload photos in library
            await loadPhotos();
            
            // Close modal after 2 seconds
            setTimeout(() => {
                document.getElementById('upload-photo-modal').classList.remove('show');
                
                // Switch to photos view in library if not already there
                if (currentLibraryView !== 'photos') {
                    showLibraryPhotos();
                }
            }, 2000);
        } else {
            showStatus(statusDiv, '❌ ' + (data.error || 'Ошибка загрузки'), 'error');
            btn.disabled = false;
            btn.textContent = '📤 Загрузить в библиотеку';
        }
    } catch (error) {
        showStatus(statusDiv, '❌ Ошибка подключения к серверу', 'error');
        btn.disabled = false;
        btn.textContent = '📤 Загрузить в библиотеку';
    }
});


