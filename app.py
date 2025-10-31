from flask import Flask, render_template, request, jsonify, session, send_from_directory
from flask_cors import CORS
from instagrapi import Client
import google.generativeai as genai
import os
import json
import re
import requests
from datetime import datetime
import uuid
from pathlib import Path
import secrets
from dotenv import load_dotenv
from apscheduler.schedulers.background import BackgroundScheduler
import threading

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('SECRET_KEY', secrets.token_hex(32))
CORS(app)

# Создаем необходимые директории
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / 'data'
PHOTOS_DIR = DATA_DIR / 'photos'
VIDEOS_DIR = DATA_DIR / 'videos'
SESSION_DIR = DATA_DIR / 'session'
POSTS_DIR = DATA_DIR / 'posts'
SCHEDULED_DIR = DATA_DIR / 'scheduled'

for directory in [DATA_DIR, PHOTOS_DIR, VIDEOS_DIR, SESSION_DIR, POSTS_DIR, SCHEDULED_DIR]:
    directory.mkdir(exist_ok=True)

# Instagram клиент
ig_client = None
SESSION_FILE = SESSION_DIR / 'instagram_session.json'

# Gemini клиент
gemini_api_key = os.getenv('GEMINI_API_KEY')
if gemini_api_key:
    genai.configure(api_key=gemini_api_key)

# Segmind API key (for Kling AI)
segmind_api_key = os.getenv('SEGMIND_API_KEY')

# ==================== SCHEDULER SETUP ====================

# Создаем планировщик для автопубликации постов
scheduler = BackgroundScheduler()
scheduler_lock = threading.Lock()

def check_and_publish_scheduled_posts():
    """Проверяет и публикует запланированные посты"""
    global ig_client
    
    # Используем блокировку для предотвращения одновременного выполнения
    if not scheduler_lock.acquire(blocking=False):
        print("⏸️ Планировщик уже выполняется, пропускаем...")
        return
    
    try:
        now = datetime.now()
        
        # Получаем список всех файлов СНАЧАЛА, чтобы избежать изменений во время итерации
        scheduled_files = list(SCHEDULED_DIR.glob('*.json'))
        
        # Проходим по всем запланированным постам
        for scheduled_file in scheduled_files:
            # КРИТИЧНО: Проверяем существование файла перед обработкой
            if not scheduled_file.exists():
                continue
            
            # КРИТИЧНО: Сразу пытаемся удалить файл, чтобы другие процессы его не увидели
            # Это предотвращает дублирование публикации
            try:
                # Читаем и удаляем файл атомарно
                with open(scheduled_file, 'r', encoding='utf-8') as f:
                    post_data = json.load(f)
                
                # Сразу удаляем файл, чтобы другой процесс его не увидел
                scheduled_file.unlink()
                
            except FileNotFoundError:
                # Файл уже удалён другим процессом
                continue
            except Exception as e:
                print(f"❌ Ошибка чтения файла {scheduled_file.name}: {e}")
                continue
                
            try:
                # Проверяем, не был ли уже опубликован этот пост
                if post_data.get('status') == 'published':
                    print(f"⚠️ Пост {scheduled_file.name} уже был опубликован, пропускаем")
                    continue
                
                scheduled_time = datetime.fromisoformat(post_data['scheduled_time'])
                
                # Если время ещё не пришло, возвращаем файл обратно
                if now < scheduled_time:
                    with open(scheduled_file, 'w', encoding='utf-8') as f:
                        json.dump(post_data, f, ensure_ascii=False, indent=2)
                    continue
                
                # Время пришло - публикуем
                print(f"⏰ Публикация запланированного поста: {scheduled_file.name}")
                
                # Восстанавливаем сессию если нужно
                if not ig_client and SESSION_FILE.exists():
                    try:
                        ig_client = Client()
                        ig_client.load_settings(SESSION_FILE)
                    except Exception as e:
                        print(f"❌ Ошибка восстановления сессии для автопубликации: {e}")
                        # Возвращаем файл обратно, чтобы попробовать позже
                        with open(scheduled_file, 'w', encoding='utf-8') as f:
                            json.dump(post_data, f, ensure_ascii=False, indent=2)
                        continue
                
                if not ig_client:
                    print(f"❌ Нет активной сессии Instagram для публикации {scheduled_file.name}")
                    # Возвращаем файл обратно
                    with open(scheduled_file, 'w', encoding='utf-8') as f:
                        json.dump(post_data, f, ensure_ascii=False, indent=2)
                    continue
                
                # Публикуем пост
                caption = post_data['caption']
                photo_filenames = post_data.get('photos', [])
                video_filenames = post_data.get('videos', [])
                
                photo_paths = [str(PHOTOS_DIR / filename) for filename in photo_filenames]
                video_paths = [str(VIDEOS_DIR / filename) for filename in video_filenames]
                
                # Публикуем
                media = None
                if len(video_paths) == 1 and len(photo_paths) == 0:
                    media = ig_client.video_upload(video_paths[0], caption)
                elif len(photo_paths) == 1 and len(video_paths) == 0:
                    media = ig_client.photo_upload(photo_paths[0], caption)
                else:
                    all_paths = photo_paths + video_paths
                    media = ig_client.album_upload(all_paths, caption)
                
                # Обновляем статус и сохраняем в историю
                post_data['status'] = 'published'
                post_data['published_time'] = datetime.now().isoformat()
                post_data['id'] = media.pk
                
                # Сохраняем в историю
                history_file = POSTS_DIR / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
                with open(history_file, 'w', encoding='utf-8') as f:
                    json.dump(post_data, f, ensure_ascii=False, indent=2)
                
                print(f"✅ Пост успешно опубликован автоматически: {media.pk}")
                
            except Exception as e:
                print(f"❌ Ошибка при автопубликации поста {scheduled_file.name}: {e}")
                # В случае ошибки возвращаем файл обратно
                try:
                    with open(scheduled_file, 'w', encoding='utf-8') as f:
                        json.dump(post_data, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass
                continue
                
    except Exception as e:
        print(f"❌ Ошибка в планировщике: {e}")
    finally:
        # Освобождаем блокировку
        scheduler_lock.release()

# Запускаем планировщик (проверка каждую минуту)
scheduler.add_job(check_and_publish_scheduled_posts, 'interval', minutes=1, id='check_scheduled')
scheduler.start()

print("✅ Планировщик автопубликации запущен")

# ==================== INSTAGRAM AUTH ====================

@app.route('/api/instagram/login', methods=['POST'])
def instagram_login():
    global ig_client
    data = request.json
    username = data.get('username')
    password = data.get('password')
    verification_code = data.get('verification_code', None)  # Новое
    
    try:
        ig_client = Client()
        
        # Пытаемся загрузить существующую сессию
        if SESSION_FILE.exists():
            try:
                ig_client.load_settings(SESSION_FILE)
                ig_client.login(username, password)
                session['instagram_logged_in'] = True
                session['instagram_username'] = username
                return jsonify({'success': True, 'message': 'Вход выполнен с использованием сохраненной сессии'})
            except Exception as e:
                print(f"Ошибка загрузки сессии: {e}")
        
        # Если не удалось загрузить сессию, делаем новый вход
        ig_client.login(username, password, verification_code=verification_code)
        
        # Сохраняем сессию
        ig_client.dump_settings(SESSION_FILE)
        
        session['instagram_logged_in'] = True
        session['instagram_username'] = username
        
        return jsonify({'success': True, 'message': 'Успешный вход в Instagram'})
    except Exception as e:
        error_str = str(e)
        print(f"❌ Ошибка входа в Instagram: {e}")
        
        # Проверяем, требуется ли challenge
        if 'challenge_required' in error_str:
            return jsonify({
                'success': False, 
                'error': 'Instagram требует подтверждение. Пройдите верификацию через веб-сайт Instagram и попробуйте снова через 10 минут.',
                'challenge_required': True
            }), 403
        
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/instagram/status', methods=['GET'])
def instagram_status():
    global ig_client
    
    # Пытаемся восстановить сессию из файла, если она потеряна
    if not session.get('instagram_logged_in') and SESSION_FILE.exists():
        try:
            # Загружаем сохраненную сессию
            with open(SESSION_FILE, 'r', encoding='utf-8') as f:
                settings = json.load(f)
                username = settings.get('username', '')
                
            if username:
                ig_client = Client()
                ig_client.load_settings(SESSION_FILE)
                
                # Проверяем, что сессия действительна
                try:
                    ig_client.get_timeline_feed()  # Простой запрос для проверки
                    session['instagram_logged_in'] = True
                    session['instagram_username'] = username
                    return jsonify({
                        'logged_in': True,
                        'username': username
                    })
                except Exception:
                    # Сессия устарела
                    ig_client = None
        except Exception:
            pass
    
    if session.get('instagram_logged_in'):
        return jsonify({
            'logged_in': True,
            'username': session.get('instagram_username')
        })
    return jsonify({'logged_in': False})

@app.route('/api/instagram/logout', methods=['POST'])
def instagram_logout():
    global ig_client
    session.pop('instagram_logged_in', None)
    session.pop('instagram_username', None)
    ig_client = None
    return jsonify({'success': True, 'message': 'Выход выполнен'})

# ==================== PHOTO GENERATION ====================

@app.route('/api/generate-photo', methods=['POST'])
def generate_photo():
    data = request.json
    prompt = data.get('prompt', 'beautiful landscape')
    width = data.get('width', 1024)
    height = data.get('height', 1024)
    model = data.get('model', 'flux')
    seed = data.get('seed', None)
    
    try:
        # Pollinations API
        url = f"https://image.pollinations.ai/prompt/{requests.utils.quote(prompt)}"
        params = {
            'width': width,
            'height': height,
            'model': model,
            'nologo': 'true'
        }
        if seed:
            params['seed'] = seed
        
        response = requests.get(url, params=params)
        
        if response.status_code == 200:
            # Сохраняем фото с именем в формате даты и времени
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"{timestamp}.jpg"
            filepath = PHOTOS_DIR / filename
            
            with open(filepath, 'wb') as f:
                f.write(response.content)
            
            # Сохраняем метаданные (промпт)
            metadata = {
                'prompt': prompt,
                'width': width,
                'height': height,
                'model': model,
                'seed': seed,
                'timestamp': timestamp
            }
            
            metadata_file = PHOTOS_DIR / f"{timestamp}.json"
            with open(metadata_file, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)
            
            print(f"Сохранены метаданные для {filename}: prompt='{prompt[:50] if prompt else '(пусто)'}...'")  # Логирование
            
            return jsonify({
                'success': True,
                'filename': filename,
                'url': f'/api/photos/{filename}'
            })
        else:
            return jsonify({'success': False, 'error': 'Ошибка генерации изображения'}), 400
    except Exception as e:
        print(f"❌ Ошибка при генерации фото: {e}")
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/photos/<filename>')
def get_photo(filename):
    return send_from_directory(PHOTOS_DIR, filename)

@app.route('/api/upload-photo', methods=['POST'])
def upload_photo():
    """Upload custom photo to library"""
    try:
        if 'photo' not in request.files:
            return jsonify({'success': False, 'error': 'Файл не найден'}), 400
        
        file = request.files['photo']
        
        if file.filename == '':
            return jsonify({'success': False, 'error': 'Файл не выбран'}), 400
        
        # Проверяем расширение файла
        allowed_extensions = {'jpg', 'jpeg'}
        file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
        
        if file_ext not in allowed_extensions:
            return jsonify({'success': False, 'error': 'Только JPG/JPEG файлы разрешены'}), 400
        
        # Сохраняем фото с именем в формате даты и времени
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"{timestamp}.jpg"
        filepath = PHOTOS_DIR / filename
        
        file.save(filepath)
        
        # Сохраняем метаданные
        metadata = {
            'prompt': 'Загружено пользователем',
            'type': 'uploaded',
            'original_filename': file.filename,
            'timestamp': timestamp
        }
        
        metadata_file = PHOTOS_DIR / f"{timestamp}.json"
        with open(metadata_file, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
        
        print(f"Загружено фото: {filename} (оригинал: {file.filename})")
        
        return jsonify({
            'success': True,
            'filename': filename,
            'url': f'/api/photos/{filename}'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/photos', methods=['GET'])
def list_photos():
    try:
        photos = []
        for photo_file in sorted(PHOTOS_DIR.glob('*.jpg'), reverse=True):
            metadata_file = photo_file.with_suffix('.json')
            metadata = {}
            if metadata_file.exists():
                try:
                    with open(metadata_file, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)
                except Exception as e:
                    print(f"Ошибка чтения метаданных для {photo_file.name}: {e}")
            
            photos.append({
                'filename': photo_file.name,
                'url': f'/api/photos/{photo_file.name}',
                'prompt': metadata.get('prompt', ''),
                'timestamp': metadata.get('timestamp', '')
            })
        
        return jsonify({'success': True, 'photos': photos})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

# ==================== VIDEO GENERATION ====================

@app.route('/api/generate-video', methods=['POST'])
def generate_video():
    """
    Генерация видео через Kling 2.0 (Segmind API)
    
    Используемый endpoint: https://api.segmind.com/v1/kling-2
    Возвращает либо бинарный mp4, либо JSON с полем url/video_url
    """
    if not segmind_api_key:
        return jsonify({'success': False, 'error': 'Segmind API не настроен. Добавьте SEGMIND_API_KEY в .env файл'}), 400
    
    data = request.json
    prompt = data.get('prompt', 'beautiful animation')
    seed = data.get('seed', None)
    duration = data.get('duration', '5')  # '5' or '10'
    aspect_ratio = data.get('aspect_ratio', '16:9')  # '16:9', '9:16', '1:1'
    
    try:
        # Kling 2.0 endpoint
        url = "https://api.segmind.com/v1/kling-2"
        
        payload = {
            'prompt': prompt,
            'duration': int(duration)
        }
        # aspect_ratio и другие параметры могут игнорироваться моделью, но сохраняем в метаданных
        
        headers = {
            'x-api-key': segmind_api_key,
            'Content-Type': 'application/json'
        }
        
        print("🎬 Генерация видео через Kling 2.0...")
        print(f"📝 Промпт: {prompt[:100]}...")
        print(f"⏱️ Параметры: {aspect_ratio}, {duration} сек")
        
        response = requests.post(url, json=payload, headers=headers, timeout=450)
        print("📡 Ответ получен от API!")
        
        if response.status_code == 200:
            content_type = response.headers.get('Content-Type', '')
            video_content = None
            
            if 'application/json' in content_type:
                try:
                    result = response.json()
                except Exception:
                    return jsonify({'success': False, 'error': f'Не удалось распарсить JSON ответ: {response.text[:200]}'}), 400
                
                # Пытаемся скачать по URL
                video_url = result.get('video_url') or result.get('url')
                status_url = result.get('status_url') or result.get('status')
                
                if video_url:
                    print(f"🔗 Скачиваем видео по URL: {video_url}")
                    dl = requests.get(video_url, timeout=180)
                    if dl.status_code != 200:
                        return jsonify({'success': False, 'error': f'Не удалось скачать видео: HTTP {dl.status_code}'}), 400
                    video_content = dl.content
                elif status_url:
                    print(f"⏳ Обнаружен статус: {status_url} — polling до 10 минут...")
                    import time
                    for _ in range(600):
                        st = requests.get(status_url, timeout=10)
                        if st.status_code == 200:
                            sj = st.json()
                            ready_url = sj.get('video_url') or sj.get('url')
                            if ready_url:
                                file_resp = requests.get(ready_url, timeout=180)
                                if file_resp.status_code == 200:
                                    video_content = file_resp.content
                                    break
                        time.sleep(1)
                    if video_content is None:
                        return jsonify({'success': False, 'error': 'Видео не готово в течение 10 минут'}), 202
                else:
                    return jsonify({'success': False, 'error': f'В ответе нет URL видео: {result}'}), 400
            else:
                video_content = response.content
            
            if not video_content or len(video_content) < 1000:
                return jsonify({'success': False, 'error': f'Получен некорректный файл ({len(video_content) if video_content else 0} байт)'}), 400
            
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
            filename = f"{timestamp}.mp4"
            filepath = VIDEOS_DIR / filename
            with open(filepath, 'wb') as f:
                f.write(video_content)
            
            metadata = {
                'prompt': prompt,
                'aspect_ratio': aspect_ratio,
                'duration': int(duration),
                'seed': seed,
                'timestamp': timestamp,
                'type': 'text-to-video',
                'model': 'kling-2'
            }
            metadata_file = VIDEOS_DIR / f"{timestamp}.json"
            with open(metadata_file, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)
            
            print(f"✅ Видео сохранено: {filename}")
            return jsonify({'success': True, 'filename': filename, 'url': f'/api/videos/{filename}'})
        else:
            error_message = response.text if response.text else 'Ошибка генерации видео'
            print(f"❌ Ошибка Segmind API (status {response.status_code}): {error_message}")
            print(f"🔗 Использованный URL: {url}")
            print(f"📦 Payload: {json.dumps(payload, ensure_ascii=False)[:200]}...")
            
            # Более детальная обработка распространенных ошибок
            if response.status_code == 404:
                return jsonify({
                    'success': False, 
                    'error': f'''❌ Модель не найдена (404). 
                    
Возможные причины:
1. URL эндпоинта устарел или неправильный
2. Модель Kling AI больше не доступна через этот эндпоинт

Используемый URL: {url}

Решение:
1. Проверьте актуальную документацию на https://www.segmind.com/models
2. Найдите правильный эндпоинт для Kling Video
3. Обновите URL в app.py (строка 294 для text-to-video)

API ответ: {error_message[:200]}'''
                }), 400
            elif response.status_code == 400:
                if 'api key' in error_message.lower() or 'unauthorized' in error_message.lower():
                    return jsonify({'success': False, 'error': 'Неверный API ключ Segmind. Проверьте SEGMIND_API_KEY в .env файле'}), 400
                elif 'insufficient credits' in error_message.lower() or 'quota' in error_message.lower():
                    return jsonify({'success': False, 'error': 'Недостаточно кредитов на балансе Segmind. Пополните баланс на https://www.segmind.com/'}), 400
                else:
                    return jsonify({'success': False, 'error': f'Ошибка генерации видео: {error_message}'}), 400
            else:
                return jsonify({'success': False, 'error': f'Ошибка сервера Segmind ({response.status_code}): {error_message}'}), 400
    except requests.exceptions.ReadTimeout as e:
        print(f"❌ ReadTimeout при обращении к Kling 2.0: {e}")
        return jsonify({'success': False, 'error': 'Таймаут генерации видео. Попробуйте еще раз позже.'}), 202
    except requests.exceptions.RequestException as e:
        print(f"❌ Ошибка запроса к API Segmind: {e}")
        return jsonify({'success': False, 'error': f'Ошибка при обращении к API Segmind: {str(e)}'}), 400
    except Exception as e:
        print(f"❌ Непредвиденная ошибка при генерации видео: {e}")
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/generate-image-to-video', methods=['POST'])
def generate_image_to_video():
    """
    Генерация видео из изображения через Kling 2.0 (Segmind API)
    
    Используемый endpoint: https://api.segmind.com/v1/kling-2
    """
    if not segmind_api_key:
        return jsonify({'success': False, 'error': 'Segmind API не настроен. Добавьте SEGMIND_API_KEY в .env файл'}), 400
    
    data = request.json
    image_filename = data.get('image_filename', '')
    prompt = data.get('prompt', 'smooth camera movement')
    seed = data.get('seed', None)
    duration = data.get('duration', '5')
    aspect_ratio = data.get('aspect_ratio', '16:9')
    
    if not image_filename:
        return jsonify({'success': False, 'error': 'Не указано изображение'}), 400
    
    try:
        # Проверяем существование файла
        image_path = PHOTOS_DIR / image_filename
        if not image_path.exists():
            return jsonify({'success': False, 'error': f'Изображение не найдено: {image_filename}'}), 400
        
        # Читаем изображение и конвертируем в base64
        import base64
        with open(image_path, 'rb') as f:
            image_data = base64.b64encode(f.read()).decode('utf-8')
        
        # Kling 2.0 endpoint
        url = "https://api.segmind.com/v1/kling-2"
        
        payload = {
            'prompt': prompt,
            'duration': int(duration),
            'start_image': f'data:image/jpeg;base64,{image_data}'
        }
        headers = {
            'x-api-key': segmind_api_key,
            'Content-Type': 'application/json'
        }
        
        print("🎬 Генерация видео из изображения через Kling 2.0...")
        response = requests.post(url, json=payload, headers=headers, timeout=450)
        print("📡 Ответ получен от API!")
        
        if response.status_code == 200:
            content_type = response.headers.get('Content-Type', '')
            video_content = None
            
            if 'application/json' in content_type:
                try:
                    result = response.json()
                except Exception:
                    return jsonify({'success': False, 'error': f'Не удалось распарсить JSON ответ: {response.text[:200]}'}), 400
                
                video_url = result.get('video_url') or result.get('url')
                status_url = result.get('status_url') or result.get('status')
                
                if video_url:
                    print(f"🔗 Скачиваем видео по URL: {video_url}")
                    dl = requests.get(video_url, timeout=180)
                    if dl.status_code != 200:
                        return jsonify({'success': False, 'error': f'Не удалось скачать видео: HTTP {dl.status_code}'}), 400
                    video_content = dl.content
                elif status_url:
                    print(f"⏳ Обнаружен статус: {status_url} — polling до 10 минут...")
                    import time
                    for _ in range(600):
                        st = requests.get(status_url, timeout=10)
                        if st.status_code == 200:
                            sj = st.json()
                            ready_url = sj.get('video_url') or sj.get('url')
                            if ready_url:
                                file_resp = requests.get(ready_url, timeout=180)
                                if file_resp.status_code == 200:
                                    video_content = file_resp.content
                                    break
                        time.sleep(1)
                    if video_content is None:
                        return jsonify({'success': False, 'error': 'Видео не готово в течение 10 минут'}), 202
                else:
                    return jsonify({'success': False, 'error': f'В ответе нет URL видео: {result}'}), 400
            else:
                video_content = response.content
            
            if not video_content or len(video_content) < 1000:
                return jsonify({'success': False, 'error': f'Получен некорректный файл ({len(video_content) if video_content else 0} байт)'}), 400
            
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
            filename = f"{timestamp}.mp4"
            filepath = VIDEOS_DIR / filename
            with open(filepath, 'wb') as f:
                f.write(video_content)
            
            metadata = {
                'prompt': prompt,
                'source_image': image_filename,
                'aspect_ratio': aspect_ratio,
                'duration': int(duration),
                'seed': seed,
                'timestamp': timestamp,
                'type': 'image-to-video',
                'model': 'kling-2'
            }
            metadata_file = VIDEOS_DIR / f"{timestamp}.json"
            with open(metadata_file, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)
            
            print(f"✅ Видео сохранено: {filename}")
            return jsonify({'success': True, 'filename': filename, 'url': f'/api/videos/{filename}'})
        else:
            error_message = response.text if response.text else 'Ошибка генерации видео из изображения'
            print(f"❌ Ошибка Segmind API Image-to-Video (status {response.status_code}): {error_message}")
            print(f"🔗 Использованный URL: {url}")
            print(f"📦 Payload keys: {list(payload.keys())}")
            
            # Более детальная обработка распространенных ошибок
            if response.status_code == 404:
                return jsonify({
                    'success': False, 
                    'error': f'''❌ Модель не найдена (404). 
                    
Возможные причины:
1. URL эндпоинта устарел или неправильный
2. Модель Kling AI Image-to-Video больше не доступна через этот эндпоинт

Используемый URL: {url}

Решение:
1. Проверьте актуальную документацию на https://www.segmind.com/models
2. Найдите правильный эндпоинт для Kling Image-to-Video
3. Обновите URL в app.py (строка 437 для image-to-video)

API ответ: {error_message[:200]}'''
                }), 400
            elif response.status_code == 400:
                if 'api key' in error_message.lower() or 'unauthorized' in error_message.lower():
                    return jsonify({'success': False, 'error': 'Неверный API ключ Segmind. Проверьте SEGMIND_API_KEY в .env файле'}), 400
                elif 'insufficient credits' in error_message.lower() or 'quota' in error_message.lower():
                    return jsonify({'success': False, 'error': 'Недостаточно кредитов на балансе Segmind. Пополните баланс на https://www.segmind.com/'}), 400
                else:
                    return jsonify({'success': False, 'error': f'Ошибка генерации видео из изображения: {error_message}'}), 400
            else:
                return jsonify({'success': False, 'error': f'Ошибка сервера Segmind ({response.status_code}): {error_message}'}), 400
    except requests.exceptions.ReadTimeout as e:
        print(f"❌ ReadTimeout при обращении к Kling 2.0: {e}")
        return jsonify({'success': False, 'error': 'Таймаут генерации видео. Попробуйте еще раз позже.'}), 202
    except requests.exceptions.RequestException as e:
        print(f"❌ Ошибка запроса к API Segmind: {e}")
        return jsonify({'success': False, 'error': f'Ошибка при обращении к API Segmind: {str(e)}'}), 400
    except Exception as e:
        print(f"❌ Непредвиденная ошибка при генерации видео из изображения: {e}")
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/videos/<filename>')
def get_video(filename):
    return send_from_directory(VIDEOS_DIR, filename)

@app.route('/api/videos', methods=['GET'])
def list_videos():
    try:
        videos = []
        for video_file in sorted(VIDEOS_DIR.glob('*.mp4'), reverse=True):
            metadata_file = video_file.with_suffix('.json')
            metadata = {}
            if metadata_file.exists():
                try:
                    with open(metadata_file, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)
                except Exception as e:
                    print(f"Ошибка чтения метаданных для {video_file.name}: {e}")
            
            videos.append({
                'filename': video_file.name,
                'url': f'/api/videos/{video_file.name}',
                'prompt': metadata.get('prompt', ''),
                'timestamp': metadata.get('timestamp', '')
            })
        
        return jsonify({'success': True, 'videos': videos})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

# ==================== GEMINI TEXT GENERATION ====================

@app.route('/api/generate-prompt', methods=['POST'])
def generate_prompt():
    """Generate image prompt based on post topic"""
    if not gemini_api_key:
        return jsonify({'success': False, 'error': 'Gemini API не настроен. Добавьте GEMINI_API_KEY в .env файл'}), 400
    
    data = request.json
    topic = data.get('topic', '')
    
    try:
        full_prompt = f"""Ты - эксперт по созданию промптов для генерации изображений. На основе следующей темы создай ВИЗУАЛЬНЫЙ промпт на английском языке для AI генератора изображений.

ТЕМА ПОСТА: {topic}

ВАЖНО:
1. Сфокусируйся на ВИЗУАЛЬНОМ содержании - что должно быть на картинке
2. НЕ включай текст в изображение (no text overlay, no words)
3. Опиши реальную сцену, объекты, люди, природу - то, что можно сфотографировать
4. Если тема про конкретную страну/культуру - покажи её через визуальные элементы (архитектура, пейзажи, традиции, люди)
5. Добавь детали: стиль фотографии, освещение, настроение, цветовую гамму
6. Промпт должен быть 30-80 слов

ПРИМЕРЫ:
- Тема: "Немцы великий народ" → "German cultural heritage: traditional Bavarian architecture, beer gardens, historic castles, autumn landscape, warm golden hour lighting, professional photography, vibrant colors, cultural atmosphere"
- Тема: "Здоровый завтрак" → "Healthy breakfast scene: fresh fruits, avocado toast, smoothie bowl, natural sunlight, minimalist white table, top view, bright and fresh, food photography, instagram style"

Верни ТОЛЬКО промпт на английском, без объяснений и комментариев."""
        
        model = genai.GenerativeModel('gemini-2.0-flash-exp')
        response = model.generate_content(full_prompt)
        
        return jsonify({
            'success': True,
            'prompt': response.text.strip()
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/generate-video-prompt', methods=['POST'])
def generate_video_prompt():
    """Generate video prompt based on post topic"""
    if not gemini_api_key:
        return jsonify({'success': False, 'error': 'Gemini API не настроен. Добавьте GEMINI_API_KEY в .env файл'}), 400
    
    data = request.json
    topic = data.get('topic', '')
    
    try:
        full_prompt = f"""Ты - эксперт по созданию промптов для генерации видео. На основе следующей темы создай ДИНАМИЧЕСКИЙ промпт на английском языке для AI генератора видео.

ТЕМА ПОСТА: {topic}

ВАЖНО:
1. Сфокусируйся на ДВИЖЕНИИ и ДЕЙСТВИИ - опиши что происходит в кадре
2. Укажи движение камеры (camera pans, zooms, tracking shot, etc.) если уместно
3. Опиши динамическую сцену с действием, движением объектов, изменениями
4. НЕ включай текст в видео (no text overlay, no words)
5. Добавь детали: темп движения, освещение, настроение, стиль
6. Промпт должен быть 30-80 слов

ПРИМЕРЫ:
- Тема: "Закат на море" → "Cinematic sunset over ocean, waves gently rolling, camera slowly panning left, golden hour lighting, seagulls flying across frame, peaceful atmosphere, warm colors, smooth motion"
- Тема: "Городская жизнь" → "Busy city street time-lapse, people walking fast, cars moving, camera tracking forward, urban energy, evening lights turning on, dynamic movement, modern cityscape"
- Тема: "Природа весной" → "Spring meadow with flowers swaying in breeze, butterflies flying, camera dolly forward through grass, soft sunlight, green and colorful, gentle motion, fresh atmosphere"

Верни ТОЛЬКО промпт на английском, без объяснений и комментариев."""
        
        model = genai.GenerativeModel('gemini-2.0-flash-exp')
        response = model.generate_content(full_prompt)
        
        return jsonify({
            'success': True,
            'prompt': response.text.strip()
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/generate-text', methods=['POST'])
def generate_text():
    if not gemini_api_key:
        return jsonify({'success': False, 'error': 'Gemini API не настроен. Добавьте GEMINI_API_KEY в .env файл'}), 400
    
    data = request.json
    prompt = data.get('prompt', '')
    post_size = data.get('post_size', 'medium')  # short, medium, long
    add_hashtags = data.get('add_hashtags', False)
    hashtag_count = data.get('hashtag_count', 5)
    
    try:
        # Определяем размер поста
        size_descriptions = {
            'short': 'короткий и лаконичный пост (2-4 предложения, примерно 150-300 символов)',
            'medium': 'пост средней длины (несколько абзацев, примерно 500-1000 символов)',
            'long': 'длинный и подробный пост (развернутый текст, примерно 1500-2000 символов, МАКСИМУМ 2200 символов - это лимит Instagram)'
        }
        
        size_description = size_descriptions.get(post_size, size_descriptions['medium'])
        
        # Формируем промпт с учетом настроек
        full_prompt = f"""Создай {size_description} для Instagram на тему: {prompt}

ВАЖНЫЕ ТРЕБОВАНИЯ К ФОРМАТУ:
- НЕ используй markdown разметку (##, **, _, ~~)
- НЕ используй жирный текст или заголовки
- Используй эмодзи умеренно (2-5 на весь пост, не больше!)
- НЕ добавляй клише типа "поставьте лайк", "поделитесь в комментариях", "подпишитесь"
- НЕ задавай вопросы в конце поста
- Пиши ПРОСТЫМ текстом без форматирования

СТИЛЬ:
- Естественный, живой разговорный язык
- Структурируй абзацами для удобства чтения
- Будь содержательным и интересным
- Пиши от первого лица или обращайся к аудитории напрямую"""
        
        if add_hashtags:
            full_prompt += f"\n- В конце (через пустую строку) добавь {hashtag_count} релевантных хештегов"
        
        full_prompt += "\n\nПомни: это пост для Instagram, а не статья в блоге. Пиши естественно, без излишнего форматирования!"
        
        model = genai.GenerativeModel('gemini-2.0-flash-exp')
        response = model.generate_content(full_prompt)
        
        generated_text = response.text
        
        # Постобработка: удаляем markdown разметку, если она осталась
        # Убираем markdown заголовки (## Заголовок)
        generated_text = re.sub(r'^#{1,6}\s+', '', generated_text, flags=re.MULTILINE)
        # Убираем жирный текст (**текст**)
        generated_text = re.sub(r'\*\*(.+?)\*\*', r'\1', generated_text)
        # Убираем курсив (*текст* или _текст_)
        generated_text = re.sub(r'\*(.+?)\*', r'\1', generated_text)
        generated_text = re.sub(r'_(.+?)_', r'\1', generated_text)
        # Убираем зачеркнутый текст (~~текст~~)
        generated_text = re.sub(r'~~(.+?)~~', r'\1', generated_text)
        
        return jsonify({
            'success': True,
            'text': generated_text
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

# ==================== POST PUBLISHING ====================

@app.route('/api/publish-post', methods=['POST'])
def publish_post():
    global ig_client
    
    # Пытаемся восстановить соединение, если оно потеряно
    if not ig_client and SESSION_FILE.exists():
        try:
            ig_client = Client()
            ig_client.load_settings(SESSION_FILE)
            
            # Загружаем username из сессии
            with open(SESSION_FILE, 'r', encoding='utf-8') as f:
                settings = json.load(f)
                username = settings.get('username', '')
            
            if username:
                session['instagram_logged_in'] = True
                session['instagram_username'] = username
        except Exception as e:
            print(f"Ошибка восстановления сессии: {e}")
            return jsonify({'success': False, 'error': 'Не выполнен вход в Instagram. Пожалуйста, войдите снова.'}), 401
    
    if not ig_client:
        return jsonify({'success': False, 'error': 'Не выполнен вход в Instagram. Пожалуйста, войдите снова.'}), 401
    
    data = request.json
    caption = data.get('caption', '')
    photo_filenames = data.get('photos', [])
    video_filenames = data.get('videos', [])
    
    if not photo_filenames and not video_filenames:
        return jsonify({'success': False, 'error': 'Не выбраны фотографии или видео'}), 400
    
    try:
        photo_paths = [str(PHOTOS_DIR / filename) for filename in photo_filenames]
        video_paths = [str(VIDEOS_DIR / filename) for filename in video_filenames]
        
        # Проверяем существование файлов
        for path in photo_paths + video_paths:
            if not Path(path).exists():
                return jsonify({'success': False, 'error': f'Файл не найден: {path}'}), 400
        
        # Публикуем пост
        media = None
        
        # Если только одно видео
        if len(video_paths) == 1 and len(photo_paths) == 0:
            media = ig_client.video_upload(video_paths[0], caption)
        # Если только одно фото
        elif len(photo_paths) == 1 and len(video_paths) == 0:
            media = ig_client.photo_upload(photo_paths[0], caption)
        # Если альбом (микс фото и видео)
        else:
            # Instagram поддерживает альбомы с миксом фото и видео
            all_paths = photo_paths + video_paths
            media = ig_client.album_upload(all_paths, caption)
        
        # Сохраняем в историю
        post_data = {
            'id': media.pk,
            'caption': caption,
            'photos': photo_filenames,
            'videos': video_filenames,
            'timestamp': datetime.now().isoformat(),
            'username': session.get('instagram_username'),
            'status': 'published'
        }
        
        history_file = POSTS_DIR / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(history_file, 'w', encoding='utf-8') as f:
            json.dump(post_data, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            'success': True,
            'message': 'Пост успешно опубликован',
            'post_id': media.pk
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/schedule-post', methods=['POST'])
def schedule_post():
    """Запланировать пост на определенное время"""
    data = request.json
    caption = data.get('caption', '')
    photo_filenames = data.get('photos', [])
    video_filenames = data.get('videos', [])
    scheduled_time_str = data.get('scheduled_time', '')
    
    if not scheduled_time_str:
        return jsonify({'success': False, 'error': 'Не указано время публикации'}), 400
    
    if not photo_filenames and not video_filenames:
        return jsonify({'success': False, 'error': 'Не выбраны фотографии или видео'}), 400
    
    try:
        # Логируем полученное время для отладки
        print(f"📅 Получено время для планирования: '{scheduled_time_str}'")
        
        # Парсим время (локальное время в формате YYYY-MM-DDTHH:mm:ss)
        try:
            scheduled_time = datetime.fromisoformat(scheduled_time_str)
        except ValueError as e:
            print(f"❌ Ошибка парсинга даты: {e}")
            return jsonify({'success': False, 'error': f'Неверный формат даты и времени: {str(e)}'}), 400
        
        print(f"📅 Распарсенное время: {scheduled_time}")
        print(f"📅 Текущее время: {datetime.now()}")
        
        # Проверяем, что время в будущем
        if scheduled_time <= datetime.now():
            return jsonify({'success': False, 'error': 'Время публикации должно быть в будущем'}), 400
        
        # Сохраняем запланированный пост
        post_data = {
            'caption': caption,
            'photos': photo_filenames,
            'videos': video_filenames,
            'scheduled_time': scheduled_time.isoformat(),
            'created_time': datetime.now().isoformat(),
            'username': session.get('instagram_username'),
            'status': 'scheduled'
        }
        
        scheduled_file = SCHEDULED_DIR / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(scheduled_file, 'w', encoding='utf-8') as f:
            json.dump(post_data, f, ensure_ascii=False, indent=2)
        
        print(f"📅 Пост запланирован на {scheduled_time.strftime('%d.%m.%Y %H:%M')}")
        
        return jsonify({
            'success': True,
            'message': f'Пост запланирован на {scheduled_time.strftime("%d.%m.%Y %H:%M")}',
            'scheduled_time': scheduled_time.isoformat()
        })
    except Exception as e:
        print(f"❌ Ошибка планирования поста: {e}")
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/posts/history', methods=['GET'])
def get_posts_history():
    try:
        posts = []
        
        # Добавляем опубликованные посты
        for post_file in sorted(POSTS_DIR.glob('*.json'), reverse=True):
            with open(post_file, 'r', encoding='utf-8') as f:
                post_data = json.load(f)
                # Устанавливаем статус если его нет (для старых постов)
                if 'status' not in post_data:
                    post_data['status'] = 'published'
                posts.append(post_data)
        
        # Добавляем запланированные посты
        for scheduled_file in sorted(SCHEDULED_DIR.glob('*.json'), reverse=True):
            with open(scheduled_file, 'r', encoding='utf-8') as f:
                post_data = json.load(f)
                posts.append(post_data)
        
        # Сортируем: запланированные по времени публикации, опубликованные по времени публикации
        posts.sort(key=lambda x: x.get('scheduled_time') or x.get('timestamp') or '', reverse=True)
        
        return jsonify({'success': True, 'posts': posts})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

# ==================== FRONTEND ROUTES ====================

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)


