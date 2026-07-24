/**
 * ImageEnhancerAPI
 * Единый интерфейс API для асинхронной обработки и улучшения изображений.
 * 
 * Обязательные методы API:
 * - submitTask(inputImage): Метод постановки задачи (возвращает taskId)
 * - getStatus(taskId): Метод получения статуса и прогресса выполнения
 * - abortTask(taskId): Метод прерывания задачи
 * - getResult(taskId): Метод получения готового изображения
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
            // Создание экземпляра фонового Web Worker
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

                // Генерация кастомного события onStatusChange
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

                // Вызов обратных вызовов подписки
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

            // Проверка ограничения разрешения (до 15-20 Мпк)
            const megapixels = (imageData.width * imageData.height) / 1000000;
            if (megapixels > 20) {
                throw new Error(`Разрешение кадра (${megapixels.toFixed(1)} Мпк) превышает максимально допустимый лимит (15-20 Мпк).`);
            }

            // Передача задачи на исполнение в фоновый поток Web Worker
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
     * Принимает taskId, возвращает готовое изображение (ImageData или Blob)
     */
    async getResult(taskId, format = 'imageData') {
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

        // Если задача еще выполняется, ожидаем завершения асинхронно
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

        if (format === 'imageData') {
            return imageData;
        } else if (format === 'blob' || format === 'canvas') {
            const canvas = document.createElement('canvas');
            canvas.width = imageData.width;
            canvas.height = imageData.height;
            const ctx = canvas.getContext('2d');
            ctx.putImageData(imageData, 0, 0);

            if (format === 'canvas') return canvas;

            return new Promise((resolve) => {
                canvas.toBlob((blob) => resolve(blob), 'image/png');
            });
        }

        return imageData;
    }

    /**
     * Подписка на событие изменения статуса задачи (onStatusChange)
     */
    onStatusChange(taskIdOrCallback, callback) {
        if (typeof taskIdOrCallback === 'function') {
            // Глобальный слушатель для всех задач
            this.addEventListener('statuschange', (e) => taskIdOrCallback(e.detail));
        } else if (typeof taskIdOrCallback === 'string' && typeof callback === 'function') {
            // Слушатель для конкретного taskId
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
