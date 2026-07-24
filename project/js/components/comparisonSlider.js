/**
 * ComparisonSlider Component
 * Displays clean dividing line over image with an interactive range slider control placed underneath.
 * Left side: Original Image ("Исходное")
 * Right side: ML Enhanced Image ("Улучшено ML")
 */

export class ComparisonSlider {
    constructor(containerElement, rangeInputElement = null) {
        this.container = containerElement;
        this.rangeInput = rangeInputElement;
        this.originalUrl = null;
        this.enhancedUrl = null;
        this.sliderPos = 50; // percentage
        this.isDragging = false;

        this.render();
        this.attachEvents();
    }

    render() {
        this.container.innerHTML = `
            <div class="comparison-wrapper" id="compWrapper">
                <span class="badge-label label-before">Исходное</span>
                <span class="badge-label label-after">Улучшено ML</span>

                <img class="comparison-img img-original" id="imgOriginal" alt="Исходное изображение" style="display: none;">
                <img class="comparison-img img-modified" id="imgEnhanced" alt="Улучшенное изображение ML" style="display: none;">

                <!-- Вертикальная линия разделения поверх изображения -->
                <div class="slider-line" id="sliderLine" style="display: none;"></div>

                <div class="empty-state" id="emptyState">
                    <h3>Изображение не загружено</h3>
                    <p>Загрузите файл (JPG, PNG, HEIC, BMP), чтобы увидеть автоматическое ML-улучшение в реальном времени.</p>
                </div>
            </div>
        `;

        this.wrapper = this.container.querySelector('#compWrapper');
        this.imgOriginal = this.container.querySelector('#imgOriginal');
        this.imgEnhanced = this.container.querySelector('#imgEnhanced');
        this.sliderLine = this.container.querySelector('#sliderLine');
        this.emptyState = this.container.querySelector('#emptyState');
    }

    setImages(originalSrc, enhancedSrc) {
        this.originalUrl = originalSrc;
        this.enhancedUrl = enhancedSrc;

        this.imgOriginal.src = originalSrc;
        this.imgEnhanced.src = enhancedSrc;

        this.emptyState.style.display = 'none';
        this.imgOriginal.style.display = 'block';
        this.imgEnhanced.style.display = 'block';
        this.sliderLine.style.display = 'block';

        if (this.rangeInput) {
            this.rangeInput.disabled = false;
            this.rangeInput.value = 50;
        }

        this.updateSliderPosition(50);
    }

    updateSliderPosition(percent) {
        this.sliderPos = Math.max(0, Math.min(100, percent));
        this.imgEnhanced.style.clipPath = `polygon(${this.sliderPos}% 0, 100% 0, 100% 100%, ${this.sliderPos}% 100%)`;
        this.sliderLine.style.left = `${this.sliderPos}%`;

        if (this.rangeInput && parseInt(this.rangeInput.value, 10) !== Math.round(this.sliderPos)) {
            this.rangeInput.value = Math.round(this.sliderPos);
        }
    }

    attachEvents() {
        if (this.rangeInput) {
            this.rangeInput.addEventListener('input', (e) => {
                this.updateSliderPosition(parseFloat(e.target.value));
            });
        }

        const onMove = (clientX) => {
            if (!this.isDragging) return;
            const rect = this.wrapper.getBoundingClientRect();
            const x = clientX - rect.left;
            const percent = (x / rect.width) * 100;
            this.updateSliderPosition(percent);
        };

        const startDragging = (e) => {
            this.isDragging = true;
            onMove(e.clientX || (e.touches && e.touches[0].clientX));
        };

        const stopDragging = () => {
            this.isDragging = false;
        };

        this.wrapper.addEventListener('mousedown', startDragging);
        window.addEventListener('mousemove', (e) => onMove(e.clientX));
        window.addEventListener('mouseup', stopDragging);

        this.wrapper.addEventListener('touchstart', startDragging, { passive: true });
        window.addEventListener('touchmove', (e) => {
            if (e.touches && e.touches[0]) onMove(e.touches[0].clientX);
        }, { passive: true });
        window.addEventListener('touchend', stopDragging);
    }
}
