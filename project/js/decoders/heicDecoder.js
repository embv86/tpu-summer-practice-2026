/**
 * Декодер форматов изображений
 * Нативно поддерживает JPG, PNG, BMP через createImageBitmap / Canvas,
 * и обрабатывает файлы HEIC / HEIF с помощью динамической подгрузки декодера.
 */

export class ImageDecoder {
    /**
     * Проверяет, является ли файл форматом HEIC/HEIF
     */
    static isHEIC(file) {
        if (!file) return false;
        const name = (file.name || '').toLowerCase();
        const type = (file.type || '').toLowerCase();
        return name.endsWith('.heic') || name.endsWith('.heif') || type.includes('heic') || type.includes('heif');
    }

    /**
     * Декодирует любой поддерживаемый файл изображения (JPG, PNG, BMP, HEIC) в ImageData
     */
    static async decodeToImageData(file) {
        if (this.isHEIC(file)) {
            return await this.decodeHEIC(file);
        } else {
            return await this.decodeStandard(file);
        }
    }

    /**
     * Стандартное декодирование для JPG, PNG, BMP
     */
    static async decodeStandard(fileOrBlob) {
        let bitmap;
        if (typeof createImageBitmap !== 'undefined') {
            bitmap = await createImageBitmap(fileOrBlob);
        } else {
            bitmap = await this.blobToImageElement(fileOrBlob);
        }

        const width = bitmap.width;
        const height = bitmap.height;

        let canvas;
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(width, height);
        } else {
            canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
        }

        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, width, height);
    }

    /**
     * Декодирование файлов формата HEIC/HEIF
     */
    static async decodeHEIC(file) {
        // Проверка наличия библиотек heic2any в глобальной области или через динамический скрипт
        if (typeof window !== 'undefined' && window.heic2any) {
            const convertedBlob = await window.heic2any({ blob: file, toType: 'image/png' });
            const blobToUse = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
            return await this.decodeStandard(blobToUse);
        }

        // Динамическая подгрузка скрипта heic2any в среде браузера
        if (typeof document !== 'undefined') {
            try {
                await this.loadScript('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js');
                if (window.heic2any) {
                    const convertedBlob = await window.heic2any({ blob: file, toType: 'image/png' });
                    const blobToUse = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
                    return await this.decodeStandard(blobToUse);
                }
            } catch (err) {
                console.warn('Динамическая загрузка декодера HEIC не удалась:', err);
            }
        }

        // Резервный вариант: стандартное декодирование (в браузерах с нативной поддержкой HEIC, например Safari)
        try {
            return await this.decodeStandard(file);
        } catch (e) {
            throw new Error('Для декодирования HEIC требуется поддержка HEIC браузером или библиотека heic2any.');
        }
    }

    static loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    static blobToImageElement(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(blob);
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = (err) => {
                URL.revokeObjectURL(url);
                reject(err);
            };
            img.src = url;
        });
    }
}
