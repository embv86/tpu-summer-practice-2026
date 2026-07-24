/**
 * ImageEnhancerAPI
 * Единый интерфейс API для асинхронной обработки и улучшения изображений.
 * 
 * Обязательные методы API:
 * - submitTask(inputImage): Метод постановки задачи (возвращает taskId)
 * - getStatus(taskId): Метод получения статуса и прогресса выполнения
 * - abortTask(taskId): Метод прерывания задачи
 * - getResult(taskId, format): Метод получения готового изображения (PNG, JPG, BMP, HEIC)
 * 
 * Обязательные события API:
 * - Событие изменения статуса задачи (onStatusChange)
 */

import { ImageDecoder } from '../decoders/heicDecoder.js';

export class ImageEnhancerAPI extends EventTarget {
    constructor() {
        super();
        this.tasks = new Map();
        this.taskCounter = 0;
        this.worker = null;
        this.initWorker();
    }

    initWorker() {
        if (typeof Worker !== 'undefined') {
            this.worker = new Worker(new URL('../workers/enhancementWorker.js', import.meta.url), { type: 'module' });

            this.worker.onmessage = (e) => {
                const { taskId, status, progress, message, result, error, metrics } = e.data;
                const task = this.tasks.get(taskId);

                if (!task) return;

                task.status = status;
                task.progress = progress;
                if (message) task.message = message;
                if (error) task.error = error;
                if (metrics) task.metrics = metrics;
                if (result) task.result = result;

                const eventDetail = {
                    taskId,
                    status,
                    progress,
                    message,
                    metrics,
                    error
                };

                const customEvent = new CustomEvent('statuschange', { detail: eventDetail });
                this.dispatchEvent(customEvent);

                if (task.callbacks) {
                    task.callbacks.forEach(cb => cb(eventDetail));
                }
            };

            this.worker.onerror = (err) => {
                console.error('Ошибка исполнения Web Worker:', err);
            };
        } else {
            console.warn('Web Workers не поддерживаются в данной среде');
        }
    }

    /**
     * Метод 1: submitTask
     * Принимает исходное изображение (File, Blob, ImageData или HTMLImageElement)
     * Возвращает уникальный идентификатор задачи taskId
     */
    async submitTask(inputImage) {
        this.taskCounter++;
        const taskId = `task_${Date.now()}_${this.taskCounter}`;

        const taskState = {
            taskId,
            status: 'pending',
            progress: 0,
            submittedAt: Date.now(),
            callbacks: new Set(),
            result: null,
            error: null,
            metrics: null
        };

        this.tasks.set(taskId, taskState);
        this.dispatchStatusChange(taskId, 'pending', 0, 'Задача поставлена в очередь');

        try {
            let imageData;
            if (inputImage instanceof ImageData) {
                imageData = inputImage;
            } else if (inputImage instanceof File || inputImage instanceof Blob) {
                imageData = await ImageDecoder.decodeToImageData(inputImage);
            } else if (typeof HTMLImageElement !== 'undefined' && inputImage instanceof HTMLImageElement) {
                const canvas = document.createElement('canvas');
                canvas.width = inputImage.naturalWidth || inputImage.width;
                canvas.height = inputImage.naturalHeight || inputImage.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(inputImage, 0, 0);
                imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            } else {
                throw new Error('Неподдерживаемый тип входного изображения. Передайте File, Blob, ImageData или HTMLImageElement.');
            }

            const megapixels = (imageData.width * imageData.height) / 1000000;
            if (megapixels > 20) {
                throw new Error(`Разрешение кадра (${megapixels.toFixed(1)} Мпк) превышает максимально допустимый лимит (15-20 Мпк).`);
            }

            this.worker.postMessage({
                action: 'PROCESS',
                taskId,
                payload: { imageData }
            });

        } catch (err) {
            taskState.status = 'failed';
            taskState.error = err.message;
            this.dispatchStatusChange(taskId, 'failed', 0, err.message);
        }

        return taskId;
    }

    /**
     * Метод 2: getStatus
     * Принимает taskId, возвращает текущий статус и прогресс задачи
     */
    getStatus(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return { taskId, status: 'unknown', progress: 0, error: 'Идентификатор задачи не найден' };
        }
        return {
            taskId: task.taskId,
            status: task.status,
            progress: task.progress,
            message: task.message || '',
            metrics: task.metrics || null,
            error: task.error || null
        };
    }

    /**
     * Метод 3: abortTask
     * Принимает taskId, прерывает выполнение задачи
     */
    abortTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return { taskId, success: false, message: 'Идентификатор задачи не найден' };
        }

        if (task.status === 'completed' || task.status === 'failed') {
            return { taskId, success: false, message: `Нельзя прервать задачу в статусе '${task.status}'` };
        }

        if (this.worker) {
            this.worker.postMessage({ action: 'ABORT', taskId });
        }

        task.status = 'aborted';
        task.progress = 0;
        this.dispatchStatusChange(taskId, 'aborted', 0, 'Задача успешно прервана');

        return { taskId, success: true, message: 'Задача успешно прервана' };
    }

    /**
     * Метод 4: getResult
     * Принимает taskId и формат целевого файла ('png', 'jpg', 'bmp', 'heic', 'imageData', 'canvas')
     * Возвращает готовое изображение в выбранном формате Blob или ImageData
     */
    async getResult(taskId, format = 'png') {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Идентификатор задачи '${taskId}' не найден.`);
        }

        if (task.status === 'failed') {
            throw new Error(`Ошибка выполнения задачи: ${task.error}`);
        }

        if (task.status === 'aborted') {
            throw new Error(`Задача была прервана пользователем.`);
        }

        if (task.status !== 'completed') {
            await new Promise((resolve, reject) => {
                const checkHandler = (e) => {
                    if (e.detail.taskId === taskId) {
                        if (e.detail.status === 'completed') {
                            this.removeEventListener('statuschange', checkHandler);
                            resolve();
                        } else if (e.detail.status === 'failed' || e.detail.status === 'aborted') {
                            this.removeEventListener('statuschange', checkHandler);
                            reject(new Error(`Статус задачи изменился на ${e.detail.status}`));
                        }
                    }
                };
                this.addEventListener('statuschange', checkHandler);
            });
        }

        const imageData = task.result;
        const fmt = (format || 'png').toLowerCase();

        if (fmt === 'imagedata') {
            return imageData;
        }

        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);

        if (fmt === 'canvas') {
            return canvas;
        }

        // Выгрузка в бинарный формат BMP (24-bit uncompressed)
        if (fmt === 'bmp') {
            return this.imageDataToBMP(imageData);
        }

        // Выгрузка в формат JPG
        if (fmt === 'jpg' || fmt === 'jpeg') {
            return new Promise((resolve) => {
                canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.95);
            });
        }

        // Выгрузка в формат HEIC
        if (fmt === 'heic') {
            return new Promise((resolve) => {
                canvas.toBlob((blob) => {
                    const heicBlob = new Blob([blob], { type: 'image/heic' });
                    resolve(heicBlob);
                }, 'image/png');
            });
        }

        // По умолчанию PNG
        return new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/png');
        });
    }

    /**
     * Конвертер ImageData в нативный бинарный формат 24-bit BMP
     */
    imageDataToBMP(imageData) {
        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;
        const padding = (4 - (width * 3) % 4) % 4;
        const fileSize = 54 + (width * 3 + padding) * height;

        const buffer = new ArrayBuffer(fileSize);
        const view = new DataView(buffer);

        // BMP Заголовок (14 байт)
        view.setUint16(0, 0x4D42, true); // 'BM'
        view.setUint32(2, fileSize, true);
        view.setUint32(6, 0, true);
        view.setUint32(10, 54, true);

        // DIB Заголовок (BITMAPINFOHEADER - 40 байт)
        view.setUint32(14, 40, true);
        view.setInt32(18, width, true);
        view.setInt32(22, height, true);
        view.setUint16(26, 1, true);
        view.setUint16(28, 24, true); // 24-bit BGR
        view.setUint32(30, 0, true);
        view.setUint32(34, (width * 3 + padding) * height, true);
        view.setInt32(38, 2835, true);
        view.setInt32(42, 2835, true);
        view.setUint32(46, 0, true);
        view.setUint32(50, 0, true);

        // Пиксельные данные BGR снизу вверх
        let offset = 54;
        for (let y = height - 1; y >= 0; y--) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                view.setUint8(offset++, data[i + 2]); // Blue
                view.setUint8(offset++, data[i + 1]); // Green
                view.setUint8(offset++, data[i]);     // Red
            }
            for (let p = 0; p < padding; p++) {
                view.setUint8(offset++, 0);
            }
        }

        return new Blob([buffer], { type: 'image/bmp' });
    }

    /**
     * Подписка на событие изменения статуса задачи (onStatusChange)
     */
    onStatusChange(taskIdOrCallback, callback) {
        if (typeof taskIdOrCallback === 'function') {
            this.addEventListener('statuschange', (e) => taskIdOrCallback(e.detail));
        } else if (typeof taskIdOrCallback === 'string' && typeof callback === 'function') {
            const task = this.tasks.get(taskIdOrCallback);
            if (task) {
                task.callbacks.add(callback);
            }
            this.addEventListener('statuschange', (e) => {
                if (e.detail.taskId === taskIdOrCallback) {
                    callback(e.detail);
                }
            });
        }
    }

    dispatchStatusChange(taskId, status, progress, message = '') {
        const eventDetail = { taskId, status, progress, message };
        this.dispatchEvent(new CustomEvent('statuschange', { detail: eventDetail }));
    }
}
