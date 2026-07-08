// ==UserScript==
// @name         ArcheAge Universal Tool (Cart + Pins + FunPay)
// @namespace    http://tampermonkey.net/
// @version      3.3
// @description  Автоматическая отправка предметов из корзины, активация пин-кодов и импорт пинов из заказов FunPay с единым интерфейсом
// @author       You
// @homepageURL  https://github.com/Adfazer/ArcheAge-Auto-Sender
// @updateURL    https://raw.githubusercontent.com/Adfazer/ArcheAge-Auto-Sender/main/archeage-universal-tool.user.js
// @downloadURL  https://raw.githubusercontent.com/Adfazer/ArcheAge-Auto-Sender/main/archeage-universal-tool.user.js
// @match        https://archeage.ru/cart*
// @match        https://archeage.ru/pin/activate/*
// @match        https://funpay.com/orders/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // Определение текущей страницы
    const isFunpayPage = window.location.hostname.includes('funpay.com') && /\/orders\/[^\/]+/.test(window.location.pathname);
    const isCartPage = !isFunpayPage && window.location.href.includes('/cart');
    const isPinPage = !isFunpayPage && window.location.href.includes('/pin/activate');

    // Ключ для передачи пинов между funpay.com и archeage.ru (общее хранилище скрипта)
    const FUNPAY_TRANSFER_KEY = 'aa_funpay_transfer';
    const FUNPAY_TRANSFER_TTL = 10 * 60 * 1000; // 10 минут

    // Профиль продавца пин-кодов на FunPay
    const BUY_PINS_URL = 'https://funpay.com/users/175153/';

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
            successCount: 0,
            errorCount: 0,
            warningCount: 0,
            loadedPins: [],
            isCollapsed: false
        },
        funpay: {
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
        a.aa-tool-btn.buy-pins {
            background: linear-gradient(90deg, #b8860b, #daa520);
            color: #fff;
            text-decoration: none;
            box-sizing: border-box;
        }
        a.aa-tool-btn.buy-pins:hover {
            background: linear-gradient(90deg, #daa520, #ffc93c);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(218, 165, 32, 0.4);
            color: #fff;
            text-decoration: none;
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
        .pin-item.warning {
            background: rgba(243, 156, 18, 0.2);
            border-left: 3px solid #f39c12;
        }
        .pin-item .pin-status {
            margin-left: 10px;
            text-align: right;
            flex-shrink: 0;
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
        /* Предметы на таймере передачи — недоступны для выбора */
        .js-cart-item.js-disabled,
        .js-cart-item.disabled {
            cursor: not-allowed !important;
            opacity: 0.55;
        }
        .js-cart-item.js-disabled:hover,
        .js-cart-item.disabled:hover {
            background-color: rgba(243, 156, 18, 0.12) !important;
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
                // Предметы на таймере передачи («Можно передать через: N мин.»)
                // сайт помечает классами js-disabled/disabled — их отправлять нельзя
                const locked = row.classList.contains('js-disabled')
                    || row.classList.contains('disabled')
                    || checkbox.disabled;
                // Количество из последней колонки («x 30», «x 50» или «1»)
                const cells = row.querySelectorAll('td');
                const qtyText = cells.length > 0
                    ? cells[cells.length - 1].textContent.replace(/[^\d]/g, '')
                    : '';
                items.push({
                    id: checkbox.getAttribute('data-item'),
                    name: nameCell.textContent.trim(),
                    quantity: qtyText || '1',
                    checkbox: checkbox,
                    row: row,
                    index: index,
                    locked: locked
                });
            }
        });
        return items;
    }

    function getAvailableCartItems() {
        return getCartItems().filter(item => !item.locked);
    }

    // Ключ стопки: одинаковое название с разным количеством (×30 и ×50) —
    // это разные стопки, в выпадающем списке они должны различаться
    function itemStackKey(item) {
        return item.quantity === '1' ? item.name : `${item.name} ×${item.quantity}`;
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
        const locked = items.filter(item => item.locked);
        const selected = items.filter(item => item.checkbox.checked && !item.locked);
        const totalEl = document.getElementById('cart-total');
        const lockedEl = document.getElementById('cart-locked');
        const selectedEl = document.getElementById('cart-selected');
        const batchesEl = document.getElementById('cart-batches');
        if (totalEl) totalEl.textContent = items.length;
        if (lockedEl) lockedEl.textContent = locked.length;
        if (selectedEl) selectedEl.textContent = selected.length;
        if (batchesEl) batchesEl.textContent = Math.ceil(selected.length / CONFIG.cart.batchSize);
    }

    function selectAll() {
        let lockedCount = 0;
        getCartItems().forEach(item => {
            item.checkbox.checked = !item.locked;
            if (item.locked) lockedCount++;
        });
        updateRowHighlighting();
        updateStats();
        if (lockedCount > 0) {
            log(`Выбраны все доступные предметы (пропущено на таймере: ${lockedCount})`, 'success');
        } else {
            log('Выбраны все предметы', 'success');
        }
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
            item.checkbox.checked = i < index && !item.locked;
        });
        updateRowHighlighting();
        updateStats();
        log(`Выбраны доступные предметы от 1 до ${index}`, 'success');
    }

    function invertSelection() {
        getCartItems().forEach(item => {
            item.checkbox.checked = item.locked ? false : !item.checkbox.checked;
        });
        updateRowHighlighting();
        updateStats();
        log('Выбор инвертирован', 'info');
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function refreshNameSelect() {
        const select = document.getElementById('cart-name-select');
        if (!select) return;

        const counts = new Map();
        getCartItems().forEach(item => {
            const key = itemStackKey(item);
            const entry = counts.get(key) || { available: 0, locked: 0 };
            if (item.locked) entry.locked++;
            else entry.available++;
            counts.set(key, entry);
        });

        const previousValue = select.value;
        const options = [...counts.entries()]
            .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
            .map(([key, entry]) => {
                const lockedNote = entry.locked > 0 ? `, ${entry.locked} на таймере` : '';
                return `<option value="${escapeHtml(key)}">${escapeHtml(key)} (${entry.available} шт.${lockedNote})</option>`;
            })
            .join('');

        select.innerHTML = `<option value="">-- Выберите название --</option>${options}`;
        if (previousValue && counts.has(previousValue)) {
            select.value = previousValue;
        }
    }

    function selectByName() {
        const select = document.getElementById('cart-name-select');
        const stackKey = select ? select.value : '';
        if (!stackKey) {
            alert('Выберите название предмета из списка!');
            return;
        }

        let count = 0;
        let lockedCount = 0;
        getCartItems().forEach(item => {
            const matches = itemStackKey(item) === stackKey;
            item.checkbox.checked = matches && !item.locked;
            if (item.checkbox.checked) count++;
            if (matches && item.locked) lockedCount++;
        });
        updateRowHighlighting();
        updateStats();
        if (lockedCount > 0) {
            log(`Выбрано ${count} предметов «${stackKey}», ещё ${lockedCount} на таймере — пропущены`, 'warning');
        } else {
            log(`Выбрано ${count} предметов «${stackKey}» (остальные сняты)`, 'success');
        }
    }

    function buyPinsButtonHtml() {
        return `
                <div class="aa-tool-section" style="margin-top:10px; margin-bottom:0;">
                    <a href="${BUY_PINS_URL}" target="_blank" rel="noopener" class="aa-tool-btn buy-pins">
                        💰 Купить пин-коды
                    </a>
                </div>`;
    }

    function togglePanel() {
        const panel = document.getElementById('aa-tool-panel');
        const toggleBtn = document.getElementById('aa-tool-toggle-btn');
        if (!panel || !toggleBtn) return;

        const currentState = isCartPage ? state.cart : (isFunpayPage ? state.funpay : state.pin);
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

        // Страховка: предметы на таймере не отправляем, даже если галочка
        // оказалась поставлена (например, самим сайтом)
        const checkedItems = getCartItems().filter(item => item.checkbox.checked);
        const items = checkedItems.filter(item => !item.locked);
        const skippedLocked = checkedItems.length - items.length;
        if (skippedLocked > 0) {
            checkedItems.forEach(item => {
                if (item.locked) item.checkbox.checked = false;
            });
            log(`Пропущено ${skippedLocked} предметов на таймере передачи`, 'warning');
        }

        if (items.length === 0) {
            alert('Выберите хотя бы один доступный предмет! (предметы на таймере передачи отправить нельзя)');
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
        refreshNameSelect();

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
        document.getElementById('cart-select-by-name')?.addEventListener('click', selectByName);

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

                if (item.locked) {
                    log(`«${item.name}» на таймере передачи — выбрать нельзя`, 'warning');
                    return;
                }

                item.checkbox.checked = !item.checkbox.checked;
                updateRowHighlighting();
                updateStats();
            });

            item.checkbox.addEventListener('change', () => {
                if (item.locked && item.checkbox.checked) {
                    item.checkbox.checked = false;
                    log(`«${item.name}» на таймере передачи — выбрать нельзя`, 'warning');
                }
                updateRowHighlighting();
                updateStats();
            });
        });
    }

    // ==================== PIN FUNCTIONS ====================

    // Сервер отвечает HTTP 200 даже на невалидный пин, а текст ошибки
    // приходит внутри HTML — поэтому разбираем тело ответа, а не статус.
    function parsePinResponse(rawText) {
        const plainText = rawText
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ');

        const errorPatterns = [
            { re: /некорректн\S*\s+пин/i, msg: 'Некорректный пин-код' },
            { re: /уже\s+активирован/i, msg: 'Пин уже активирован' },
            { re: /не\s+найден/i, msg: 'Пин-код не найден' },
            { re: /истек|истёк|просрочен/i, msg: 'Срок действия истёк' },
            { re: /слишком\s+(много|часто)|превышен/i, msg: 'Слишком много запросов' },
            { re: /авториз|войдите|login/i, msg: 'Требуется авторизация на сайте' },
            { re: /"success"\s*:\s*false/i, msg: 'Ошибка активации' },
            { re: /ошибка/i, msg: 'Ошибка активации' }
        ];
        for (const pattern of errorPatterns) {
            if (pattern.re.test(plainText)) {
                return { success: false, message: pattern.msg };
            }
        }

        const successPatterns = [
            /успешно\s+активирован/i,
            /пин-?код\s+активирован/i,
            /"success"\s*:\s*true/i,
            /успешн/i
        ];
        for (const pattern of successPatterns) {
            if (pattern.test(plainText)) {
                return { success: true, message: 'Успешно' };
            }
        }

        // Ни ошибки, ни явного подтверждения — не считаем успехом
        return { success: null, message: 'Ответ не распознан — проверьте вручную' };
    }

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

            if (!response.ok) {
                return { success: false, message: `HTTP ${response.status}` };
            }

            const rawText = await response.text();
            return parsePinResponse(rawText);
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    function parsePinsFromText(text) {
        return [...new Set(
            text.split(/\r?\n/)
                .map(pin => pin.trim())
                .filter(pin => pin.length > 0)
        )];
    }

    function setLoadedPins(pins, sourceLabel) {
        state.pin.loadedPins = pins;
        state.pin.totalCount = pins.length;
        state.pin.processedCount = 0;
        state.pin.successCount = 0;
        state.pin.errorCount = 0;
        state.pin.warningCount = 0;

        const totalEl = document.getElementById('pin-total');
        if (totalEl) totalEl.textContent = pins.length;
        updatePinStats();
        createPinList(pins);

        const sourceEl = document.getElementById('pin-file-name');
        if (sourceEl) sourceEl.textContent = `${sourceLabel} — ${pins.length} шт.`;
        log(`Загружено ${pins.length} пин-кодов (${sourceLabel})`, 'info');
    }

    async function startPinActivation() {
        const pins = state.pin.loadedPins;

        if (!pins || pins.length === 0) {
            alert('Сначала загрузите пин-коды: выберите файл .txt или перейдите со страницы заказа FunPay!');
            return;
        }

        state.pin.totalCount = pins.length;
        state.pin.processedCount = 0;
        state.pin.successCount = 0;
        state.pin.errorCount = 0;
        state.pin.warningCount = 0;
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

            if (result.success === true) {
                state.pin.successCount++;
                updatePinItemStatus(i, 'success', result.message);
                log(`✓ Пин ${pin}: активирован`, 'success');
            } else if (result.success === false) {
                state.pin.errorCount++;
                updatePinItemStatus(i, 'error', result.message);
                log(`✗ Пин ${pin}: ${result.message}`, 'error');
            } else {
                state.pin.warningCount++;
                updatePinItemStatus(i, 'warning', result.message);
                log(`? Пин ${pin}: ${result.message}`, 'warning');
            }

            updatePinStats();

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
        log(`Активация завершена. Успешно: ${state.pin.successCount}, Ошибок: ${state.pin.errorCount}, Требуют проверки: ${state.pin.warningCount}`,
            state.pin.errorCount === 0 ? 'success' : 'warning');
    }

    function createPinList(pins) {
        const container = document.getElementById('pin-list-container');
        if (!container) return;

        container.style.display = 'block';
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
        const successEl = document.getElementById('pin-success');
        const errorEl = document.getElementById('pin-errors');
        if (processedEl) processedEl.textContent = state.pin.processedCount;
        if (remainingEl) remainingEl.textContent = state.pin.totalCount - state.pin.processedCount;
        if (successEl) successEl.textContent = state.pin.successCount;
        if (errorEl) errorEl.textContent = state.pin.errorCount + (state.pin.warningCount ? ` (+${state.pin.warningCount}?)` : '');
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
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files[0];
                if (!file) return;

                const text = await file.text();
                const pins = parsePinsFromText(text);
                if (pins.length === 0) {
                    alert('Файл пуст или не содержит пин-кодов!');
                    return;
                }
                setLoadedPins(pins, `файл ${file.name}`);
            });
        }

        document.getElementById('pin-start-btn')?.addEventListener('click', startPinActivation);
        document.getElementById('pin-stop-btn')?.addEventListener('click', stopPinActivation);
    }

    // ==================== FUNPAY FUNCTIONS ====================

    function getFunpayOrderId() {
        const match = window.location.pathname.match(/\/orders\/([^\/]+)/);
        return match ? match[1] : '';
    }

    function getFunpayPins() {
        const pins = [];
        document.querySelectorAll('.order-secrets-list .secret-placeholder').forEach(el => {
            const pin = el.textContent.trim();
            if (pin) pins.push(pin);
        });
        return [...new Set(pins)];
    }

    function downloadFunpayPins(pins) {
        const orderId = getFunpayOrderId();
        const blob = new Blob([pins.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `pins_${orderId || 'funpay'}.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        log(`Скачан файл с ${pins.length} пин-кодами`, 'success');
    }

    function sendFunpayPinsToActivation(pins) {
        const orderId = getFunpayOrderId();
        GM_setValue(FUNPAY_TRANSFER_KEY, JSON.stringify({
            pins: pins,
            order: orderId,
            ts: Date.now()
        }));
        log(`${pins.length} пинов переданы на активацию, открываем archeage.ru...`, 'success');
        window.open('https://archeage.ru/pin/activate/', '_blank');
    }

    // На странице активации: подхватываем пины, переданные со страницы заказа FunPay
    function loadPendingFunpayTransfer() {
        try {
            const raw = GM_getValue(FUNPAY_TRANSFER_KEY, null);
            if (!raw) return;
            GM_deleteValue(FUNPAY_TRANSFER_KEY);

            const data = JSON.parse(raw);
            if (!data.pins || data.pins.length === 0) return;
            if (Date.now() - (data.ts || 0) > FUNPAY_TRANSFER_TTL) {
                log('Найдены пины из FunPay, но они устарели — откройте заказ заново', 'warning');
                return;
            }

            setLoadedPins(data.pins, `FunPay заказ #${data.order || '?'}`);
            log('Пины из FunPay готовы — нажмите «Начать активацию»', 'success');
        } catch (e) {
            console.log('[ArcheAgeTool] Не удалось прочитать пины из FunPay:', e);
        }
    }

    function setupFunpayEventListeners(pins) {
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

        document.getElementById('funpay-download-btn')?.addEventListener('click', () => downloadFunpayPins(pins));
        document.getElementById('funpay-activate-btn')?.addEventListener('click', () => sendFunpayPinsToActivation(pins));

        const copyBtn = document.getElementById('funpay-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(pins.join('\n')).then(() => {
                    log('Пины скопированы в буфер обмена', 'success');
                }).catch(() => {
                    log('Не удалось скопировать в буфер обмена', 'error');
                });
            });
        }
    }

    function createFunpayPanel() {
        const pins = getFunpayPins();
        if (pins.length === 0) {
            console.log('[ArcheAgeTool] Пин-коды в заказе не найдены (нет блока «Оплаченные товары»)');
            return;
        }

        const existing = document.getElementById('aa-tool-panel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'aa-tool-panel';

        const orderId = getFunpayOrderId();
        const pinListHtml = pins.map((pin, index) => `
            <div class="pin-item pending">
                <span>${index + 1}. ${escapeHtml(pin)}</span>
            </div>
        `).join('');

        panel.innerHTML = `
            <div class="aa-tool-header">
                <h3>🛒 FunPay → ArcheAge</h3>
                <button id="aa-tool-toggle-btn" class="aa-tool-toggle" title="Свернуть">◀</button>
            </div>
            <div class="aa-tool-content">
                <div class="aa-tool-section">
                    <label>📊 Заказ #${escapeHtml(orderId)}:</label>
                    <div class="aa-tool-stats">
                        <div><span>Найдено пин-кодов:</span><span>${pins.length}</span></div>
                    </div>
                </div>

                <div class="aa-tool-section">
                    <button id="funpay-activate-btn" class="aa-tool-btn success">
                        🚀 Активировать на archeage.ru
                    </button>
                    <button id="funpay-download-btn" class="aa-tool-btn primary">
                        💾 Скачать pins.txt
                    </button>
                    <button id="funpay-copy-btn" class="aa-tool-btn secondary">
                        📋 Скопировать все пины
                    </button>
                </div>

                <div class="aa-tool-section">
                    <label>📋 Пин-коды из заказа:</label>
                    <div class="pin-list-container">
                        ${pinListHtml}
                    </div>
                </div>

                <div class="aa-tool-section" style="margin-top:10px;">
                    <label>📝 Лог операций:</label>
                    <div id="aa-tool-log" class="aa-tool-log"></div>
                </div>
${buyPinsButtonHtml()}
            </div>
        `;

        document.body.appendChild(panel);
        setupFunpayEventListeners(pins);
        log(`Найдено ${pins.length} пин-кодов в заказе #${orderId}`, 'info');
        log('«Активировать» откроет archeage.ru и подставит пины автоматически', 'info');
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
                    <label>🏷️ Выбор по названию:</label>
                    <select id="cart-name-select" class="aa-tool-select">
                        <option value="">-- Выберите название --</option>
                    </select>
                    <button id="cart-select-by-name" class="aa-tool-btn secondary">
                        ☑️ Выбрать только эти
                    </button>
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
                        <div><span>На таймере (недоступно):</span><span id="cart-locked" style="color:#f39c12;">0</span></div>
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
${buyPinsButtonHtml()}
            </div>
        `;

        document.body.appendChild(panel);
        setupCartEventListeners();
        setupRowClickHandlers();
        refreshNameSelect();
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
                        <div><span>Успешно:</span><span id="pin-success" style="color:#2ecc71;">0</span></div>
                        <div><span>Ошибок:</span><span id="pin-errors" style="color:#e74c3c;">0</span></div>
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
${buyPinsButtonHtml()}
            </div>
        `;

        document.body.appendChild(panel);
        setupPinEventListeners();
        log('Панель активации пин-кодов загружена. Выберите файл с пинами!', 'info');
        loadPendingFunpayTransfer();
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
        } else if (isFunpayPage) {
            createFunpayPanel();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();