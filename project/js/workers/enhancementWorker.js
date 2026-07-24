/**
 * Web Worker для асинхронного улучшения изображений в реальном времени
 * Выполняет извлечение признаков, ML-инференс и рендеринг вне основного потока UI.
 */

import { ImageMLEngine } from '../ml/imageMLEngine.js';
import { WebGLEnhancer } from '../render/webglEnhancer.js';

const mlEngine = new ImageMLEngine();
let enhancer = null;

// Отслеживание активных и прерванных задач
const activeTasks = new Map();
const abortedTasks = new Set();

self.onmessage = async (e) => {
    const { action, taskId, payload } = e.data;

    if (action === 'ABORT') {
        abortedTasks.add(taskId);
        activeTasks.delete(taskId);
        self.postMessage({
            taskId,
            status: 'aborted',
            progress: 0,
            message: 'Задача прервана по запросу пользователя'
        });
        return;
    }

    if (action === 'PROCESS') {
        abortedTasks.delete(taskId);
        activeTasks.set(taskId, true);

        try {
            // 1. Задача в очереди
            notifyStatus(taskId, 'pending', 5, 'Задача поставлена в очередь');
            if (isAborted(taskId)) return;

            const startTime = performance.now();
            const { imageData } = payload;
            const width = imageData.width;
            const height = imageData.height;

            // 2. Извлечение фичей и гистограммы
            notifyStatus(taskId, 'processing', 20, 'Анализ гистограмм и цветовых характеристик...');
            if (isAborted(taskId)) return;

            const downsampledData = downsampleImageData(imageData, 256, 256);
            const features = mlEngine.extractFeatures(downsampledData);

            // 3. ML-инференс
            notifyStatus(taskId, 'processing', 45, 'Расчёт оптимальных параметров ML-моделью...');
            if (isAborted(taskId)) return;

            const params = mlEngine.predict(features);

            // 4. Применение рендеринга (WebGL / OffscreenCanvas)
            notifyStatus(taskId, 'processing', 70, 'Применение яркости, контрастности и цветности на GPU...');
            if (isAborted(taskId)) return;

            if (!enhancer) {
                enhancer = new WebGLEnhancer();
            }

            const resultImageData = enhancer.process(imageData, params);

            if (isAborted(taskId)) return;

            const totalTimeMs = Math.round(performance.now() - startTime);

            // 5. Завершение
            activeTasks.delete(taskId);
            self.postMessage({
                taskId,
                status: 'completed',
                progress: 100,
                result: resultImageData,
                metrics: {
                    executionTimeMs: totalTimeMs,
                    megapixels: parseFloat(((width * height) / 1000000).toFixed(2)),
                    width,
                    height,
                    params
                }
            });

        } catch (error) {
            activeTasks.delete(taskId);
            self.postMessage({
                taskId,
                status: 'failed',
                progress: 0,
                error: error.message || 'Неизвестная ошибка обработки'
            });
        }
    }
};

function notifyStatus(taskId, status, progress, message = '') {
    if (abortedTasks.has(taskId)) return;
    self.postMessage({
        taskId,
        status,
        progress,
        message
    });
}

function isAborted(taskId) {
    if (abortedTasks.has(taskId)) {
        activeTasks.delete(taskId);
        abortedTasks.delete(taskId);
        return true;
    }
    return false;
}

/**
 * Уменьшает разрешение ImageData для быстрого извлечения фичей ML-моделью
 */
function downsampleImageData(srcImageData, targetWidth, targetHeight) {
    const srcWidth = srcImageData.width;
    const srcHeight = srcImageData.height;

    if (srcWidth <= targetWidth && srcHeight <= targetHeight) {
        return srcImageData;
    }

    const srcData = srcImageData.data;
    const dstData = new Uint8ClampedArray(targetWidth * targetHeight * 4);

    const xRatio = srcWidth / targetWidth;
    const yRatio = srcHeight / targetHeight;

    for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
            const srcX = Math.floor(x * xRatio);
            const srcY = Math.floor(y * yRatio);

            const srcIdx = (srcY * srcWidth + srcX) * 4;
            const dstIdx = (y * targetWidth + x) * 4;

            dstData[dstIdx]     = srcData[srcIdx];
            dstData[dstIdx + 1] = srcData[srcIdx + 1];
            dstData[dstIdx + 2] = srcData[srcIdx + 2];
            dstData[dstIdx + 3] = srcData[srcIdx + 3];
        }
    }

    return new ImageData(dstData, targetWidth, targetHeight);
}
