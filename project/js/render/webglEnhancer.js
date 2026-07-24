/**
 * Модуль ускоренного улучшения изображений через WebGL-шейдер на GPU
 * Автоматический фоллбек на OffscreenCanvas 2D / Canvas ImageData при отсутствии поддержки WebGL.
 * Эффективно обрабатывает высокодетализированные изображения до 15 Мпк.
 */

export class WebGLEnhancer {
    constructor(canvas = null) {
        this.canvas = canvas || (typeof OffscreenCanvas !== 'undefined' 
            ? new OffscreenCanvas(1, 1) 
            : document.createElement('canvas'));

        this.gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true }) || 
                  this.canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });

        if (this.gl) {
            this.initWebGL();
        }
    }

    initWebGL() {
        const gl = this.gl;

        // Вершинный шейдер WebGL
        const vsSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = vec2(a_texCoord.x, 1.0 - a_texCoord.y); // Переворот оси Y для корректной ориентации Canvas
            }
        `;

        // Фрагментный шейдер WebGL (Коррекция яркости, контрастности, гаммы и цветности)
        const fsSource = `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform sampler2D u_image;
            uniform float u_brightness;
            uniform float u_contrast;
            uniform float u_saturation;
            uniform float u_gamma;

            void main() {
                vec4 color = texture2D(u_image, v_texCoord);
                vec3 rgb = color.rgb;

                // 1. Коррекция яркости
                rgb += u_brightness;

                // 2. Коррекция контрастности относительно середины (0.5)
                rgb = (rgb - 0.5) * u_contrast + 0.5;

                // 3. Гамма-коррекция средних тонов
                rgb = pow(max(rgb, vec3(0.0)), vec3(1.0 / u_gamma));

                // 4. Коррекция цветности и насыщенности
                float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
                rgb = mix(vec3(lum), rgb, u_saturation);

                gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
            }
        `;

        const vertexShader = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fragmentShader = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);

        this.program = gl.createProgram();
        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.warn('Ошибка инициализации программы WebGL:', gl.getProgramInfoLog(this.program));
            this.gl = null;
            return;
        }

        // Инициализация буфера геометрии
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1.0, -1.0,  0.0, 0.0,
             1.0, -1.0,  1.0, 0.0,
            -1.0,  1.0,  0.0, 1.0,
            -1.0,  1.0,  0.0, 1.0,
             1.0, -1.0,  1.0, 0.0,
             1.0,  1.0,  1.0, 1.0,
        ]), gl.STATIC_DRAW);

        this.positionLoc = gl.getAttribLocation(this.program, 'a_position');
        this.texCoordLoc = gl.getAttribLocation(this.program, 'a_texCoord');

        this.uBrightnessLoc = gl.getUniformLocation(this.program, 'u_brightness');
        this.uContrastLoc = gl.getUniformLocation(this.program, 'u_contrast');
        this.uSaturationLoc = gl.getUniformLocation(this.program, 'u_saturation');
        this.uGammaLoc = gl.getUniformLocation(this.program, 'u_gamma');
        this.uImageLoc = gl.getUniformLocation(this.program, 'u_image');

        this.texture = gl.createTexture();
    }

    createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Ошибка компиляции шейдера: ' + info);
        }
        return shader;
    }

    /**
     * Запуск обработки изображения с переданными ML-параметрами
     * Возвращает обработанный ImageData
     */
    process(imageSource, params) {
        const width = imageSource.width;
        const height = imageSource.height;

        this.canvas.width = width;
        this.canvas.height = height;

        if (this.gl) {
            return this.processWebGL(imageSource, params, width, height);
        } else {
            return this.processCanvas2D(imageSource, params, width, height);
        }
    }

    processWebGL(imageSource, params, width, height) {
        const gl = this.gl;
        gl.viewport(0, 0, width, height);
        gl.useProgram(this.program);

        // Загрузка текстуры в видеопамять
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        if (imageSource instanceof ImageData) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageSource);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageSource);
        }

        // Подключение атрибутов шейдера
        const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
        gl.enableVertexAttribArray(this.positionLoc);
        gl.vertexAttribPointer(this.positionLoc, 2, gl.FLOAT, false, stride, 0);

        gl.enableVertexAttribArray(this.texCoordLoc);
        gl.vertexAttribPointer(this.texCoordLoc, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

        // Установка переданных ML-параметров
        gl.uniform1f(this.uBrightnessLoc, params.brightness);
        gl.uniform1f(this.uContrastLoc, params.contrast);
        gl.uniform1f(this.uSaturationLoc, params.colorfulness);
        gl.uniform1f(this.uGammaLoc, params.gamma);
        gl.uniform1i(this.uImageLoc, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Извлечение обработанного пиксельного массива
        const pixels = new Uint8ClampedArray(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // Переворот массива по вертикали (вывод readPixels идет снизу вверх)
        const flippedPixels = new Uint8ClampedArray(width * height * 4);
        const rowBytes = width * 4;
        for (let row = 0; row < height; row++) {
            const sRow = row;
            const dRow = height - 1 - row;
            flippedPixels.set(
                pixels.subarray(sRow * rowBytes, (sRow + 1) * rowBytes),
                dRow * rowBytes
            );
        }

        return new ImageData(flippedPixels, width, height);
    }

    // Фоллбек-обработка через Canvas 2D в случае отсутствия поддержки WebGL
    processCanvas2D(imageSource, params, width, height) {
        const ctx = this.canvas.getContext('2d');
        if (imageSource instanceof ImageData) {
            ctx.putImageData(imageSource, 0, 0);
        } else {
            ctx.drawImage(imageSource, 0, 0);
        }

        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        const bright = params.brightness * 255;
        const contrast = params.contrast;
        const sat = params.colorfulness;
        const invGamma = 1.0 / params.gamma;

        const factor = contrast;

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];

            // Яркость
            r += bright;
            g += bright;
            b += bright;

            // Контрастность относительно 128
            r = (r - 128) * factor + 128;
            g = (g - 128) * factor + 128;
            b = (b - 128) * factor + 128;

            // Гамма
            if (invGamma !== 1.0) {
                r = 255 * Math.pow(Math.max(0, r / 255), invGamma);
                g = 255 * Math.pow(Math.max(0, g / 255), invGamma);
                b = 255 * Math.pow(Math.max(0, b / 255), invGamma);
            }

            // Насыщенность
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            r = lum + sat * (r - lum);
            g = lum + sat * (g - lum);
            b = lum + sat * (b - lum);

            data[i]     = Math.min(255, Math.max(0, r));
            data[i + 1] = Math.min(255, Math.max(0, g));
            data[i + 2] = Math.min(255, Math.max(0, b));
        }

        return imgData;
    }
}
