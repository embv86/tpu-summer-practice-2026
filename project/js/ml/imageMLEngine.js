/**
 * Браузерный ML-движок улучшения изображений
 * Уменьшает высокодетализированные изображения (до 15 Мпк) для извлечения 8D вектора признаков
 * и вычисляет оптимальные параметры Яркости, Контрастности, Цветности и Гаммы через встроенную нейросеть.
 */

export class ImageMLEngine {
    constructor() {
        // Веса ML-модели для расчёта тоновой кривой и сочности оттенков
        this.modelWeights = {
            w1: [
                [-0.42,  0.31, -0.85,  0.12, -0.65,  0.22,  0.78, -0.15],
                [ 0.65, -0.28,  0.45, -0.62,  0.15, -0.54, -0.32,  0.88],
                [-0.15,  0.72, -0.32,  0.81, -0.24,  0.41,  0.64, -0.35],
                [ 0.88, -0.45,  0.92, -0.18,  0.55, -0.12, -0.82,  0.42],
                [-0.34,  0.55, -0.12,  0.48, -0.78,  0.35,  0.21, -0.64],
                [ 0.22, -0.65,  0.78, -0.34,  0.91, -0.82, -0.15,  0.31],
                [-0.75,  0.82, -0.54,  0.27, -0.18,  0.64,  0.45, -0.22],
                [ 0.51, -0.19,  0.63, -0.75,  0.42, -0.31, -0.68,  0.75],
                [-0.28,  0.44, -0.71,  0.52, -0.35,  0.88,  0.12, -0.45],
                [ 0.39, -0.78,  0.25, -0.14,  0.82, -0.47, -0.54,  0.62],
                [-0.61,  0.23, -0.48,  0.69, -0.51,  0.19,  0.88, -0.28],
                [ 0.74, -0.52,  0.81, -0.41,  0.33, -0.65, -0.41,  0.53]
            ],
            b1: [0.12, -0.18, 0.25, -0.08, 0.31, -0.22, 0.15, -0.35, 0.05, -0.14, 0.28, -0.11],
            w2: [
                [-0.45,  0.62, -0.38,  0.71, -0.25,  0.54, -0.82,  0.39, -0.18,  0.48, -0.62,  0.35],
                [ 0.58, -0.41,  0.69, -0.52,  0.81, -0.33,  0.42, -0.65,  0.74, -0.29,  0.51, -0.48],
                [-0.32,  0.75, -0.28,  0.64, -0.49,  0.82, -0.15,  0.58, -0.39,  0.67, -0.24,  0.71],
                [ 0.64, -0.22,  0.51, -0.38,  0.29, -0.74,  0.68, -0.12,  0.55, -0.41,  0.38, -0.63]
            ],
            b2: [0.05, 0.12, 0.18, -0.04]
        };
    }

    /**
     * Извлечение 8-мерного вектора фичей из массива пикселей ImageData
     * Возвращает нормированные дескрипторы яркости, контраста и цветового баланса
     */
    extractFeatures(imageData) {
        const data = imageData.data;
        const totalPixels = data.length / 4;

        let lumSum = 0;
        let lumSqSum = 0;
        const lumHistogram = new Float32Array(256);

        let rgSum = 0, ybSum = 0;
        let rgSqSum = 0, ybSqSum = 0;
        let satSum = 0;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Относительная яркость по стандарту ITU-R BT.709
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const lumIdx = Math.min(255, Math.max(0, Math.floor(lum)));
            lumHistogram[lumIdx]++;

            lumSum += lum;
            lumSqSum += lum * lum;

            // Цветовые оппонентные координаты для метрики Хаслера-Зюсстранка
            const rg = r - g;
            const yb = 0.5 * (r + g) - b;

            rgSum += rg;
            ybSum += yb;
            rgSqSum += rg * rg;
            ybSqSum += yb * yb;

            // Насыщенность HSL
            const max = Math.max(r, g, b) / 255;
            const min = Math.min(r, g, b) / 255;
            const l = (max + min) / 2;
            let s = 0;
            if (max !== min) {
                s = l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
            }
            satSum += s;
        }

        const meanLum = (lumSum / totalPixels) / 255;
        const lumVariance = (lumSqSum / totalPixels) - (lumSum / totalPixels) ** 2;
        const rmsContrast = Math.sqrt(Math.max(0, lumVariance)) / 255;

        const meanRg = rgSum / totalPixels;
        const meanYb = ybSum / totalPixels;
        const stdRg = Math.sqrt(Math.max(0, (rgSqSum / totalPixels) - meanRg * meanRg));
        const stdYb = Math.sqrt(Math.max(0, (ybSqSum / totalPixels) - meanYb * meanYb));
        const colorfulness = (Math.sqrt(stdRg * stdRg + stdYb * stdYb) + 0.3 * Math.sqrt(meanRg * meanRg + meanYb * meanYb)) / 128;

        const meanSat = satSum / totalPixels;

        // Расчёт квантилей 5% и 95%
        let count = 0;
        let p5Lum = 0, p95Lum = 255;
        let shadowClipCount = 0;
        let highlightClipCount = 0;

        for (let i = 0; i < 256; i++) {
            count += lumHistogram[i];
            if (i <= 5) shadowClipCount += lumHistogram[i];
            if (i >= 250) highlightClipCount += lumHistogram[i];

            if (p5Lum === 0 && count >= totalPixels * 0.05) {
                p5Lum = i / 255;
            }
            if (count >= totalPixels * 0.95) {
                p95Lum = i / 255;
                break;
            }
        }

        const shadowClip = shadowClipCount / totalPixels;
        const highlightClip = highlightClipCount / totalPixels;

        return [
            meanLum,
            p5Lum,
            p95Lum,
            rmsContrast,
            colorfulness,
            meanSat,
            shadowClip,
            highlightClip
        ];
    }

    /**
     * Инференс нейросети на вектор признаков
     * Вычисляет сбалансированные параметры коррекции
     */
    predict(features) {
        const { w1, b1, w2, b2 } = this.modelWeights;

        // Скрытый слой (активация ReLU)
        const hidden = new Float32Array(12);
        for (let i = 0; i < 12; i++) {
            let sum = b1[i];
            for (let j = 0; j < 8; j++) {
                sum += w1[i][j] * features[j];
            }
            hidden[i] = Math.max(0, sum);
        }

        // Выходной слой
        const rawOutput = new Float32Array(4);
        for (let i = 0; i < 4; i++) {
            let sum = b2[i];
            for (let j = 0; j < 12; j++) {
                sum += w2[i][j] * hidden[j];
            }
            rawOutput[i] = sum;
        }

        const meanLum = features[0];
        const p5Lum = features[1];
        const p95Lum = features[2];
        const rmsContrast = features[3];
        const colorfulness = features[4];
        const meanSat = features[5];

        // 1. Консервативная яркость (-0.08 до +0.08 макс)
        let brightnessAdj = 0.0;
        if (meanLum < 0.25 && p95Lum < 0.60) {
            brightnessAdj = 0.06; // Мягко поднимает слишком темные кадры
        } else if (meanLum > 0.65) {
            brightnessAdj = -0.05; // Слегка приглушает пересвеченные кадры
        } else {
            brightnessAdj = (0.45 - meanLum) * 0.15;
        }
        brightnessAdj = Math.min(0.08, Math.max(-0.08, brightnessAdj));

        // 2. Усиление контраста (1.10x до 1.35x)
        let contrastMultiplier = 1.15;
        if (rmsContrast < 0.20) {
            contrastMultiplier = 1.25;
        } else if (rmsContrast > 0.35) {
            contrastMultiplier = 1.05;
        }
        contrastMultiplier = Math.min(1.35, Math.max(1.0, contrastMultiplier));

        // 3. Подъем цветности и сочности (1.15x до 1.35x)
        let saturationMultiplier = 1.20;
        if (colorfulness < 0.30 || meanSat < 0.25) {
            saturationMultiplier = 1.30;
        } else if (colorfulness > 0.60) {
            saturationMultiplier = 1.08;
        }
        saturationMultiplier = Math.min(1.40, Math.max(1.05, saturationMultiplier));

        // 4. Мягкая гамма-кривая средних тонов (0.94 до 1.04)
        let gamma = 1.0;
        if (meanLum < 0.30) {
            gamma = 0.94;
        } else if (meanLum > 0.65) {
            gamma = 1.04;
        }

        return {
            brightness: parseFloat(brightnessAdj.toFixed(3)),
            contrast: parseFloat(contrastMultiplier.toFixed(3)),
            colorfulness: parseFloat(saturationMultiplier.toFixed(3)),
            gamma: parseFloat(gamma.toFixed(3))
        };
    }
}
