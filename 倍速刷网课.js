// ==UserScript==
// @name         演出经纪人继续教育学习助手
// @namespace    https://github.com/Mattease/performer-agent-study-helper
// @version      3.0.0
// @description  文旅部演出经纪人继续教育平台辅助工具。支持视频倍速播放、后台防暂停、自动处理学习提示弹窗。仅供个人学习效率提升使用。
// @author       Mattease
// @license      MIT
// @homepage     https://github.com/Mattease/performer-agent-study-helper
// @supportURL   https://github.com/Mattease/performer-agent-study-helper/issues
// @updateURL    https://raw.githubusercontent.com/Mattease/performer-agent-study-helper/main/performer-agent-study-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/Mattease/performer-agent-study-helper/main/performer-agent-study-helper.user.js
// @icon         https://www.mct.gov.cn/favicon.ico
// @match        *://*.mct.gov.cn/*
// @match        *://ccm.mct.gov.cn/*
// @match        *://wlsc.mr.mct.gov.cn/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // 全局状态管理
    // ============================================================
    let isInitialized = false;
    let isPaused = false;       // 暂停状态标记
    const timers = [];          // 统一管理所有 setInterval
    let observer = null;        // MutationObserver 引用
    const SCRIPT_PREFIX = '【挂机助手 v3.0】';

    function log(...args) {
        console.log(SCRIPT_PREFIX, ...args);
    }

    function warn(...args) {
        console.warn(SCRIPT_PREFIX, ...args);
    }

    // ============================================================
    // 1. 防检测核心 — 在 document-start 阶段尽早执行
    //    这部分不依赖 DOM，所以放在最前面
    // ============================================================
    try {
        // 1a. 劫持 visibilityState 和 hidden（用 getter 更安全）
        Object.defineProperty(document, 'visibilityState', {
            get: () => 'visible',
            configurable: true
        });
        Object.defineProperty(document, 'hidden', {
            get: () => false,
            configurable: true
        });

        // 1b. 劫持 hasFocus — 部分平台用这个检测
        document.hasFocus = () => true;

        // 1c. 拦截 visibilitychange 和 blur 事件
        document.addEventListener('visibilitychange', (e) => {
            e.stopImmediatePropagation();
        }, true);

        window.addEventListener('blur', (e) => {
            e.stopImmediatePropagation();
        }, true);

        // 1d. 拦截 pagehide / pageshow（某些平台用这些事件检测）
        window.addEventListener('pagehide', (e) => {
            e.stopImmediatePropagation();
        }, true);

        // 1e. 劫持 playbackRate setter — 阻止平台强制重置倍速
        const originalPlaybackRateDesc = Object.getOwnPropertyDescriptor(
            HTMLMediaElement.prototype, 'playbackRate'
        );
        if (originalPlaybackRateDesc && originalPlaybackRateDesc.set) {
            Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
                get: originalPlaybackRateDesc.get,
                set(val) {
                    // 如果脚本已初始化，强制使用用户设定的倍速
                    if (isInitialized) {
                        const targetSpeed = parseFloat(GM_getValue('custom_video_speed', 1));
                        originalPlaybackRateDesc.set.call(this, targetSpeed);
                    } else {
                        originalPlaybackRateDesc.set.call(this, val);
                    }
                },
                configurable: true,
                enumerable: true
            });
        }

        // 1f. 拦截 ratechange 事件 — 防止平台监听并重置
        document.addEventListener('ratechange', (e) => {
            e.stopImmediatePropagation();
        }, true);

        log('防检测模块已在 document-start 阶段加载完成');
    } catch (err) {
        warn('防检测模块加载出错:', err);
    }

    // ============================================================
    // 2. 核心挂机功能（检测到视频后才调用）
    // ============================================================
    function initHelper() {
        if (isInitialized) return;
        isInitialized = true;
        log('已检测到视频元素，脚本正式启动！');

        // 2a. 统一轮询：防暂停 + 倍速同步（合并为一个 setInterval）
        const mainTimer = setInterval(() => {
            try {
                if (isPaused) return;
                const targetSpeed = parseFloat(GM_getValue('custom_video_speed', 1));
                document.querySelectorAll('video').forEach(video => {
                    // 防暂停：如果视频被意外暂停，自动恢复播放
                    if (video.paused && !video.ended) {
                        video.play().catch(() => { });
                    }
                    // 倍速同步：使用原始 setter 来绕过我们自己的劫持
                    if (originalPlaybackRateDesc && originalPlaybackRateDesc.set) {
                        const currentRate = originalPlaybackRateDesc.get.call(video);
                        if (currentRate !== targetSpeed) {
                            originalPlaybackRateDesc.set.call(video, targetSpeed);
                        }
                    }
                });
            } catch (err) {
                warn('主循环出错:', err);
            }
        }, 800);
        timers.push(mainTimer);

        // 2b. 弹窗自动处理（采用宽泛扫描策略，因为 @match 已限定目标平台域名）
        const popupTimer = setInterval(() => {
            try {
                if (isPaused) return;
                if (!GM_getValue('auto_click_popup', true)) return;

                // 关键词白名单
                const keywords = ['确认', '确定', '继续', '我知道了', '下一节',
                    '继续学习', '关闭提示', '关闭', '知道了', '开始学习',
                    '继续播放', '已阅读', '播放', '下一课'];

                // 危险词排除名单
                const excludeKeywords = ['删除', '退出', '注销', '转账', '支付',
                    '提交订单', '取消资格', '放弃', '注销账号'];

                // 上下文关键词 — 页面中出现这些文字说明有弹窗
                const contextKeywords = ['播放提示', '自动播放下一节', '播放完成',
                    '学习提示', '继续学习', '课程提示', '温馨提示', '提示信息',
                    '您已经学完', '播放结束', '是否继续'];

                // 宽泛扫描：包括 div、span、a（很多平台用 div/span 做按钮）
                const targets = document.querySelectorAll(
                    'button, [class*="btn"], [id*="btn"], a, div, span'
                );

                targets.forEach(el => {
                    // 跳过我们自己的 GUI
                    if (el.closest('#gk-helper-panel') || el.closest('#gk-helper-gear')) return;

                    if (el.offsetWidth > 0 && el.offsetHeight > 0 && el.innerText) {
                        const text = el.innerText.trim();

                        if (text.length > 0 && text.length < 10) {
                            // 排除危险操作
                            if (excludeKeywords.some(k => text.includes(k))) return;

                            if (keywords.some(k => text === k)) {
                                // 上下文判断：页面文本中包含弹窗关键词，或元素在弹窗容器/浮层中
                                const pageText = document.body.textContent || '';
                                const hasContext =
                                    // 页面文本上下文检测
                                    contextKeywords.some(ck => pageText.includes(ck)) ||
                                    // 弹窗容器 class 检测
                                    el.closest('[class*="dialog"]') ||
                                    el.closest('[class*="modal"]') ||
                                    el.closest('[class*="popup"]') ||
                                    el.closest('[class*="layer"]') ||
                                    el.closest('[class*="overlay"]') ||
                                    el.closest('[class*="mask"]') ||
                                    el.closest('[class*="alert"]') ||
                                    el.closest('[class*="confirm"]') ||
                                    el.closest('[class*="tip"]') ||
                                    el.closest('[role="dialog"]') ||
                                    el.closest('[role="alertdialog"]') ||
                                    // 浮层样式检测
                                    window.getComputedStyle(el).position === 'absolute' ||
                                    window.getComputedStyle(el).position === 'fixed' ||
                                    parseInt(window.getComputedStyle(el).zIndex) > 10;

                                if (hasContext) {
                                    log('捕获弹窗按钮:', text);
                                    el.click();
                                }
                            }
                        }
                    }
                });
            } catch (err) {
                warn('弹窗处理出错:', err);
            }
        }, 1000);
        timers.push(popupTimer);

        // 2c. 渲染 GUI
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', renderGUI);
        } else {
            renderGUI();
        }
    }

    // ============================================================
    // 3. GUI 设置面板
    // ============================================================
    function renderGUI() {
        try {
            let currentSpeed = GM_getValue('custom_video_speed', 1);
            let autoClickEnabled = GM_getValue('auto_click_popup', true);

            const style = document.createElement('style');
            style.textContent = `
                @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&display=swap');

                #gk-helper-gear,
                #gk-helper-panel,
                #gk-helper-panel * {
                    box-sizing: border-box !important;
                    line-height: normal !important;
                }

                #gk-helper-gear {
                    position: fixed !important;
                    left: 10px !important;
                    top: 30% !important;
                    z-index: 2147483647 !important;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
                    color: white !important;
                    width: 40px !important;
                    height: 40px !important;
                    border-radius: 50% !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    cursor: pointer !important;
                    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4) !important;
                    font-size: 20px !important;
                    transition: transform 0.3s ease, box-shadow 0.3s ease !important;
                    user-select: none !important;
                    border: none !important;
                    outline: none !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    min-width: 0 !important;
                    min-height: 0 !important;
                    max-width: none !important;
                    max-height: none !important;
                    overflow: visible !important;
                    float: none !important;
                    text-indent: 0 !important;
                }
                #gk-helper-gear:hover {
                    transform: rotate(90deg) scale(1.1) !important;
                    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6) !important;
                }

                #gk-helper-panel {
                    position: fixed !important;
                    left: -300px !important;
                    top: 30% !important;
                    z-index: 2147483646 !important;
                    background: rgba(255, 255, 255, 0.97) !important;
                    backdrop-filter: blur(12px) !important;
                    -webkit-backdrop-filter: blur(12px) !important;
                    color: #1a1a2e !important;
                    width: 260px !important;
                    padding: 18px !important;
                    border-radius: 14px !important;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.08) !important;
                    border: 1px solid rgba(200, 200, 220, 0.5) !important;
                    transition: left 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
                    font-family: 'Noto Sans SC', system-ui, -apple-system, sans-serif !important;
                    overflow: visible !important;
                    float: none !important;
                    margin: 0 !important;
                    text-align: left !important;
                    direction: ltr !important;
                }
                #gk-helper-panel.open {
                    left: 60px !important;
                }

                #gk-helper-panel h4 {
                    margin: 0 0 14px 0 !important;
                    font-size: 14px !important;
                    font-weight: 700 !important;
                    background: linear-gradient(135deg, #667eea, #764ba2) !important;
                    -webkit-background-clip: text !important;
                    -webkit-text-fill-color: transparent !important;
                    background-clip: text !important;
                    border-bottom: 2px solid #f0f0f5 !important;
                    padding: 0 0 8px 0 !important;
                    text-align: left !important;
                    white-space: nowrap !important;
                }

                .gk-row {
                    display: flex !important;
                    align-items: center !important;
                    margin-bottom: 12px !important;
                    justify-content: space-between !important;
                    gap: 8px !important;
                    flex-wrap: nowrap !important;
                    width: 100% !important;
                }

                .gk-row input[type="number"] {
                    width: 70px !important;
                    padding: 6px 8px !important;
                    border: 1.5px solid #e0e0e8 !important;
                    border-radius: 8px !important;
                    text-align: center !important;
                    font-size: 14px !important;
                    font-weight: 500 !important;
                    color: #1a1a2e !important;
                    background: #fafaff !important;
                    outline: none !important;
                    transition: border-color 0.2s !important;
                    font-family: inherit !important;
                    flex-shrink: 0 !important;
                    min-width: 0 !important;
                    height: auto !important;
                }
                .gk-row input[type="number"]:focus {
                    border-color: #667eea !important;
                    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15) !important;
                }

                .gk-btn {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
                    color: white !important;
                    border: none !important;
                    padding: 6px 14px !important;
                    border-radius: 8px !important;
                    cursor: pointer !important;
                    font-size: 12px !important;
                    font-weight: 500 !important;
                    transition: opacity 0.2s, transform 0.15s !important;
                    white-space: nowrap !important;
                    font-family: inherit !important;
                    height: auto !important;
                    min-width: 0 !important;
                    text-transform: none !important;
                    letter-spacing: normal !important;
                }
                .gk-btn:hover {
                    opacity: 0.9 !important;
                    transform: translateY(-1px) !important;
                }
                .gk-btn:active {
                    transform: translateY(0) !important;
                }

                .gk-switch-label {
                    font-size: 13px !important;
                    color: #4a4a6a !important;
                    cursor: pointer !important;
                    display: flex !important;
                    align-items: center !important;
                    gap: 8px !important;
                    user-select: none !important;
                    white-space: nowrap !important;
                    width: 100% !important;
                }

                /* 自定义开关样式 */
                .gk-toggle {
                    position: relative !important;
                    width: 36px !important;
                    height: 20px !important;
                    appearance: none !important;
                    -webkit-appearance: none !important;
                    background: #ccc !important;
                    border-radius: 10px !important;
                    outline: none !important;
                    cursor: pointer !important;
                    transition: background 0.3s !important;
                    flex-shrink: 0 !important;
                    border: none !important;
                    padding: 0 !important;
                    margin: 0 !important;
                }
                .gk-toggle:checked {
                    background: linear-gradient(135deg, #667eea, #764ba2) !important;
                }
                .gk-toggle::before {
                    content: '' !important;
                    position: absolute !important;
                    top: 2px !important;
                    left: 2px !important;
                    width: 16px !important;
                    height: 16px !important;
                    background: white !important;
                    border-radius: 50% !important;
                    transition: transform 0.3s !important;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
                }
                .gk-toggle:checked::before {
                    transform: translateX(16px) !important;
                }

                #gk-speed-tips {
                    font-size: 11px !important;
                    color: #8888a8 !important;
                    border-top: 1px solid #f0f0f5 !important;
                    padding-top: 8px !important;
                    margin-top: 6px !important;
                    text-align: left !important;
                }
                #gk-cur-speed {
                    color: #764ba2 !important;
                    font-weight: 700 !important;
                    font-size: 13px !important;
                }

                .gk-status {
                    display: inline-block !important;
                    width: 8px !important;
                    height: 8px !important;
                    border-radius: 50% !important;
                    background: #4ade80 !important;
                    margin-right: 4px !important;
                    animation: gk-pulse 2s ease-in-out infinite !important;
                    flex-shrink: 0 !important;
                }
                @keyframes gk-pulse {
                    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.5); }
                    50% { opacity: 0.7; box-shadow: 0 0 0 4px rgba(74, 222, 128, 0); }
                }

                .gk-preset-row {
                    display: flex !important;
                    gap: 4px !important;
                    margin-bottom: 12px !important;
                    flex-wrap: wrap !important;
                    width: 100% !important;
                }
                .gk-preset-btn {
                    flex: 1 1 auto !important;
                    min-width: 36px !important;
                    padding: 5px 2px !important;
                    font-size: 11px !important;
                    border: 1.5px solid #e0e0e8 !important;
                    border-radius: 6px !important;
                    background: #fafaff !important;
                    color: #4a4a6a !important;
                    cursor: pointer !important;
                    transition: all 0.2s !important;
                    font-family: inherit !important;
                    text-align: center !important;
                    height: auto !important;
                    text-transform: none !important;
                    letter-spacing: normal !important;
                }
                .gk-preset-btn:hover {
                    border-color: #667eea !important;
                    color: #667eea !important;
                    background: rgba(102, 126, 234, 0.05) !important;
                }

                .gk-destroy-btn {
                    width: 100% !important;
                    margin-top: 8px !important;
                    padding: 6px 0 !important;
                    font-size: 11px !important;
                    border: 1.5px solid #f87171 !important;
                    border-radius: 8px !important;
                    background: transparent !important;
                    color: #f87171 !important;
                    cursor: pointer !important;
                    transition: all 0.2s !important;
                    font-family: inherit !important;
                    text-align: center !important;
                    height: auto !important;
                    text-transform: none !important;
                    letter-spacing: normal !important;
                }
                .gk-destroy-btn:hover {
                    background: #f87171 !important;
                    color: white !important;
                }
            `;
            document.head.appendChild(style);

            // 齿轮按钮
            const gear = document.createElement('div');
            gear.id = 'gk-helper-gear';
            gear.innerHTML = '⚙️';
            gear.title = '挂机助手设置';
            document.body.appendChild(gear);

            // 设置面板
            const panel = document.createElement('div');
            panel.id = 'gk-helper-panel';
            panel.innerHTML = `
                <h4><span class="gk-status"></span>挂机助手 · 运行中</h4>
                <div class="gk-row">
                    <input type="number" id="gk-speed-input" min="0.1" max="16" step="0.5" value="${currentSpeed}">
                    <button class="gk-btn" id="gk-speed-btn">设置倍速</button>
                </div>
                <div class="gk-preset-row">
                    <button class="gk-preset-btn" data-speed="1">1x</button>
                    <button class="gk-preset-btn" data-speed="2">2x</button>
                    <button class="gk-preset-btn" data-speed="4">4x</button>
                    <button class="gk-preset-btn" data-speed="8">8x</button>
                    <button class="gk-preset-btn" data-speed="16">16x</button>
                </div>
                <div class="gk-row">
                    <label class="gk-switch-label">
                        <input type="checkbox" class="gk-toggle" id="gk-autoclick-switch" ${autoClickEnabled ? 'checked' : ''}>
                        自动处理弹窗
                    </label>
                </div>
                <div id="gk-speed-tips">当前倍速: <span id="gk-cur-speed">${currentSpeed}</span>x</div>
                <button class="gk-destroy-btn" id="gk-destroy-btn" style="border-color: #f87171 !important; color: #f87171 !important; background: transparent !important;">⏸ 暂停加速</button>
            `;
            document.body.appendChild(panel);

            // 交互绑定：只通过齿轮按钮切换面板
            gear.addEventListener('click', (e) => {
                e.stopPropagation();
                panel.classList.toggle('open');
            });

            // 阻止面板内部点击事件冒泡到页面（防止页面其他逻辑干扰面板）
            panel.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            panel.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
            panel.addEventListener('mouseup', (e) => {
                e.stopPropagation();
            });

            const speedInput = document.getElementById('gk-speed-input');
            const speedBtn = document.getElementById('gk-speed-btn');
            const curSpeedTxt = document.getElementById('gk-cur-speed');
            const clickSwitch = document.getElementById('gk-autoclick-switch');
            const destroyBtn = document.getElementById('gk-destroy-btn');

            function applySpeed(speed) {
                let s = parseFloat(speed);
                if (isNaN(s)) return;
                s = Math.max(0.1, Math.min(16, s));

                GM_setValue('custom_video_speed', s);
                curSpeedTxt.textContent = s;
                speedInput.value = s;

                // 使用原始 setter 直接设置，绕过劫持
                document.querySelectorAll('video').forEach(video => {
                    if (originalPlaybackRateDesc && originalPlaybackRateDesc.set) {
                        originalPlaybackRateDesc.set.call(video, s);
                    }
                });
                log('倍速已设置为:', s + 'x');
            }

            speedBtn.onclick = () => applySpeed(speedInput.value);

            // 回车键也能保存
            speedInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') applySpeed(speedInput.value);
            });

            // 预设倍速按钮
            panel.querySelectorAll('.gk-preset-btn').forEach(btn => {
                btn.onclick = () => applySpeed(btn.dataset.speed);
            });

            clickSwitch.onchange = (e) => {
                GM_setValue('auto_click_popup', e.target.checked);
                log('自动点击弹窗:', e.target.checked ? '已开启' : '已关闭');
            };

            // 暂停/恢复按钮
            destroyBtn.onclick = () => {
                if (!isPaused) {
                    // 暂停：恢复1倍速，停止加速但保留界面
                    isPaused = true;
                    GM_setValue('custom_video_speed', 1);
                    curSpeedTxt.textContent = '1';
                    speedInput.value = '1';
                    // 将所有视频恢复1倍速
                    document.querySelectorAll('video').forEach(video => {
                        if (originalPlaybackRateDesc && originalPlaybackRateDesc.set) {
                            originalPlaybackRateDesc.set.call(video, 1);
                        }
                    });
                    destroyBtn.textContent = '▶ 恢复加速';
                    destroyBtn.style.borderColor = '#4ade80';
                    destroyBtn.style.color = '#4ade80';
                    // 更新标题状态
                    const h4 = panel.querySelector('h4');
                    if (h4) h4.innerHTML = '<span class="gk-status" style="background:#f87171 !important;animation:none !important;"></span>挂机助手 · 已暂停';
                    log('脚本已暂停，倍速恢复为1x');
                } else {
                    // 恢复
                    isPaused = false;
                    const savedSpeed = parseFloat(speedInput.value) || 1;
                    applySpeed(savedSpeed > 1 ? savedSpeed : 2);
                    destroyBtn.textContent = '⏸ 暂停加速';
                    destroyBtn.style.borderColor = '#f87171';
                    destroyBtn.style.color = '#f87171';
                    const h4 = panel.querySelector('h4');
                    if (h4) h4.innerHTML = '<span class="gk-status"></span>挂机助手 · 运行中';
                    log('脚本已恢复运行');
                }
            };

        } catch (err) {
            warn('GUI 渲染出错:', err);
        }
    }

    // 保存原始 descriptor 的引用给其他函数使用
    const originalPlaybackRateDesc = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype, 'playbackRate'
    );

    // ============================================================
    // 4. 视频检测 — 使用 MutationObserver 替代 setInterval
    //    响应更快、性能更好
    // ============================================================
    function startVideoDetection() {
        // 先检查当前页面是否已有视频
        if (document.querySelector('video')) {
            initHelper();
            return;
        }

        // 使用 MutationObserver 监控 DOM 变化
        observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    if (node.tagName === 'VIDEO' || node.querySelector?.('video')) {
                        initHelper();
                        observer.disconnect();
                        observer = null;
                        return;
                    }
                }
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        // 兜底：30秒后如果 Observer 还没触发，用一次性检查兜底
        const fallbackTimer = setTimeout(() => {
            if (!isInitialized && document.querySelector('video')) {
                initHelper();
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
            }
        }, 30000);
        timers.push(fallbackTimer);

        log('视频检测器已启动 (MutationObserver 模式)');
    }

    // 根据 DOM 就绪状态启动检测
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startVideoDetection);
    } else {
        startVideoDetection();
    }

    // ============================================================
    // 5. 清理/销毁机制
    // ============================================================
    function destroy() {
        timers.forEach(id => {
            clearInterval(id);
            clearTimeout(id);
        });
        timers.length = 0;

        if (observer) {
            observer.disconnect();
            observer = null;
        }

        isInitialized = false;
        log('所有定时器和观察器已清理');
    }

    // 页面卸载时自动清理
    window.addEventListener('beforeunload', destroy);

    // 注册油猴菜单命令，方便快捷操作
    try {
        GM_registerMenuCommand('⏹ 停止挂机助手', destroy);
        GM_registerMenuCommand('🔄 重新检测视频', () => {
            destroy();
            isInitialized = false;
            startVideoDetection();
        });
    } catch (e) {
        // GM_registerMenuCommand 可能不可用
    }

})();