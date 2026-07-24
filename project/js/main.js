/**
 * Главная логика приложения
 * Инициализирует пользовательский интерфейс, связывает ImageEnhancerAPI,
 * обрабатывает загрузку Drag & Drop и скачивание в форматах PNG, JPG, BMP, HEIC.
 */

import { ImageEnhancerAPI } from './api/imageEnhancerAPI.js';
import { ComparisonSlider } from './components/comparisonSlider.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Инициализация API и компонентов
    const api = new ImageEnhancerAPI();
    const comparisonContainer = document.getElementById('comparisonContainer');
    const sliderRange = document.getElementById('sliderRange');
    const slider = new ComparisonSlider(comparisonContainer, sliderRange);

    // Элементы DOM
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    const btnProcess = document.getElementById('btnProcess');
    const btnAbort = document.getElementById('btnAbort');
    const btnDownload = document.getElementById('btnDownload');
    const downloadFormatSelect = document.getElementById('downloadFormatSelect');

    const statusBadge = document.getElementById('statusBadge');
    const progressBarFill = document.getElementById('progressBarFill');
    const statusMsg = document.getElementById('statusMsg');

    const valBrightness = document.getElementById('valBrightness');
    const valContrast = document.getElementById('valContrast');
    const valColorfulness = document.getElementById('valColorfulness');
    const valGamma = document.getElementById('valGamma');
    const valTime = document.getElementById('valTime');
    const valResolution = document.getElementById('valResolution');

    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    let currentFileOrImageData = null;
    let currentOriginalUrl = null;
    let currentEnhancedUrl = null;
    let activeTaskId = null;

    const statusMap = {
        idle: 'ОЖИДАНИЕ',
        pending: 'В ОЧЕРЕДИ',
        processing: 'ОБРАБОТКА',
        completed: 'ЗАВЕРШЕНО',
        aborted: 'ПРЕРВАНО',
        failed: 'ОШИБКА'
    };

    // 2. Навигация по вкладкам
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // 3. Обработка выбора файлов и Drag and Drop
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileSelected(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFileSelected(e.target.files[0]);
        }
    });

    function handleFileSelected(file) {
        currentFileOrImageData = file;
        if (currentOriginalUrl) URL.revokeObjectURL(currentOriginalUrl);
        currentOriginalUrl = URL.createObjectURL(file);

        slider.setImages(currentOriginalUrl, currentOriginalUrl);
        btnProcess.disabled = false;
        btnDownload.disabled = true;
        updateStatus('idle', 0, `Загружен файл: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} МБ)`);
    }

    // 4. Слушатель событий API
    api.onStatusChange((detail) => {
        const { taskId, status, progress, message, metrics, error } = detail;
        if (taskId !== activeTaskId) return;

        updateStatus(status, progress, message || error || '');

        if (status === 'completed' && metrics) {
            valBrightness.textContent = metrics.params.brightness > 0 ? `+${metrics.params.brightness}` : metrics.params.brightness;
            valContrast.textContent = `${metrics.params.contrast}x`;
            valColorfulness.textContent = `${metrics.params.colorfulness}x`;
            valGamma.textContent = `${metrics.params.gamma}`;

            valTime.textContent = `${metrics.executionTimeMs} мс`;
            valResolution.textContent = `${metrics.width}x${metrics.height} (${metrics.megapixels} Мпк)`;

            btnProcess.disabled = false;
            btnAbort.disabled = true;
            btnDownload.disabled = false;
        } else if (status === 'failed' || status === 'aborted') {
            btnProcess.disabled = false;
            btnAbort.disabled = true;
        }
    });

    // 5. Обработчики кнопок
    btnProcess.addEventListener('click', async () => {
        if (!currentFileOrImageData) return;

        btnProcess.disabled = true;
        btnAbort.disabled = false;
        btnDownload.disabled = true;

        activeTaskId = await api.submitTask(currentFileOrImageData);

        try {
            const resultBlob = await api.getResult(activeTaskId, 'png');
            if (currentEnhancedUrl) URL.revokeObjectURL(currentEnhancedUrl);
            currentEnhancedUrl = URL.createObjectURL(resultBlob);

            slider.setImages(currentOriginalUrl, currentEnhancedUrl);
        } catch (err) {
            console.error('Ошибка улучшения изображения:', err);
        }
    });

    btnAbort.addEventListener('click', () => {
        if (activeTaskId) {
            api.abortTask(activeTaskId);
        }
    });

    // Скачивание в выбранном формате (PNG, JPG, BMP, HEIC)
    btnDownload.addEventListener('click', async () => {
        if (!activeTaskId) return;

        const selectedFormat = downloadFormatSelect.value || 'png';
        btnDownload.disabled = true;
        btnDownload.textContent = '⏳ Сохранение...';

        try {
            const blob = await api.getResult(activeTaskId, selectedFormat);
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `ml_enhanced_${Date.now()}.${selectedFormat}`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
        } catch (err) {
            console.error('Ошибка скачивания файла:', err);
        } finally {
            btnDownload.disabled = false;
            btnDownload.textContent = '💾 Скачать результат';
        }
    });

    function updateStatus(status, progress, message) {
        statusBadge.className = `status-badge ${status}`;
        statusBadge.textContent = statusMap[status] || status.toUpperCase();
        progressBarFill.style.width = `${progress}%`;
        statusMsg.textContent = message;
    }
});
