// ==UserScript==
// @name         ArcheAge Universal Tool (Cart + Pins)
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Автоматическая отправка предметов из корзины и активация пин-кодов с единым интерфейсом
// @author       You
// @match        https://archeage.ru/cart*
// @match        https://archeage.ru/pin/activate/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // Определение текущей страницы
    const isCartPage = window.location.href.includes('/cart');
    const isPinPage = window.location.href.includes('/pin/activate');

    // Конфигурация
    const CONFIG = {
        cart: {
            batchSize: 5,
            delayBetweenBatches: 2000,
            apiUrl: 'https://archeage.ru/dynamic/cart/?a=item_process'
        },
        pin: {
            delayBetweenPins: 2000,
            apiUrl: 'https://archeage.ru/dynamic/pin/?a=activate'
        }
    };

    // Состояние
    let state = {
        cart: {
            selectedItems: new Set(),
            isSending: false,
            shouldStop: false,
            isCollapsed: false
        },
        pin: {
            isRunning: false,
            shouldStop: false,
            processedCount: 0,
            totalCount: 0,
            isCollapsed: false
        }
    };

    // Общие стили
    GM_addStyle(`
        #aa-tool-panel {
            position: fixed;
            top: 100px;
            right: 20px;
            width: 380px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 2px solid #e94560;
            border-radius: 12px;
            padding: 0;
            color: #fff;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            z-index: 99999;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
            transition: all 0.3s ease;
            max-height: 90vh;
            overflow: hidden;
        }
        #aa-tool-panel.collapsed {
            width: auto;
            min-width: 180px;
        }
        #aa-tool-panel.collapsed .aa-tool-content {
            display: none;
        }
        #aa-tool-panel.collapsed .aa-tool-header {
            border-bottom: none;
            margin: 0;
            padding: 10px 15px;
        }
        .aa-tool-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 20px;
            border-bottom: 1px solid #e94560;
            margin-bottom: 0;
            cursor: pointer;
            user-select: none;
            background: rgba(0,0,0,0.2);
            border-radius: 10px 10px 0 0;
        }
        .aa-tool-header h3 {
            margin: 0;
            color: #e94560;
            font-size: 18px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .aa-tool-toggle {
            background: none;
            border: none;
            color: #e94560;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: all 0.2s;
        }
        .aa-tool-toggle:hover {
            background: rgba(233, 69, 96, 0.2);
        }
        .aa-tool-content {
            padding: 15px 20px 20px 20px;
            max-height: calc(90vh - 60px);
            overflow-y: auto;
        }
        .aa-tool-section {
            margin-bottom: 15px;
        }
        .aa-tool-section label {
            display: block;
            margin-bottom: 5px;
            font-size: 12px;
            color: #aaa;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .aa-tool-btn {
            width: 100%;
            padding: 10px;
            margin: 5px 0;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: bold;
            transition: all 0.3s;
            outline: none !important;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
        }
        .aa-tool-btn:focus {
            outline: none !important;
            box-shadow: 0 0 0 2px rgba(233, 69, 96, 0.5);
        }
        .aa-tool-btn.primary {
            background: #e94560;
            color: white;
        }
        .aa-tool-btn.primary:hover:not(:disabled) {
            background: #ff6b6b;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(233, 69, 96, 0.4);
        }
        .aa-tool-btn.secondary {
            background: #0f3460;
            color: white;
        }
        .aa-tool-btn.secondary:hover:not(:disabled) {
            background: #1a4a7a;
        }
        .aa-tool-btn.danger {
            background: #c0392b;
            color: white;
        }
        .aa-tool-btn.danger:hover:not(:disabled) {
            background: #e74c3c;
        }
        .aa-tool-btn.success {
            background: #27ae60;
            color: white;
        }
        .aa-tool-btn.success:hover:not(:disabled) {
            background: #2ecc71;
        }
        .aa-tool-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .aa-tool-select {
            width: 100%;
            padding: 8px;
            border-radius: 6px;
            border: 1px solid #e94560;
            background: #0f3460;
            color: white;
            font-size: 13px;
            outline: none;
        }
        .aa-tool-select:focus {
            box-shadow: 0 0 0 2px rgba(233, 69, 96, 0.3);
        }
        .aa-tool-stats {
            background: rgba(0,0,0,0.3);
            padding: 10px;
            border-radius: 6px;
            margin-top: 10px;
            font-size: 12px;
        }
        .aa-tool-stats div {
            display: flex;
            justify-content: space-between;
            margin: 3px 0;
        }
        .aa-tool-progress {
            width: 100%;
            height: 20px;
            background: #0f3460;
            border-radius: 10px;
            overflow: hidden;
            margin-top: 10px;
        }
        .aa-tool-progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #e94560, #ff6b6b);
            transition: width 0.3s;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: bold;
        }
        .aa-tool-log {
            max-height: 150px;
            overflow-y: auto;
            background: rgba(0,0,0,0.3);
            padding: 8px;
            border-radius: 6px;
            margin-top: 10px;
            font-size: 11px;
            font-family: 'Courier New', monospace;
            border: 1px solid rgba(233, 69, 96, 0.3);
        }
        .aa-tool-log .success {
            color: #2ecc71;
        }
        .aa-tool-log .error {
            color: #e74c3c;
        }
        .aa-tool-log .info {
            color: #3498db;
        }
        .aa-tool-log .warning {
            color: #f39c12;
        }
        .select-up-to-container {
            display: flex;
            gap: 5px;
            margin-top: 5px;
        }
        .select-up-to-container input {
            flex: 1;
            padding: 8px;
            border-radius: 6px;
            border: 1px solid #e94560;
            background: #0f3460;
            color: white;
            font-size: 13px;
            outline: none;
        }
        .select-up-to-container input:focus {
            box-shadow: 0 0 0 2px rgba(233, 69, 96, 0.3);
        }
        .file-input-wrapper {
            position: relative;
            overflow: hidden;
            display: inline-block;
            width: 100%;
        }
        .file-input-wrapper input[type=file] {
            position: absolute;
            left: -9999px;
        }
        .pin-list-container {
            max-height: 200px;
            overflow-y: auto;
            background: rgba(0,0,0,0.2);
            border-radius: 6px;
            padding: 10px;
            margin-top: 10px;
            border: 1px solid rgba(233, 69, 96, 0.2);
        }
        .pin-item {
            padding: 5px;
            margin: 2px 0;
            border-radius: 4px;
            font-size: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .pin-item.pending {
            background: rgba(255, 255, 255, 0.1);
            border-left: 3px solid #3498db;
        }
        .pin-item.success {
            background: rgba(46, 204, 113, 0.2);
            border-left: 3px solid #2ecc71;
        }
        .pin-item.error {
            background: rgba(231, 76, 60, 0.2);
            border-left: 3px solid #e74c3c;
        }
        .pin-item.processing {
            background: rgba(233, 69, 96, 0.2);
            border-left: 3px solid #e94560;
            animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.7; }
            100% { opacity: 1; }
        }
        /* Стили для кликабельных строк таблицы корзины */
        .js-cart-item {
            cursor: pointer !important;
            transition: background-color 0.2s;
        }
        .js-cart-item:hover {
            background-color: rgba(233, 69, 96, 0.15) !important;
        }
        .js-cart-item.selected-row {
            background-color: rgba(233, 69, 96, 0.25) !important;
        }
        .js-cart-item.selected-row td {
            color: #ff8a9b !important;
        }
        .js-cart-item.selected-row .js-cart-item-name {
            font-weight: bold;
        }
        input:invalid,
        input:-moz-ui-invalid,
        input:-webkit-autofill,
        input:focus:invalid {
            box-shadow: none !important;
            outline: none !important;
        }
        /* Скроллбар для темной темы */
        .aa-tool-content::-webkit-scrollbar,
        .aa-tool-log::-webkit-scrollbar,
        .pin-list-container::-webkit-scrollbar {
            width: 8px;
        }
        .aa-tool-content::-webkit-scrollbar-track,
        .aa-tool-log::-webkit-scrollbar-track,
        .pin-list-container::-webkit-scrollbar-track {
            background: rgba(0,0,0,0.2);
            border-radius: 4px;
        }
        .aa-tool-content::-webkit-scrollbar-thumb,
        .aa-tool-log::-webkit-scrollbar-thumb,
        .pin-list-container::-webkit-scrollbar-thumb {
            background: #e94560;
            border-radius: 4px;
        }
        .aa-tool-content::-webkit-scrollbar-thumb:hover,
        .aa-tool-log::-webkit-scrollbar-thumb:hover,
        .pin-list-container::-webkit-scrollbar-thumb:hover {
            background: #ff6b6b;
        }
    `);

    // ==================== CART FUNCTIONS ====================

    function getCartItems() {
        const items = [];
        const rows = document.querySelectorAll('.js-cart-item');
        rows.forEach((row, index) => {
            const checkbox = row.querySelector('.js-cart-item-input');
            const nameCell = row.querySelector('.js-cart-item-name');
            if (checkbox && nameCell) {
                items.push({
                    id: checkbox.getAttribute('data-item'),
                    name: nameCell.textContent.trim(),
                    checkbox: checkbox,
                    row: row,
                    index: index
                });
            }
        });
        return items;
    }

    function getCharacters() {
        const chars = [];
        document.querySelectorAll('.js-char').forEach(label => {
            const input = label.querySelector('input[name="shard_char"]');
            const nameSpan = label.querySelector('.name');
            const infoSpan = label.querySelector('.info');
            if (input && nameSpan && !input.disabled) {
                chars.push({
                    value: input.value,
                    name: nameSpan.textContent.trim(),
                    info: infoSpan ? infoSpan.textContent.trim() : '',
                    element: input
                });
            }
        });
        return chars;
    }

    function updateRowHighlighting() {
        getCartItems().forEach(item => {
            if (item.checkbox.checked) {
                item.row.classList.add('selected-row');
            } else {
                item.row.classList.remove('selected-row');
            }
        });
    }

    function log(message, type = 'info', containerId = 'aa-tool-log') {
        const logContainer = document.getElementById(containerId);
        if (logContainer) {
            const entry = document.createElement('div');
            entry.className = type;
            entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
            logContainer.insertBefore(entry, logContainer.firstChild);
            if (logContainer.children.length > 50) {
                logContainer.removeChild(logContainer.lastChild);
            }
        }
        console.log(`[ArcheAgeTool] ${message}`);
    }

    function updateStats() {
        const items = getCartItems();
        const selected = items.filter(item => item.checkbox.checked);
        const totalEl = document.getElementById('cart-total');
        const selectedEl = document.getElementById('cart-selected');
        const batchesEl = document.getElementById('cart-batches');
        if (totalEl) totalEl.textContent = items.length;
        if (selectedEl) selectedEl.textContent = selected.length;
        if (batchesEl) batchesEl.textContent = Math.ceil(selected.length / CONFIG.cart.batchSize);
    }

    function selectAll() {
        getCartItems().forEach(item => item.checkbox.checked = true);
        updateRowHighlighting();
        updateStats();
        log('Выбраны все предметы', 'success');
    }

    function deselectAll() {
        getCartItems().forEach(item => item.checkbox.checked = false);
        updateRowHighlighting();
        updateStats();
        log('Выбор снят со всех предметов', 'info');
    }

    function selectUpTo(index) {
        const items = getCartItems();
        items.forEach((item, i) => {
            item.checkbox.checked = i < index;
        });
        updateRowHighlighting();
        updateStats();
        log(`Выбраны предметы от 1 до ${index}`, 'success');
    }

    function invertSelection() {
        getCartItems().forEach(item => {
            item.checkbox.checked = !item.checkbox.checked;
        });
        updateRowHighlighting();
        updateStats();
        log('Выбор инвертирован', 'info');
    }

    function togglePanel() {
        const panel = document.getElementById('aa-tool-panel');
        const toggleBtn = document.getElementById('aa-tool-toggle-btn');
        if (!panel || !toggleBtn) return;

        const currentState = isCartPage ? state.cart : state.pin;
        currentState.isCollapsed = !currentState.isCollapsed;

        if (currentState.isCollapsed) {
            panel.classList.add('collapsed');
            toggleBtn.textContent = '▶';
            toggleBtn.title = 'Развернуть';
        } else {
            panel.classList.remove('collapsed');
            toggleBtn.textContent = '◀';
            toggleBtn.title = 'Свернуть';
        }
    }

    async function sendCartBatch(itemIds, charValue) {
        const formData = new URLSearchParams();
        itemIds.forEach(id => formData.append(`items[${id}]`, 'on'));
        formData.append('shard_char', charValue);

        try {
            const response = await fetch(CONFIG.cart.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json, text/javascript, */*; q=0.01'
                },
                body: formData.toString(),
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async function startCartSending() {
        if (state.cart.isSending) return;

        const charSelect = document.getElementById('cart-char-select');
        const charValue = charSelect ? charSelect.value : '';

        if (!charValue) {
            alert('Выберите персонажа для отправки!');
            return;
        }

        const items = getCartItems().filter(item => item.checkbox.checked);
        if (items.length === 0) {
            alert('Выберите хотя бы один предмет!');
            return;
        }

        state.cart.isSending = true;
        state.cart.shouldStop = false;
        updateCartUIState();

        const totalItems = items.length;
        const batches = [];

        for (let i = 0; i < items.length; i += CONFIG.cart.batchSize) {
            batches.push(items.slice(i, i + CONFIG.cart.batchSize));
        }

        log(`Начинаем отправку ${totalItems} предметов (${batches.length} пачек)`, 'info');

        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < batches.length; i++) {
            if (state.cart.shouldStop) {
                log('Отправка прервана пользователем', 'error');
                break;
            }

            const batch = batches[i];
            const itemIds = batch.map(item => item.id);

            log(`Отправка пачки ${i + 1}/${batches.length}: ${batch.length} предметов...`, 'info');

            const result = await sendCartBatch(itemIds, charValue);

            if (result.success) {
                successCount += batch.length;
                log(`✓ Пачка ${i + 1} отправлена успешно`, 'success');

                // Удаляем отправленные предметы из таблицы
                batch.forEach(item => {
                    item.checkbox.checked = false;
                    if (item.row && item.row.parentNode) {
                        item.row.remove();
                    }
                });
            } else {
                errorCount += batch.length;
                log(`✗ Ошибка отправки пачки ${i + 1}: ${result.error}`, 'error');
            }

            updateRowHighlighting();

            const progressBar = document.getElementById('aa-tool-progress-bar');
            if (progressBar) {
                const progress = ((i + 1) / batches.length) * 100;
                progressBar.style.width = `${progress}%`;
                progressBar.textContent = `${Math.round(progress)}%`;
            }

            if (i < batches.length - 1 && !state.cart.shouldStop) {
                log(`Ожидание ${CONFIG.cart.delayBetweenBatches/1000} сек...`, 'info');
                await new Promise(resolve => setTimeout(resolve, CONFIG.cart.delayBetweenBatches));
            }
        }

        state.cart.isSending = false;
        updateCartUIState();
        updateStats();

        log(`Отправка завершена. Успешно: ${successCount}, Ошибок: ${errorCount}`, successCount > 0 ? 'success' : 'error');
        // Убран alert, только логирование
    }

    function stopCartSending() {
        state.cart.shouldStop = true;
        log('Остановка отправки...', 'error');
    }

    function updateCartUIState() {
        const sendBtn = document.getElementById('cart-send-btn');
        const stopBtn = document.getElementById('cart-stop-btn');

        if (state.cart.isSending) {
            if (sendBtn) sendBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'flex';
        } else {
            if (sendBtn) sendBtn.style.display = 'flex';
            if (stopBtn) stopBtn.style.display = 'none';

            const progressBar = document.getElementById('aa-tool-progress-bar');
            if (progressBar) {
                progressBar.style.width = '0%';
                progressBar.textContent = '';
            }
        }
    }

    function setupCartEventListeners() {
        const toggleBtn = document.getElementById('aa-tool-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                togglePanel();
            });
        }

        const header = document.querySelector('.aa-tool-header');
        if (header) {
            header.addEventListener('click', (e) => {
                if (e.target === header || e.target.tagName === 'H3') {
                    togglePanel();
                }
            });
        }

        document.getElementById('cart-select-all')?.addEventListener('click', selectAll);
        document.getElementById('cart-deselect-all')?.addEventListener('click', deselectAll);
        document.getElementById('cart-invert')?.addEventListener('click', invertSelection);

        const selectUpToBtn = document.getElementById('cart-select-up-to');
        if (selectUpToBtn) {
            selectUpToBtn.addEventListener('click', () => {
                const input = document.getElementById('cart-up-to');
                const value = parseInt(input ? input.value : 0);
                if (value && value > 0) {
                    selectUpTo(value);
                }
            });
        }

        document.getElementById('cart-send-btn')?.addEventListener('click', startCartSending);
        document.getElementById('cart-stop-btn')?.addEventListener('click', stopCartSending);
    }

    function setupRowClickHandlers() {
        getCartItems().forEach(item => {
            item.row.addEventListener('click', (e) => {
                if (e.target.classList.contains('js-cart-item-input')) return;
                if (e.target.tagName === 'INPUT') return;

                item.checkbox.checked = !item.checkbox.checked;
                updateRowHighlighting();
                updateStats();
            });

            item.checkbox.addEventListener('change', () => {
                updateRowHighlighting();
                updateStats();
            });
        });
    }

    // ==================== PIN FUNCTIONS ====================

    async function activatePin(pin) {
        try {
            const response = await fetch(CONFIG.pin.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: `pin=${encodeURIComponent(pin)}`,
                credentials: 'include'
            });

            const result = await response.text();
            return {
                success: result.includes('success') || result.includes('успех') || response.ok,
                response: result
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async function startPinActivation() {
        const fileInput = document.getElementById('pin-file-input');
        const file = fileInput?.files[0];

        if (!file) {
            alert('Выберите файл с пин-кодами!');
            return;
        }

        const text = await file.text();
        const pins = text.split('\n')
            .map(pin => pin.trim())
            .filter(pin => pin.length > 0);

        if (pins.length === 0) {
            alert('Файл пуст или не содержит пин-кодов!');
            return;
        }

        state.pin.totalCount = pins.length;
        state.pin.processedCount = 0;
        state.pin.isRunning = true;
        state.pin.shouldStop = false;

        updatePinUIState();
        createPinList(pins);

        log(`Начинаем активацию ${pins.length} пин-кодов`, 'info');

        for (let i = 0; i < pins.length; i++) {
            if (state.pin.shouldStop) {
                log('Активация прервана пользователем', 'error');
                updatePinItemStatus(i, 'error', 'Остановлено');
                break;
            }

            const pin = pins[i];
            updatePinItemStatus(i, 'processing', 'Отправка...');

            const result = await activatePin(pin);
            state.pin.processedCount++;

            updatePinStats();

            if (result.success) {
                updatePinItemStatus(i, 'success', 'Успешно');
                log(`✓ Пин ${pin}: активирован`, 'success');
            } else {
                updatePinItemStatus(i, 'error', 'Ошибка');
                log(`✗ Пин ${pin}: ошибка`, 'error');
            }

            const progressBar = document.getElementById('aa-tool-progress-bar');
            if (progressBar) {
                const progress = ((i + 1) / pins.length) * 100;
                progressBar.style.width = `${progress}%`;
                progressBar.textContent = `${Math.round(progress)}%`;
            }

            if (i < pins.length - 1 && !state.pin.shouldStop) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.pin.delayBetweenPins));
            }
        }

        state.pin.isRunning = false;
        updatePinUIState();
        log(`Активация завершена. Обработано: ${state.pin.processedCount}/${state.pin.totalCount}`, 'info');
    }

    function createPinList(pins) {
        const container = document.getElementById('pin-list-container');
        if (!container) return;

        container.innerHTML = '';
        pins.forEach((pin, index) => {
            const item = document.createElement('div');
            item.className = 'pin-item pending';
            item.id = `pin-item-${index}`;
            item.innerHTML = `
                <span>${index + 1}. ${pin}</span>
                <span class="pin-status">В очереди</span>
            `;
            container.appendChild(item);
        });
        // Автопрокрутка к первому элементу
        container.scrollTop = 0;
    }

    function updatePinItemStatus(index, status, message) {
        const item = document.getElementById(`pin-item-${index}`);
        if (item) {
            item.className = `pin-item ${status}`;
            const statusSpan = item.querySelector('.pin-status');
            if (statusSpan) statusSpan.textContent = message;

            // Автопрокрутка к текущему элементу
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    function updatePinStats() {
        const processedEl = document.getElementById('pin-processed');
        const remainingEl = document.getElementById('pin-remaining');
        if (processedEl) processedEl.textContent = state.pin.processedCount;
        if (remainingEl) remainingEl.textContent = state.pin.totalCount - state.pin.processedCount;
    }

    function updatePinUIState() {
        const startBtn = document.getElementById('pin-start-btn');
        const stopBtn = document.getElementById('pin-stop-btn');
        const fileInput = document.getElementById('pin-file-input');

        if (state.pin.isRunning) {
            if (startBtn) startBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'flex';
            if (fileInput) fileInput.disabled = true;
        } else {
            if (startBtn) startBtn.style.display = 'flex';
            if (stopBtn) stopBtn.style.display = 'none';
            if (fileInput) fileInput.disabled = false;

            const progressBar = document.getElementById('aa-tool-progress-bar');
            if (progressBar && !state.pin.shouldStop && state.pin.processedCount === 0) {
                progressBar.style.width = '0%';
                progressBar.textContent = '';
            }
        }
    }

    function stopPinActivation() {
        state.pin.shouldStop = true;
        log('Остановка активации...', 'error');
    }

    function setupPinEventListeners() {
        const toggleBtn = document.getElementById('aa-tool-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                togglePanel();
            });
        }

        const header = document.querySelector('.aa-tool-header');
        if (header) {
            header.addEventListener('click', (e) => {
                if (e.target === header || e.target.tagName === 'H3') {
                    togglePanel();
                }
            });
        }

        const fileInput = document.getElementById('pin-file-input');
        const fileBtn = document.getElementById('pin-file-btn');

        if (fileBtn && fileInput) {
            fileBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', () => {
                const fileName = fileInput.files[0]?.name || 'Файл не выбран';
                const fileLabel = document.getElementById('pin-file-name');
                if (fileLabel) fileLabel.textContent = fileName;
                log(`Выбран файл: ${fileName}`, 'info');
            });
        }

        document.getElementById('pin-start-btn')?.addEventListener('click', startPinActivation);
        document.getElementById('pin-stop-btn')?.addEventListener('click', stopPinActivation);
    }

    // ==================== UI CREATION ====================

    function createCartPanel() {
        const existing = document.getElementById('aa-tool-panel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'aa-tool-panel';

        const chars = getCharacters();
        const charOptions = chars.map(char =>
            `<option value="${char.value}">${char.name} (${char.info})</option>`
        ).join('');

        panel.innerHTML = `
            <div class="aa-tool-header">
                <h3>📦 Корзина Auto-Sender</h3>
                <button id="aa-tool-toggle-btn" class="aa-tool-toggle" title="Свернуть">◀</button>
            </div>
            <div class="aa-tool-content">
                <div class="aa-tool-section">
                    <label>👤 Выбор персонажа:</label>
                    <select id="cart-char-select" class="aa-tool-select">
                        <option value="">-- Выберите персонажа --</option>
                        ${charOptions}
                    </select>
                </div>

                <div class="aa-tool-section">
                    <label>🎯 Быстрый выбор предметов:</label>
                    <button id="cart-select-all" class="aa-tool-btn secondary">
                        ☑️ Выбрать все
                    </button>
                    <button id="cart-deselect-all" class="aa-tool-btn secondary">
                        ☐ Снять выбор
                    </button>
                    <button id="cart-invert" class="aa-tool-btn secondary">
                        🔄 Инвертировать
                    </button>
                    <div class="select-up-to-container">
                        <input type="number" id="cart-up-to" placeholder="До №" min="1">
                        <button id="cart-select-up-to" class="aa-tool-btn secondary">
                            Выбрать
                        </button>
                    </div>
                </div>

                <div class="aa-tool-section">
                    <label>📊 Статистика:</label>
                    <div class="aa-tool-stats">
                        <div><span>Всего предметов:</span><span id="cart-total">0</span></div>
                        <div><span>Выбрано:</span><span id="cart-selected">0</span></div>
                        <div><span>Пачек (по ${CONFIG.cart.batchSize}):</span><span id="cart-batches">0</span></div>
                    </div>
                </div>

                <div class="aa-tool-section">
                    <button id="cart-send-btn" class="aa-tool-btn primary">
                        🚀 Отправить выбранные
                    </button>
                    <button id="cart-stop-btn" class="aa-tool-btn danger" style="display:none;">
                        ⏹ Остановить
                    </button>
                </div>

                <div class="aa-tool-progress">
                    <div id="aa-tool-progress-bar" class="aa-tool-progress-bar"></div>
                </div>

                <div class="aa-tool-section" style="margin-top:10px;">
                    <label>📝 Лог операций:</label>
                    <div id="aa-tool-log" class="aa-tool-log"></div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);
        setupCartEventListeners();
        setupRowClickHandlers();
        updateStats();
        log('Панель управления корзиной загружена. Кликайте по строкам таблицы для выбора!', 'info');
    }

    function createPinPanel() {
        const existing = document.getElementById('aa-tool-panel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'aa-tool-panel';

        panel.innerHTML = `
            <div class="aa-tool-header">
                <h3>🔑 Активация Пин-кодов</h3>
                <button id="aa-tool-toggle-btn" class="aa-tool-toggle" title="Свернуть">◀</button>
            </div>
            <div class="aa-tool-content">
                <div class="aa-tool-section">
                    <label>📁 Загрузка пин-кодов:</label>
                    <div class="file-input-wrapper">
                        <input type="file" id="pin-file-input" accept=".txt">
                        <button id="pin-file-btn" class="aa-tool-btn secondary">
                            📂 Выбрать файл .txt
                        </button>
                    </div>
                    <div id="pin-file-name" style="margin-top: 5px; font-size: 12px; color: #aaa; text-align: center;">
                        Файл не выбран
                    </div>
                </div>

                <div class="aa-tool-section">
                    <label>📊 Статистика:</label>
                    <div class="aa-tool-stats">
                        <div><span>Всего пинов:</span><span id="pin-total">0</span></div>
                        <div><span>Обработано:</span><span id="pin-processed">0</span></div>
                        <div><span>Осталось:</span><span id="pin-remaining">0</span></div>
                    </div>
                </div>

                <div class="aa-tool-section">
                    <button id="pin-start-btn" class="aa-tool-btn success">
                        ▶️ Начать активацию
                    </button>
                    <button id="pin-stop-btn" class="aa-tool-btn danger" style="display:none;">
                        ⏹ Остановить
                    </button>
                </div>

                <div class="aa-tool-progress">
                    <div id="aa-tool-progress-bar" class="aa-tool-progress-bar"></div>
                </div>

                <div class="aa-tool-section" style="margin-top:10px;">
                    <label>📋 Список пин-кодов (прокручиваемый):</label>
                    <div id="pin-list-container" class="pin-list-container" style="display: none;">
                        <!-- Сюда будут добавляться пины -->
                    </div>
                </div>

                <div class="aa-tool-section" style="margin-top:10px;">
                    <label>📝 Лог операций:</label>
                    <div id="aa-tool-log" class="aa-tool-log"></div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);
        setupPinEventListeners();
        log('Панель активации пин-кодов загружена. Выберите файл с пинами!', 'info');
    }

    // ==================== INITIALIZATION ====================

    function init() {
        if (isCartPage) {
            let attempts = 0;
            const maxAttempts = 20;

            const checkInterval = setInterval(() => {
                attempts++;
                const table = document.querySelector('.js-cart-item-wrap');
                const chars = document.querySelector('.char_select');

                if (table && chars) {
                    clearInterval(checkInterval);
                    createCartPanel();
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    console.log('[ArcheAgeTool] Таблица корзины не найдена');
                }
            }, 500);
        } else if (isPinPage) {
            // На странице пинов запускаем сразу
            createPinPanel();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();