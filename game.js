// ========================================================
//  Bubble Smash – game.js
//  Pixi.js 7 + Matter.js 0.19  |  6-colour Pearl Blast
// ========================================================

// ====== Matter aliases ======
const Engine    = Matter.Engine;
const Runner    = Matter.Runner;
const Bodies    = Matter.Bodies;
const Composite = Matter.Composite;
const Events    = Matter.Events;

// ====== Pixi app & containers ======
let app;
let engine;
let gameStage, cupContainer, pearlsContainer, linesContainer;
let connectionLine;

// ====== Physics ======
let pearls   = [];
let cupWalls = [];

// ====== Interaction ======
let isDragging    = false;
let selectedPearls = [];

// ====== Game flags ======
let isGameReady = false;
let gameOver    = false;
let spawnInterval = null;
let cupTopY     = 0;
let overflowTimer = 0;
let currentMoney  = 0;
let lastShakeTime = 0;
let shakeCount    = 0;
let runner; // 新增：Matter.js 運行器供暫停使用
let isPaused  = false; // 新增：暫停狀態標記
let masterVolume = 0.6; // 全域音量
let inputSensitivity = 1.0; // 靈敏度 (影響 Shake 力量)

// ====== Items Inventory ======
let itemInventory = { bomb: 0, clear_color: 0, color_swap: 0, time_pause: 0 };
let unlockedLevels = { bomb: 4, clear_color: 9, color_swap: 14, time_pause: 19 }; // Level 5, 10, 15, 20
let hasRewardedForLevel = { bomb: false, clear_color: false, color_swap: false, time_pause: false };
let activeItemState = null; // 追蹤目前使用的道具: null, 'bomb', 'color_swap' 等
let swapColorTarget = null; // 上色槍選中的顏色 key

// ====== Sound ======
// (gracefully ignore missing files)
function tryAudio(src) {
    try { const a = new Audio(src); a.volume = 0.6; return a; }
    catch(e) { return null; }
}
const sndBottom = tryAudio('mp3/buttum.mp3');
const sndPearl  = tryAudio('mp3/bu_drop.mp3');
const sndConnection = tryAudio('mp3/連線後.mp3');
const sndAttention = tryAudio('mp3/call-to-attention.mp3');
const sndMachine = tryAudio('mp3/bubble_machine.MP3');
const sndClick   = tryAudio('mp3/matthewvakaliuk73627-mouse-click-290204.mp3');
const sndTickTock = tryAudio('mp3/ticktock.mp3');
const sndMoneyIn  = tryAudio('mp3/入帳.mp3');
const sndLevelComplete = tryAudio('mp3/universfield-game-level-complete-143022.mp3');
const sndOrderClick = tryAudio('mp3/點擊訂單.mp3');
if (sndMachine) {
    sndMachine.loop = true;
    sndMachine.volume = masterVolume;
}
if (sndClick) sndClick.volume = masterVolume;

function updateAllVolumes() {
    const list = [sndBottom, sndPearl, sndConnection, sndAttention, sndMachine, sndClick, sndTickTock, sndMoneyIn, sndLevelComplete, sndOrderClick];
    list.forEach(s => { if (s) s.volume = masterVolume; });
}

let isSpawning = false;
let machineSoundTimeout = null;

function playMachineSound(durationMs) {
    if (!sndMachine) return;
    sndMachine.play().catch(() => {});
    if (machineSoundTimeout) clearTimeout(machineSoundTimeout);
    machineSoundTimeout = setTimeout(() => {
        sndMachine.pause();
        sndMachine.currentTime = 0;
    }, durationMs);
}

let lastBottomSound = 0, lastPearlSound = 0;
function playOnce(audioEl, cooldown = 200) {
    if (!audioEl) return;
    const now = Date.now();
    if (now - (audioEl._last || 0) > cooldown) {
        audioEl._last = now;
        const clone = audioEl.cloneNode();
        clone.play().catch(() => {});
    }
}

// ====== 6-Colour Pearl Definition ======
// Each entry has a key used in orders/collected maps
const PEARL_TYPES = [
    { key:'red',      label:'草莓', base: 0xff595e, dark: 0xc92a31, css: '#ff595e', icon: 'https://cdn-icons-png.flaticon.com/128/590/590685.png' },
    { key:'yellow',   label:'芒果', base: 0xffca3a, dark: 0xd69e00, css: '#ffca3a', icon: 'https://cdn-icons-png.flaticon.com/128/14868/14868880.png' },
    { key:'green',    label:'抹茶', base: 0x8ac926, dark: 0x5a910a, css: '#8ac926', icon: 'https://cdn-icons-png.flaticon.com/128/11489/11489564.png' },
    { key:'blue',     label:'藍莓', base: 0x1982c4, dark: 0x0f5685, css: '#1982c4', icon: 'https://cdn-icons-png.flaticon.com/128/4057/4057335.png' },
    { key:'purple',   label:'芋頭', base: 0x9b5de5, dark: 0x5c2d91, css: '#9b5de5', icon: 'https://cdn-icons-png.flaticon.com/128/3546/3546879.png' },
    { key:'orange',   label:'橘子', base: 0xff9f1c, dark: 0xcf7400, css: '#ff9f1c', icon: 'https://cdn-icons-png.flaticon.com/128/1728/1728765.png' },
    { key:'original', label:'原味珍珠', base: 0x3d2b1f, dark: 0x1a0f0a, css: '#3d2b1f', icon: 'https://cdn-icons-png.flaticon.com/128/16484/16484372.png' },
    { key:'sugar',    label:'糖塊',   base: 0xffffff, dark: 0xe0e0e0, css: '#ffffff', icon: 'png/sugar.png', shape:'rect' },
    { key:'sakura',   label:'櫻花香', base: 0xffb7c5, dark: 0xe68a9c, css: '#ffb7c5', icon: 'https://cdn-icons-png.flaticon.com/128/7096/7096466.png' },
];

// ====== Level Data ======
// Each level defines which pearl keys appear and what amounts are required.
// Part 1-3: no time limit, no anger.  Part 4+: timer & anger active.
const LEVEL_DATA = [
    // Level 1: 原味教學 (固定訂單, 1張單, 無時限, 無怒氣)
    { allowedKeys: ['original', 'sugar', 'red', 'yellow', 'green'], order: { original:8, sugar:4 }, maxOrders: 1, neededOrders: 1, hasTimer: false, bossAngerActive: false, hasObstacles: false, unlockedItem: 'none' },
    
    // Level 2-3: 多色預熱 (多色, 1張單, 無時限, 無怒氣)
    { allowedKeys: ['red','yellow'], order: { red:6, yellow:4 }, maxOrders: 1, neededOrders: 1, hasTimer: false, bossAngerActive: false, hasObstacles: false, unlockedItem: 'none' }, // L2
    { allowedKeys: ['red','yellow','green'], order: { red:6, yellow:5, green:5 }, maxOrders: 1, neededOrders: 1, hasTimer: false, bossAngerActive: false, hasObstacles: false, unlockedItem: 'none' }, // L3
    
    // Level 4-5: 雙單/多單考驗 (多色, 2-3張單, 無時限, 無怒氣)
    { allowedKeys: ['red','yellow','green','blue'], order: { red:5, blue:5 }, maxOrders: 2, neededOrders: 2, hasTimer: false, bossAngerActive: false, hasObstacles: false, unlockedItem: 'none' }, // L4
    { allowedKeys: ['red','yellow','green','blue','purple'], order: { green:6, purple:5 }, maxOrders: 3, neededOrders: 3, hasTimer: false, bossAngerActive: false, hasObstacles: false, unlockedItem: 'none' }, // L5

    // Level 6-7: 限時與生存 (啟動計時器 & 怒氣扣血)
    { allowedKeys: PEARL_TYPES.map(p=>p.key), order: { red:7, sugar:4 }, maxOrders: 2, neededOrders: 2, hasTimer: true, bossAngerActive: true, hasObstacles: false, unlockedItem: 'none' }, // L6
    { allowedKeys: PEARL_TYPES.map(p=>p.key), order: { original:8, sakura:5 }, maxOrders: 2, neededOrders: 2, hasTimer: true, bossAngerActive: true, hasObstacles: false, unlockedItem: 'none' }, // L7

    // Level 8-9: 障礙物出現
    { allowedKeys: PEARL_TYPES.map(p=>p.key), order: { red:8, yellow:8 }, maxOrders: 2, neededOrders: 3, hasTimer: true, bossAngerActive: true, hasObstacles: true, unlockedItem: 'none' }, // L8
    { allowedKeys: PEARL_TYPES.map(p=>p.key), order: { sugar:10, original:10 }, maxOrders: 3, neededOrders: 3, hasTimer: true, bossAngerActive: true, hasObstacles: true, unlockedItem: 'none' }, // L9

    // Level 10-14: 解鎖「爆珠 (Bomb)」
    { allowedKeys: PEARL_TYPES.map(p=>p.key), order: { blue:10 }, maxOrders: 3, neededOrders: 4, hasTimer: true, bossAngerActive: true, hasObstacles: true, unlockedItem: 'bomb' }, // L10
    // ...過渡關卡按階段遞增...
    { allowedKeys: PEARL_TYPES.map(p=>p.key), order: { red:12 }, maxOrders: 3, neededOrders: 4, hasTimer: true, bossAngerActive: true, hasObstacles: true, unlockedItem: 'bomb' }, // L14

    // Level 15-19: 解鎖「同色消除 (Clear Color)」
    { allowedKeys: PEARL_TYPES.map(p=>p.key), order: { orange:12 }, maxOrders: 3, neededOrders: 5, hasTimer: true, bossAngerActive: true, hasObstacles: true, unlockedItem: 'clear_color' }, // L15

    // Level 20-24: 解鎖「消失球 (Blackhole)」
    { allowedKeys: PEARL_TYPES.map(p=>p.key), order: { purple:15 }, maxOrders: 3, neededOrders: 5, hasTimer: true, bossAngerActive: true, hasObstacles: true, unlockedItem: 'blackhole' }, // L20

    // Level 25+: 解鎖「時間暫停 (Time Pause)」
    { allowedKeys: PEARL_TYPES.map(p=>p.key), order: { total:50 }, maxOrders: 4, neededOrders: 6, hasTimer: true, bossAngerActive: true, hasObstacles: true, unlockedItem: 'none' }, // L25
];

// --- 自動生成第 26 關至第 60 關 ---
for (let i = 26; i <= 60; i++) {
    const difficultyScale = i / 60;
    const colorCount = 3 + Math.floor(difficultyScale * 4); // 3~7 種顏色
    const totalGoal = 30 + Math.floor(difficultyScale * 100); // 30~130 總量
    const keys = PEARL_TYPES.slice(0, Math.min(PEARL_TYPES.length, colorCount)).map(p => p.key);
    
    LEVEL_DATA.push({
        allowedKeys: keys,
        order: { total: totalGoal },
        maxOrders: 3 + Math.floor(difficultyScale * 3), // 3~6 張單
        neededOrders: 5 + Math.floor(difficultyScale * 10), // 5~15 成功次數
        hasTimer: true,
        bossAngerActive: true,
        hasObstacles: i > 35,
        targetTime: 500 + Math.floor(difficultyScale * 300), // 500s~800s 寬裕時限
        unlockedItem: 'none'
    });
}

// ====== Game State ======
let currentLevelIdx = 0;   // index into LEVEL_DATA
let activeOrders    = [];   // 新：所有活躍訂單
let orderIdCounter  = 0;    // 訂單 ID 計數器
let selectedOrderId = null; // 新：當前選中/展開的訂單 ID
let bossHp          = 5;    // 愛心生命值
let wrongMatchCount = 0;    // 連續錯誤連線次數
let levelOrdersFinished = 0; // 新：追蹤單一關卡已完成訂單數
let spawnPool       = [];   // which pearl types are currently spawnable
let gameMode        = 'story';
let levelStartTime  = Date.now(); // 新增：追蹤單一關卡的開始時間
// 移除：currentOrder, collected, bossAnger, timerValue, timerInterval, isTimeLimitActive

// ====== DOM Handles ======
const domLevelNum      = document.getElementById('level-num');
const domOrderGrid     = document.getElementById('order-grid');
const domOrderCount    = document.getElementById('order-count-badge');
const domHearts        = document.querySelectorAll('.heart');
const domFeedback      = document.getElementById('feedback-banner');
const domStartScreen   = document.getElementById('start-screen');
const domGameOverScreen= document.getElementById('game-over-screen');
const domGameOverTitle = document.getElementById('game-over-title');
const domLevelClear    = document.getElementById('level-clear-screen');
const domFinalLevel    = document.getElementById('final-level');
const domLevelClearMsg = document.getElementById('level-clear-msg');
const domStoryBtn      = document.getElementById('story-mode-btn');
const domArcadeBtn     = document.getElementById('arcade-mode-btn');
const domRestartBtn    = document.getElementById('restart-btn');
const domNextLevelBtn  = document.getElementById('next-level-btn');
const domMoneyValue    = document.getElementById('money-value');
const domShakeBtn      = document.getElementById('shake-btn');
const domDropperSpout  = document.getElementById('dropper-spout');
const domItemBar       = document.getElementById('item-bar');
const domWarningLight  = document.getElementById('warning-light');
const domCollectionList = document.getElementById('collection-list');
const domCollectionTitle = document.querySelector('#beverage-panel .status-label');
const domPauseBtn = document.getElementById('pause-btn');
const domAdBtn = document.getElementById('ad-btn');
const domMoneyBox = document.getElementById('money-box');
const domPauseOverlay = document.getElementById('pause-overlay');
const domPauseContent = document.getElementById('pause-content');
const domLevelGrid    = document.getElementById('level-grid');
const domVolumeSlider = document.getElementById('volume-slider');
const domSensSlider   = document.getElementById('sensitivity-slider');
const domResumeBtn    = document.getElementById('resume-btn');

// [已移除舊版 Tablet Handles]

// CUSTOMER_NAMES replaced by window.CUSTOMER_DATA in order_data.js
const DRINK_TYPES    = ['芒草珍奶', '琥珀拿鐵', '極光珍珠', '炭培拿鐵', '翡翠金萱', '黑糖鮮奶', '雲霧烏龍'];

// ========================================================
//  INIT
// ========================================================
async function init() {
    // --- PixiJS ---
    app = new PIXI.Application({
        resizeTo: window,
        backgroundColor: 0xF2DCC2,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        antialias: true,
    });
    document.getElementById('game-container').appendChild(app.view);

    gameStage      = new PIXI.Container();
    cupContainer   = new PIXI.Container();
    pearlsContainer= new PIXI.Container();
    linesContainer = new PIXI.Container();
    gameStage.addChild(cupContainer, pearlsContainer, linesContainer);
    app.stage.addChild(gameStage);

    connectionLine = new PIXI.Graphics();
    linesContainer.addChild(connectionLine);

    // Interaction
    app.stage.eventMode = 'static';
    app.stage.hitArea   = new PIXI.Rectangle(-5000, -5000, 10000, 10000);
    app.stage.on('pointerup',        endDrag);
    app.stage.on('pointerupoutside', endDrag);
    app.stage.on('pointermove',      onPointerMove);

    // --- Matter.js ---
    engine = Engine.create();
    runner = Runner.create();
    Runner.run(runner, engine);

    // Sound on collision
    Events.on(engine, 'collisionStart', (e) => {
        if (gameOver || !isGameReady) return;
        for (const pair of e.pairs) {
            const isWall = cupWalls.some(w =>
                pair.bodyA.id === w.id || pair.bodyB.id === w.id
            );
            const speed = Math.max(pair.bodyA.speed, pair.bodyB.speed);
            if (isWall && speed > 1) { playOnce(sndBottom, 200); break; }
        }
    });

    // --- Game tick ---
    app.ticker.add(gameTick);

    // --- Window resize ---
    window.addEventListener('resize', () => {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        buildCup();
    });

    // --- Button events ---
    if (domStoryBtn) {
        domStoryBtn.addEventListener('click', () => {
            requestLandscape();
            gameMode = 'story';
            startGame('story');
        });
    }
    if (domArcadeBtn) {
        domArcadeBtn.addEventListener('click', () => {
            requestLandscape();
            gameMode = 'arcade';
            startGame('arcade');
        });
    }
    if (domRestartBtn) domRestartBtn.addEventListener('click', restartGame);
    if (domNextLevelBtn) domNextLevelBtn.addEventListener('click', advanceLevel);
    if (domShakeBtn) domShakeBtn.addEventListener('click', triggerShake);
    if (domPauseBtn) domPauseBtn.addEventListener('click', togglePause);
    if (domAdBtn) domAdBtn.addEventListener('click', handleAdClick);
    if (domResumeBtn) domResumeBtn.addEventListener('click', togglePause);

    // --- Item Events ---
    const items = document.querySelectorAll('.item-slot');
    items.forEach(slot => {
        slot.addEventListener('click', () => {
            if (isDragging || gameOver || isPaused || isSpawning) return; // 不可在操作中點擊
            const itemKey = slot.getAttribute('data-item');
            if (unlockedLevels[itemKey] !== undefined && currentLevelIdx >= unlockedLevels[itemKey]) {
                if (itemInventory[itemKey] > 0) {
                    activateItem(itemKey);
                } else {
                    promptAdForItem(itemKey);
                }
            } else {
                showFeedback('🔒 道具尚未解鎖', 'warn', 1000);
                if (sndBottom) playOnce(sndBottom, 0); // 給個失敗音效
            }
        });
    });

    // --- Settings Events ---
    if (domVolumeSlider) {
        domVolumeSlider.addEventListener('input', (e) => {
            masterVolume = parseFloat(e.target.value);
            updateAllVolumes();
        });
    }
    if (domSensSlider) {
        domSensSlider.addEventListener('input', (e) => {
            inputSensitivity = parseFloat(e.target.value);
        });
    }

    // --- Build Cup & Menu ---
    buildCup();
    initPauseMenu();
    updateAllVolumes();

    // Pre-load sounds
    [sndPearl, sndBottom, sndAttention, sndMachine, sndClick, sndTickTock, sndMoneyIn, sndLevelComplete, sndOrderClick].forEach(s => {
        if (s) s.load();
    });

    isGameReady = true;
}

// ========================================================
//  GAME TICK
// ========================================================
function gameTick() {
    // Sync physics -> Pixi
    for (const pearl of pearls) {
        pearl.view.position.x = pearl.body.position.x;
        pearl.view.position.y = pearl.body.position.y;
        pearl.view.rotation   = pearl.body.angle;
    }

    // Draw connection line
    connectionLine.clear();
    if (isDragging && selectedPearls.length > 0) {
        connectionLine.lineStyle(10, 0xffaa00, 0.85);
        connectionLine.moveTo(selectedPearls[0].view.position.x, selectedPearls[0].view.position.y);
        for (let i = 1; i < selectedPearls.length; i++) {
            connectionLine.lineTo(selectedPearls[i].view.position.x, selectedPearls[i].view.position.y);
        }
        const mp = app.renderer.events.pointer.global;
        connectionLine.lineTo(mp.x, mp.y);
    }

    // --- New: Update Order Timers ---
    if (!gameOver && isGameReady && !timePauseTimer) {
        const deltaTime = 1 / 60; 
        let expiredIds = [];
        let needsUIUpdate = false;
        
        activeOrders.forEach(order => {
            if (order.totalTime === Infinity) return;
            order.timeLeft -= deltaTime;
            needsUIUpdate = true; // 有計時訂單就需要更新 UI 讓條會動
            
            // --- 提醒音效 (50s 與 6s) ---
            if (order.timeLeft <= 50 && !order.played50s) {
                if (sndTickTock) sndTickTock.play().catch(() => {});
                order.played50s = true;
            }
            if (order.timeLeft <= 6 && !order.played6s) {
                if (sndTickTock) sndTickTock.play().catch(() => {});
                order.played6s = true;
            }

            if (order.timeLeft <= 0) {
                expiredIds.push(order.id);
            }
        });

        // 每 5 幀更新一次 UI 上的時間縮放即可 (約 0.08s)
        if (needsUIUpdate && app.ticker.lastTime % 5 < 1) {
            updateOrderTimersOnly();
        }

        if (expiredIds.length > 0) {
            expiredIds.forEach(id => {
                activeOrders = activeOrders.filter(o => o.id !== id);
                takeDamage("訂單超時！");
            });
            updateOrdersUI(); // 訂單數量變動，才需要重繪整個列表

            // 若場上沒有任何訂單，並且關卡尚未完成，判斷為超時滅團
            const def = LEVEL_DATA[Math.min(currentLevelIdx, LEVEL_DATA.length - 1)];
            if (activeOrders.length === 0 && levelOrdersFinished < def.neededOrders) {
                setTimeout(() => {
                    if (activeOrders.length === 0 && !gameOver) {
                        triggerGameOver('timeout');
                    }
                }, 2000);
            }
        }
    }

    // Overflow check (game over by spill)
    if (!gameOver && pearls.length > 18) {
        let overflowing = false;
        for (const p of pearls) {
            if (p.body.position.y < cupTopY - 60 && p.body.speed < 0.5) {
                overflowing = true; break;
            }
        }
        if (overflowing) {
            overflowTimer++;
            if (overflowTimer > 120) triggerGameOver('overflow');
        } else {
            overflowTimer = 0;
        }
    }
}

// ========================================================
//  CUP PHYSICS + VISUALS
// ========================================================
function buildCup() {
    if (cupWalls.length > 0) Composite.remove(engine.world, cupWalls);
    cupContainer.removeChildren();

    const w = app.screen.width, h = app.screen.height;
    const cupTopW    = Math.min(480, w * 0.82);
    const cupBottomW = cupTopW * 0.6;
    // 稍微縮短一點以容納底下的果汁機底座
    const cupH       = Math.min(540, h * 0.58);
    const thickness  = 40;

    const cx = w / 2;
    // 預留更多底部空間給加大的機座
    const cy = h - cupH / 2 - 95;
    cupTopY  = cy - cupH / 2;

    const wallAngle  = Math.atan2((cupTopW - cupBottomW) / 2, cupH);
    const wallLength = Math.hypot((cupTopW - cupBottomW) / 2, cupH);
    const leftX  = cx - (cupTopW + cupBottomW) / 4;
    const rightX = cx + (cupTopW + cupBottomW) / 4;

    const bottom = Bodies.rectangle(cx, cy + cupH/2, cupBottomW + thickness*2, thickness, { isStatic:true, friction:0.2 });
    const left   = Bodies.rectangle(leftX,  cy, thickness, wallLength + thickness, { isStatic:true, friction:0.2, angle: -wallAngle });
    const right  = Bodies.rectangle(rightX, cy, thickness, wallLength + thickness, { isStatic:true, friction:0.2, angle:  wallAngle });

    cupWalls = [bottom, left, right];
    Composite.add(engine.world, cupWalls);

    // Draw cup – clean lines aligned with physics
    const g = new PIXI.Graphics();

    const vThick    = thickness / 2;
    const topY      = cy - cupH / 2;
    const innerBotY = cy + cupH / 2 - vThick;
    const iTL = cx - cupTopW / 2;
    const iTR = cx + cupTopW / 2;
    const iBL = cx - cupBottomW / 2;
    const iBR = cx + cupBottomW / 2;

    // === 果汁機/雪克杯底座 (Machine Base) ===
    const baseTopW = cupBottomW + 40;
    const baseBotW = cupBottomW + 110; // 大幅拉寬底部搭配加大的按鈕
    const baseH    = 105; // 增加底座高度容納全新的 60px 高度按鈕

    // 底座外掛陰影
    g.lineStyle(0);
    g.beginFill(0x000000, 0.2);
    g.moveTo(cx - baseTopW / 2, innerBotY + 5);
    g.lineTo(cx + baseTopW / 2, innerBotY + 5);
    g.lineTo(cx + baseBotW / 2 + 10, innerBotY + baseH + 10);
    g.lineTo(cx - baseBotW / 2 - 10, innerBotY + baseH + 10);
    g.closePath();
    g.endFill();

    // 深咖啡色主底座 (#382010) - 使用梯形並模擬下方圓角
    g.beginFill(0x382010, 1);
    g.moveTo(cx - baseTopW / 2, innerBotY);
    g.lineTo(cx + baseTopW / 2, innerBotY);
    g.lineTo(cx + baseBotW / 2, innerBotY + baseH - 10);
    // 右下圓角
    g.quadraticCurveTo(cx + baseBotW / 2, innerBotY + baseH, cx + baseBotW / 2 - 12, innerBotY + baseH);
    g.lineTo(cx - baseBotW / 2 + 12, innerBotY + baseH);
    // 左下圓角
    g.quadraticCurveTo(cx - baseBotW / 2, innerBotY + baseH, cx - baseBotW / 2, innerBotY + baseH - 10);
    g.closePath();
    g.endFill();

    // 底座高光與連接環裝飾
    g.beginFill(0x57341b, 1); // 較淺的棕色增添立體感
    g.drawRect(cx - baseTopW / 2 + 10, innerBotY, baseTopW - 20, 12);
    g.endFill();

    // 機器按鈕/旋鈕裝飾 (只需兩側指示燈，因為中間會放 HTML 按鈕)
    g.beginFill(0x6eff8a, 1);
    g.drawCircle(cx - 85, innerBotY + baseH / 2, 6); // 往外移以免被 140px 新按鈕蓋住
    g.endFill();
    g.beginFill(0xffca3a, 1);
    g.drawCircle(cx + 85, innerBotY + baseH / 2, 6);
    g.endFill();

    // === 透明杯身 (Main Cup Body) ===
    // 內腔半透明填色
    g.lineStyle(0);
    g.beginFill(0xc8956a, 0.10);
    g.moveTo(iTL, topY);
    g.lineTo(iBL, innerBotY);
    g.lineTo(iBR, innerBotY);
    g.lineTo(iTR, topY);
    g.closePath();
    g.endFill();

    // 中央淡光帶
    g.beginFill(0xfff5e6, 0.07);
    g.moveTo(cx + cupTopW * 0.05, topY);
    g.lineTo(cx + cupTopW * 0.22, topY);
    g.lineTo(cx + cupBottomW * 0.18, innerBotY);
    g.lineTo(cx + cupBottomW * 0.04, innerBotY);
    g.closePath();
    g.endFill();

    // 外框深色線
    g.lineStyle(4, 0x7a4a1a, 0.9);
    g.moveTo(iTL, topY);
    g.lineTo(iBL, innerBotY);
    g.lineTo(iBR, innerBotY);
    g.lineTo(iTR, topY);

    // 內緣亮線（光澤感）
    g.lineStyle(1.5, 0xffd9a0, 0.45);
    g.moveTo(iTL + 3, topY);
    g.lineTo(iBL + 2, innerBotY);
    g.moveTo(iTR - 3, topY);
    g.lineTo(iBR - 2, innerBotY);

    cupContainer.addChild(g);

    // Sync UI to physical cup positions
    if (domDropperSpout) domDropperSpout.style.top = '0px';
    // Shake 按鈕定位在底座正中央
    if (domShakeBtn) domShakeBtn.style.top = (innerBotY + baseH / 2) + 'px';
}

// ========================================================
//  PEARL SPAWNER
// ========================================================
const PEARL_MIN   = 20;   // 最低珍珠數
const SPAWN_CHECK = 900;  // 檢查間隔 ms

function isCupOverfull() {
    // 有靜止珍珠超過杯頂則視為滿
    for (const p of pearls) {
        if (p.body.position.y < cupTopY && p.body.speed < 0.6) return true;
    }
    return false;
}

function spawnBatch(count) {
    if (isSpawning) return;
    isSpawning = true;

    if (domDropperSpout) domDropperSpout.classList.add('spout-shaking');
    if (domWarningLight) domWarningLight.classList.add('light-flashing');
    
    const delay = 1000;
    playMachineSound(delay + count * 160 + 800);

    for (let i = 0; i < count; i++) {
        // --- ITEM DROP CHANCE ---
        let dropItemKey = null;
        if (Math.random() < 0.02) {
            // Find which items are unlocked
            const availableItems = Object.keys(unlockedLevels).filter(k => currentLevelIdx >= unlockedLevels[k]);
            if (availableItems.length > 0) {
                dropItemKey = availableItems[Math.floor(Math.random() * availableItems.length)];
            }
        }

        if (dropItemKey) {
            setTimeout(() => spawnItemOrb(dropItemKey), delay + i * 160);
        } else {
            // --- 判斷 50 秒「智慧補珠輔助」模式 (靜默輔助) ---
            const isAssistMode = (Date.now() - levelStartTime > 50000);

            const neededKeys = getNeededKeys();
            let pt = spawnPool[Math.floor(Math.random() * spawnPool.length)];
            
            // Level 2+ 隨機掉落干擾色 (在輔助模式下，掉落機率大幅降低)
            const noiseChance = isAssistMode ? 0.05 : 0.2;
            if (currentLevelIdx >= 1 && Math.random() < noiseChance) {
                pt = PEARL_TYPES[Math.floor(Math.random() * PEARL_TYPES.length)];
            }

            // 輔助模式下權重提升 (由 60% 升至 90%)
            const neededWeight = isAssistMode ? 0.90 : 0.6;
            if (neededKeys.length > 0 && Math.random() < neededWeight) {
                 const rKey = neededKeys[Math.floor(Math.random() * neededKeys.length)];
                 pt = PEARL_TYPES.find(t => t.key === rKey);
            }

            // --- 倍數珍珠生成邏輯 (輔助模式下，所需珠子機率更高) ---
            let multiplier = 1;
            const multiProb = isAssistMode ? 0.25 : 0.12; 
            if (currentLevelIdx >= 5 && Math.random() < multiProb) {
                multiplier = Math.floor(2 + (currentLevelIdx - 5) / 3);
                multiplier = Math.min(20, multiplier);
            }

            setTimeout(() => spawnPearl(pt, multiplier), delay + i * 160);
        }
    }
    setTimeout(() => {
        if (domWarningLight) domWarningLight.classList.remove('light-flashing');
        if (domDropperSpout) domDropperSpout.classList.remove('spout-shaking');
        isSpawning = false;
    }, delay + count * 160);
}

function startSpawner() {
    stopSpawner();
    // Level 1 只要 4 顆就好，其他等級預設 PEARL_MIN (20)
    const initialCount = (currentLevelIdx === 0) ? 4 : PEARL_MIN;
    
    // 開局掉落
    spawnBatch(initialCount);
    
    // 之後定期檢查補珠
    spawnInterval = setInterval(() => {
        if (gameOver || isSpawning || isCupOverfull()) return;

        const currentMin = (currentLevelIdx === 0) ? 4 : PEARL_MIN;

        // --- 1. 計算需求與現況 ---
        let counts = {};
        PEARL_TYPES.forEach(pt => counts[pt.key] = 0);
        pearls.forEach(p => { if (p.type && counts[p.type.key] !== undefined) counts[p.type.key]++; });

        let pendingList = []; // 待補清單
        
        // --- 2. 檢查「絕對短缺」(訂單所需但場上極少) ---
        const aggregatedReq = {};
        const aggregatedColl = {};
        activeOrders.forEach(o => {
            for (let k in o.requirements) {
                aggregatedReq[k] = (aggregatedReq[k] || 0) + o.requirements[k];
                aggregatedColl[k] = (aggregatedColl[k] || 0) + (o.collected[k] || 0);
            }
        });

        for (const pt of spawnPool) {
            const needed = aggregatedReq[pt.key] || 0;
            const collectedAmt = aggregatedColl[pt.key] || 0;
            const remaining = Math.max(0, needed - collectedAmt);
            
            if (remaining > 0 && counts[pt.key] < 4) {
                const addCount = Math.min(3, remaining);
                for (let i = 0; i < addCount; i++) pendingList.push(pt);
                
                // 額外混入 1-2 顆隨機干擾色 (Level 2+ 從全品項中隨機)
                const noiseCount = Math.floor(Math.random() * 2) + 1;
                const noisePool = (currentLevelIdx >= 1) ? PEARL_TYPES : spawnPool;
                for (let i = 0; i < noiseCount; i++) {
                    pendingList.push(noisePool[Math.floor(Math.random() * noisePool.length)]);
                }
                break; // 每次只處理一種急件，避免累積太多
            }
        }

        // --- 3. 檢查「總量不足」(保證場上有足夠顆數) ---
        if (pendingList.length === 0 && pearls.length < currentMin) {
            const isAssistMode = (Date.now() - levelStartTime > 50000);
            const addTotal = (currentLevelIdx === 0) 
                ? (Math.floor(Math.random() * 2) + 2) // Level 1 只加 2~3 顆 
                : (Math.floor(Math.random() * 5) + 3); // 其他等級加 3~8 顆
            for (let i = 0; i < addTotal; i++) {
                // 加權隨機：訂單需要的顏色機率更高
                const neededKeys = getNeededKeys();
                const neededWeight = isAssistMode ? 0.90 : 0.7;

                if (neededKeys.length > 0 && Math.random() < neededWeight) {
                    const rKey = neededKeys[Math.floor(Math.random() * neededKeys.length)];
                    pendingList.push(PEARL_TYPES.find(t => t.key === rKey));
                } else {
                    // Level 2+ 隨機混入不同色
                    const pool = (currentLevelIdx >= 1 && Math.random() < 0.25) ? PEARL_TYPES : spawnPool;
                    pendingList.push(pool[Math.floor(Math.random() * pool.length)]);
                }
            }
        }

        // --- 4. 執行補珠 ---
        if (pendingList.length > 0) {
            isSpawning = true;
            const PRE_DROP = 800; // 稍微縮短預警到 0.8s
            playMachineSound(PRE_DROP + pendingList.length * 150 + 600);
            
            if (domWarningLight) domWarningLight.classList.add('light-flashing');
            if (domDropperSpout) domDropperSpout.classList.add('spout-shaking');
            
            pendingList.forEach((pt, idx) => {
                let multiplier = 1;
                const isAssistMode = (Date.now() - levelStartTime > 50000);
                const multiProb = isAssistMode ? 0.25 : 0.1;

                if (currentLevelIdx >= 5 && Math.random() < multiProb) {
                    multiplier = Math.floor(2 + (currentLevelIdx - 5) / 3);
                    multiplier = Math.min(20, multiplier);
                }
                setTimeout(() => spawnPearl(pt, multiplier), PRE_DROP + idx * 150);
            });

            setTimeout(() => {
                if (domWarningLight) domWarningLight.classList.remove('light-flashing');
                if (domDropperSpout) domDropperSpout.classList.remove('spout-shaking');
                isSpawning = false;
            }, PRE_DROP + pendingList.length * 150);
        }

    }, SPAWN_CHECK);
}

function stopSpawner() {
    if (spawnInterval) { clearInterval(spawnInterval); spawnInterval = null; }
    if (sndMachine) {
        sndMachine.pause();
        sndMachine.currentTime = 0;
    }
    if (machineSoundTimeout) {
        clearTimeout(machineSoundTimeout);
        machineSoundTimeout = null;
    }
    isSpawning = false;
}

function spawnPearl(specificType, multiplier = 1) {
    if (gameOver) return;

    // 觸發出料口的噴發 CSS 動畫
    if (domDropperSpout) {
        domDropperSpout.classList.remove('spout-dropping');
        void domDropperSpout.offsetWidth; // 強制瀏覽器重繪 (Reflow) 以便連續觸發
        domDropperSpout.classList.add('spout-dropping');
    }

    const typeEntry = specificType || spawnPool[Math.floor(Math.random() * spawnPool.length)];
    const radius    = 22 + Math.random() * 14;
    const cupTopW   = Math.min(480, app.screen.width * 0.82);
    const x         = app.screen.width / 2 + (Math.random() - 0.5) * (cupTopW - radius * 3);
    const y         = -radius;

    const isRect = typeEntry.shape === 'rect';
    const body   = isRect 
        ? Bodies.rectangle(x, y, radius * 1.8, radius * 1.8, {
            restitution: 0.05,
            friction: 0.9,
            density: 0.003,
            chamfer: { radius: 6 } // 圓角物理
          })
        : Bodies.circle(x, y, radius, {
            restitution: 0.15,
            friction: 0.7,
            density: 0.002,
          });

    const view = new PIXI.Container();
    const g    = new PIXI.Graphics();

    // If type has a texture, add it as a sprite
    if (typeEntry.texture) {
        const sprite = PIXI.Sprite.from(typeEntry.texture);
        sprite.anchor.set(0.5);
        sprite.width  = radius * 2.2; // Slightly larger for better fit
        sprite.height = radius * 2.2;
        view.addChild(sprite);
    }

    drawPearlGraphic(g, typeEntry, radius, false, multiplier);
    view.addChild(g);

    // --- 新增：倍數標籤文字渲染 ---
    if (multiplier > 1) {
        const mText = new PIXI.Text(`x${multiplier}`, {
            fontFamily: 'Segoe UI, Arial',
            fontSize: 22,
            fontWeight: '900',
            fill: 0xffffff,
            stroke: 0x000000,
            strokeThickness: 3,
            align: 'center'
        });
        mText.anchor.set(0.5);
        view.addChild(mText);
    }
    
    pearlsContainer.addChild(view);

    const pearlObj = { body, view, radius, id: body.id, type: typeEntry, multiplier };
    pearls.push(pearlObj);

    view.eventMode = 'static';
    view.cursor    = 'pointer';
    view.on('pointerdown', (e) => { e.stopPropagation(); startDrag(pearlObj); });
    view.on('pointerenter', ()  => onDragEnter(pearlObj));

    Composite.add(engine.world, body);
}

function spawnItemOrb(itemKey) {
    const r       = 28 + Math.random() * 6; // 稍微大一點點
    const cupTopW = Math.min(480, app.screen.width * 0.82);
    const x       = app.screen.width / 2 + (Math.random() - 0.5) * (cupTopW - r * 3);
    const y       = -r;

    const body = Bodies.circle(x, y, r, {
        restitution: 0.3, friction: 0.1, density: 0.003
    });

    const view = new PIXI.Container();
    const g    = new PIXI.Graphics();

    // 畫一個發光的透明玻璃球外觀代表道具
    g.beginFill(0xffffff, 0.8);
    g.lineStyle(3, 0xffd700, 1);
    g.drawCircle(0, 0, r);
    g.endFill();

    // 內縮一層高光
    g.beginFill(0xffffff, 0.4);
    g.drawEllipse(-r*0.2, -r*0.3, r*0.4, r*0.2);
    g.endFill();

    view.addChild(g);

    // 放置道具 Icon (emoji or text)
    const iconText = new PIXI.Text(getItemIcon(itemKey), { 
        fontSize: r * 1.2, 
        fontFamily: 'Segoe UI, Emoji',
        align: 'center'
    });
    iconText.anchor.set(0.5);
    view.addChild(iconText);

    pearlsContainer.addChild(view);

    const orbObj = { body, view, radius: r, id: body.id, isItem: true, itemKey: itemKey };
    pearls.push(orbObj);

    view.eventMode = 'static';
    view.cursor    = 'pointer';
    view.on('pointerdown', (e) => {
        e.stopPropagation();
        if (gameOver || isPaused || activeItemState) return;
        collectItemOrb(orbObj);
    });

    Composite.add(engine.world, body);
}

function collectItemOrb(orb) {
    // 拾取音效
    if (sndClick) playOnce(sndClick, 80);
    
    // 增加庫存
    itemInventory[orb.itemKey]++;
    updateItemUI(currentLevelIdx);
    
    showFloatingText(`+1 ${getItemIcon(orb.itemKey)}`, orb.body.position, '#ffd700');
    showFeedback(`撿到了一個 ${getItemIcon(orb.itemKey)}！`, 'success', 1500);

    // 移除物理碰撞與渲染
    Composite.remove(engine.world, orb.body);
    pearlsContainer.removeChild(orb.view);
    pearls = pearls.filter(p => p.id !== orb.id);
}

function drawPearlGraphic(g, typeEntry, r, highlighted = false, multiplier = 1) {
    g.clear();
    
    // Draw highlight background
    if (highlighted) {
        g.beginFill(0xffffff, 0.9);
        g.drawCircle(0, 0, r + 5);
        g.endFill();
    }

    // If it's a textured pearl, we skip the base graphics drawing
    if (typeEntry.texture) {
        if (highlighted) {
            // Optional: light overlay for image pearls when selected
            g.beginFill(0xffdd00, 0.25);
            g.drawCircle(0, 0, r);
            g.endFill();
        }
        return;
    }

    if (typeEntry.shape === 'rect') {
        const size = r * 1.8;
        // 方塊底色 (深色邊)
        g.beginFill(typeEntry.dark, 0.98);
        g.drawRoundedRect(-size/2, -size/2, size, size, 8);
        g.endFill();
        // 方塊主體
        g.beginFill(typeEntry.base, 0.95);
        g.drawRoundedRect(-size/2 + 2, -size/2 + 2, size - 4, size - 4, 6);
        g.endFill();

        // 新增：糖塊表面的灰色顆粒感 (粒狀紋理)
        g.beginFill(0x888888, 0.15); 
        for(let i=0; i<5; i++) {
            const px = (Math.random() - 0.5) * (size * 0.6);
            const py = (Math.random() - 0.5) * (size * 0.6);
            const ps = 1.5 + Math.random() * 2;
            g.drawCircle(px, py, ps);
        }
        g.endFill();
    } else {
        // Normal drawing for non-textured pearls
        g.beginFill(typeEntry.dark, 0.98);
        g.drawCircle(0, 0, r);
        g.endFill();
        g.beginFill(typeEntry.base, 0.95);
        g.drawCircle(-r*0.1, -r*0.1, r * 0.82);
        g.endFill();
    }
    // 高亮時加上半透明橘色覆層讓選取感更明顯
    if (highlighted) {
        g.beginFill(0xffdd00, 0.25);
        g.drawCircle(0, 0, r);
        g.endFill();
    }
    // 光澤高光 (根據形狀調整位置)
    g.beginFill(0xffffff, 0.32);
    if (typeEntry.shape === 'rect') {
        const size = r * 1.8;
        g.drawRoundedRect(-size*0.35, -size*0.35, size*0.4, size*0.12, 4);
    } else {
        g.drawEllipse(-r*0.32, -r*0.32, r*0.24, r*0.14);
    }
    g.endFill();

    // --- 倍數文字渲染 (x2 以上) ---
    if (multiplier > 1) {
        // 1. 加一個外發光環
        g.lineStyle(4, 0xffffff, 0.4);
        if (typeEntry.shape === 'rect') {
            const size = r * 1.8;
            g.drawRoundedRect(-size/2 - 2, -size/2 - 2, size + 4, size + 4, 8);
        } else {
            g.drawCircle(0, 0, r + 2);
        }
        g.lineStyle(0);
        
        // 2. 繪製文字 (使用 PIXI.Text 或直接畫在 Graphics 上)
        // 考量到效能，我們在 view 中加入 Text 物件可能更好，但這裡先用 Graphics 簡單畫一個標籤背景
        g.beginFill(0x000000, 0.5);
        g.drawRoundedRect(-r*0.7, -r*0.4, r*1.4, r*0.8, 5);
        g.endFill();

        // 由於 Graphics 繪製複雜文字較難，我們改在 spawnPearl 的 view 中加入一個 Text 物件
    }
}

// ========================================================
//  DRAG / CONNECTION LOGIC
// ========================================================
function startDrag(pearl) {
    if (gameOver || pearl.isItem || activeItemState) return;
    isDragging     = true;
    selectedPearls = [pearl];
    highlightPearl(pearl, true);
    playOnce(sndPearl, 80);
}

function ptSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx*dx + dy*dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / len2));
    return Math.hypot(px - (ax + t*dx), py - (ay + t*dy));
}

function isLineBlocked(from, to) {
    const ax = from.body.position.x, ay = from.body.position.y;
    const bx = to.body.position.x,   by = to.body.position.y;
    for (const p of pearls) {
        if (p.id === from.id || p.id === to.id) continue;
        if (selectedPearls.find(sp => sp.id === p.id)) continue;
        const d = ptSegDist(p.body.position.x, p.body.position.y, ax, ay, bx, by);
        if (d < p.radius * 0.75) return true;
    }
    return false;
}

function onDragEnter(pearl) {
    if (!isDragging || gameOver || pearl.isItem || activeItemState) return;
    
    // --- Backtrack (Undo) Logic ---
    // If we move back to the second-to-last pearl, pop the current last one
    if (selectedPearls.length >= 2) {
        const secondToLast = selectedPearls[selectedPearls.length - 2];
        if (pearl.id === secondToLast.id) {
            const removed = selectedPearls.pop();
            highlightPearl(removed, false);
            playOnce(sndPearl, 120); // Slightly different pitch feel
            return;
        }
    }

    if (selectedPearls.find(p => p.id === pearl.id)) return;

    const last = selectedPearls[selectedPearls.length - 1];
    if (pearl.type.key !== last.type.key) return;

    const dist    = Math.hypot(last.body.position.x - pearl.body.position.x,
                               last.body.position.y - pearl.body.position.y);
    const maxDist = (last.radius + pearl.radius) * 1.5;  // 僅允許緊鄰
    if (dist <= maxDist && !isLineBlocked(last, pearl)) {
        selectedPearls.push(pearl);
        highlightPearl(pearl, true);
        playOnce(sndPearl, 80);
    }
}

function onPointerMove(e) {
    if (!isDragging || gameOver) return;
    const pos = e.global;
    for (const p of pearls) {
        if (!selectedPearls.find(sp => sp.id === p.id)) {
            const d = Math.hypot(p.body.position.x - pos.x, p.body.position.y - pos.y);
            if (d < p.radius) onDragEnter(p);
        }
    }
}

function getNeededKeys() {
    const needed = new Set();
    activeOrders.forEach(order => {
        for (let k in order.requirements) {
            if ((order.collected[k] || 0) < order.requirements[k]) {
                needed.add(k);
            }
        }
    });
    return Array.from(needed);
}

function endDrag() {
    if (!isDragging) return;
    isDragging = false;

    if (selectedPearls.length >= 3) {
        const colorKey = selectedPearls[0].type.key;
        const baseCount = selectedPearls.length;

        // --- 新增：計算總倍率 (連乘) ---
        let totalMultiplier = 1;
        selectedPearls.forEach(p => {
            if (p.multiplier && p.multiplier > 1) {
                totalMultiplier *= p.multiplier;
            }
        });
        const finalCount = baseCount * totalMultiplier;

        let matchedAtLeastOne = false;

        // --- New Logic: Allocate ONLY to the selected order ---
        const selectedOrder = activeOrders.find(o => o.id === selectedOrderId);
        
        if (selectedOrder) {
            const needed    = selectedOrder.requirements[colorKey] || 0;
            const have      = selectedOrder.collected[colorKey] || 0;
            const remaining = Math.max(0, needed - have);

            if (remaining > 0) {
                matchedAtLeastOne = true;
                // 將倍數後的總數加進訂單
                selectedOrder.collected[colorKey] += finalCount;
                
                // 顯示浮動文字提示 (顯示最終數量)
                showFloatingText(`+${finalCount}`, selectedPearls[0].body.position, selectedPearls[0].type.css);
                
                // 同步更新 UI
                updateOrdersUI();
                updateBeveragePanel();

                // Check for individual order completion
                if (isOrderDone(selectedOrder)) {
                    handleOrderCompletion(selectedOrder);
                }
            } else {
                showFeedback(`❌ 選中的訂單不需此色`, 'warn', 1000);
            }
        } else {
            showFeedback("💡 請先點選一張訂單！", 'warn', 1500);
        }

        if (matchedAtLeastOne) {
            animatePearlElimination(selectedPearls, colorKey, true, finalCount);
        } else {
            // No order needs this color
            wrongMatchCount++;
            showFeedback(`❌ 不要浪費原料 (${wrongMatchCount}/5)`, 'fail', 1000);
            animatePearlElimination(selectedPearls, colorKey, false);
            
            if (wrongMatchCount >= 5) {
                wrongMatchCount = 0;
                takeDamage("錯誤累積過多！");
            }
        }
        updateOrdersUI();

    } else {
        // Too few – just unhighlight
        for (const p of selectedPearls) highlightPearl(p, false);
    }

    selectedPearls = [];
}

function isOrderDone(order) {
    for (let k in order.requirements) {
        if ((order.collected[k] || 0) < order.requirements[k]) return false;
    }
    return true;
}

function handleOrderCompletion(order) {
    // Fast Bonus Check (< 50% time consumed)
    const timeUsed = order.totalTime - order.timeLeft;
    if (timeUsed < order.totalTime * 0.5) {
        const bonus = 50;
        // 獎勵金幣飛越
        const orderCards = document.querySelectorAll('.order-card');
        let startPos = { x: window.innerWidth - 100, y: 200 };
        // 嘗試找到對應的卡片位置
        const card = Array.from(orderCards).find(c => c.innerHTML.includes(order.customerName));
        if (card) {
            const rect = card.getBoundingClientRect();
            startPos = { x: rect.left + 50, y: rect.top + 50 };
        }
        animateMoneyFly(startPos, bonus, true); // true 代表是訂單完成大獎
        showFeedback("⚡ 快速完成獎勵！", "success", 1200);
    }

    const orderPrice = Object.values(order.requirements).reduce((a,b)=>a+b, 0) * 12 + 20;
    // 獲取該訂單卡片的位置作為起點
    const orderCards = document.querySelectorAll('.order-card');
    let finalStartPos = { x: window.innerWidth - 100, y: 200 };
    const orderCard = Array.from(orderCards).find(c => c.innerHTML.includes(order.customerName));
    if (orderCard) {
        const rect = orderCard.getBoundingClientRect();
        finalStartPos = { x: rect.left + 50, y: rect.top + 50 };
    }
    
    // 延後一點點執行，讓卡片消失動畫更有節奏
    setTimeout(() => {
        animateMoneyFly(finalStartPos, orderPrice, true);
    }, 100);

    playOnce(sndBottom, 0); // Completion sound
    activeOrders = activeOrders.filter(o => o.id !== order.id);
    levelOrdersFinished++;
    
    // 同步更新 UI：讓完成的單子立即消失，且計數標籤立即更新
    updateOrdersUI();
    updateBeveragePanel();

    // 如果完成的是當前選中的訂單，自動選下一個
    if (selectedOrderId === order.id) {
        selectedOrderId = activeOrders.length > 0 ? activeOrders[0].id : null;
        updateOrdersUI();
        updateBeveragePanel();
    }

    const def = LEVEL_DATA[Math.min(currentLevelIdx, LEVEL_DATA.length - 1)];

    // 檢查是否達成關卡過關條件 (Needed Orders)
    if (levelOrdersFinished >= def.neededOrders) {
        stopSpawner();
        
        // 播放過關音效
        if (sndLevelComplete) {
            sndLevelComplete.currentTime = 0;
            sndLevelComplete.play().catch(() => {});
        }

        setTimeout(() => {
            if (domLevelClear) domLevelClear.style.display = 'flex';
        }, 1200);
        return;
    }

    // 2. 只有在「已完成」+「場上剩餘」小於「該關目標」時，才補新單 (避免最後一波還在補單)
    const pendingAndFinished = levelOrdersFinished + activeOrders.length;
    if (activeOrders.length < def.maxOrders && pendingAndFinished < def.neededOrders) {
        setTimeout(() => {
            if (!gameOver) generateOrder();
        }, 1500);
    }
}

function takeDamage(reason) {
    if (gameOver) return;

    // 只有在怒氣機制啟動時才真正扣血
    const def = LEVEL_DATA[Math.min(currentLevelIdx, LEVEL_DATA.length - 1)];
    if (def && !def.bossAngerActive) {
        showFeedback(`💡 ${reason} (level 1 ~ 5不扣血)`, 'warn', 1500);
        return;
    }

    bossHp--;
    
    // Heart UI pop animation
    const heartNodes = document.querySelectorAll('.heart.active');
    if (heartNodes.length > 0) {
        const lastHeart = heartNodes[heartNodes.length - 1];
        lastHeart.classList.remove('active');
        lastHeart.classList.add('pop');
    }

    showFeedback(`💔 ${reason}`, 'fail', 1500);
    if (bossHp <= 0) triggerGameOver('anger');
}

function highlightPearl(pearl, on) {
    const g = pearl.view.children[0];
    drawPearlGraphic(g, pearl.type, pearl.radius, on);
}

// --- New: Pearl Elimination Animation Sequence ---
function animatePearlElimination(chain, colorKey, shouldFly = true, finalCount = 0) {
    if (chain.length === 0) return;

    // Get target position (tea can image)
    const canImg = document.querySelector('.tea-cup-img');
    let targetX = app.screen.width * 0.1; 
    let targetY = app.screen.height * 0.55;
    if (canImg) {
        const rect = canImg.getBoundingClientRect();
        targetX = rect.left + rect.width / 2;
        targetY = rect.top + rect.height / 2;
    }

    chain.forEach((p, idx) => {
        // 先從邏輯陣列移除，防止再次選取，但先不從 Matter 世界移除以支撐上方珍珠
        pearls = pearls.filter(gp => gp.id !== p.id);
        if (p.body) {
            Matter.Body.setStatic(p.body, true); // 設為靜態，防止其位移
        }

        setTimeout(() => {
            // Play sound for each pop in the chain
            playOnce(sndConnection, 0);

            const view = p.view;
            
            // A. 連環爆: Improved "Pop" scaling
            let popTick = 0;
            const popDuration = 12; // 12 frames for pop
            const popLoop = () => {
                popTick++;
                let t = popTick / popDuration;
                // Scale up and back down fast
                let s = 1 + Math.sin(t * Math.PI) * 0.6; 
                view.scale.set(s);
                
                if (popTick >= popDuration) {
                    view.scale.set(1);
                    app.ticker.remove(popLoop);

                    // 此時再移除物理剛體，讓上方珍珠掉下來
                    if (p.body) {
                        Composite.remove(engine.world, p.body);
                    }

                    if (shouldFly) {
                        // --- 強化：倍數飛行特效 ---
                        // 如果 finalCount 很大，每一顆連線珠子都會帶出幾顆「幻影珠」
                        const extraCount = (finalCount > chain.length) ? Math.ceil((finalCount - chain.length) / chain.length) : 0;
                        const cappedExtra = Math.min(8, extraCount); // 每顆最多帶 8 顆幻影，避免畫面太亂

                        startFlight(view, false); // 飛原本那顆

                        for (let i = 0; i < cappedExtra; i++) {
                            setTimeout(() => {
                                // 創建一顆僅供視覺使用的幻影珍珠
                                const ghostView = new PIXI.Container();
                                const ghostG = new PIXI.Graphics();
                                drawPearlGraphic(ghostG, p.type, p.radius);
                                ghostView.addChild(ghostG);
                                ghostView.x = view.x + (Math.random() - 0.5) * 20;
                                ghostView.y = view.y + (Math.random() - 0.5) * 20;
                                ghostView.alpha = 0.5; // 半透明
                                ghostView.rotation = view.rotation;
                                pearlsContainer.addChild(ghostView);
                                startFlight(ghostView, true);
                            }, (i + 1) * 60);
                        }
                    } else {
                        // If not flying, just fade out and remove
                        let fadeTick = 0;
                        const fadeLoop = () => {
                            fadeTick += 0.1;
                            view.alpha = 1 - fadeTick;
                            if (fadeTick >= 1) {
                                app.ticker.remove(fadeLoop);
                                pearlsContainer.removeChild(view);
                            }
                        };
                        app.ticker.add(fadeLoop);
                    }
                }
            };
            app.ticker.add(popLoop);

            // B. 飛去撞擊: Eased movement + Parabolic curve + Rotation
            // B. 飛去撞擊
            function startFlight(targetView, isGhost = false) {
                const startX = targetView.x;
                const startY = targetView.y;
                const startRot = targetView.rotation;
                const targetRot = startRot + (Math.random() - 0.5) * 4;
                
                let flyTick = 0;
                const flyDuration = isGhost ? 30 : 25; 
                const arcHeight   = isGhost ? -150 : -120; 

                const flyLoop = () => {
                    flyTick++;
                    let t = flyTick / flyDuration;
                    let easedT = t * t * (3 - 2 * t);
                    
                    if (t >= 1) {
                        easedT = 1;
                        app.ticker.remove(flyLoop);
                        onHitCan(targetView, isGhost);
                    }

                    const lx = startX + (targetX - startX) * easedT;
                    const ly = startY + (targetY - startY) * easedT;
                    const arc = Math.sin(easedT * Math.PI) * arcHeight;
                    
                    targetView.x = lx;
                    targetView.y = ly + arc;
                    targetView.rotation = startRot + (targetRot - startRot) * easedT;
                    targetView.alpha = (isGhost ? 0.5 : 1) - easedT * 0.3;
                    targetView.scale.set((isGhost ? 0.7 : 1) - easedT * 0.4);
                };
                app.ticker.add(flyLoop);
            }

            function onHitCan(targetView, isGhost = false) {
                if (targetView.parent) {
                    targetView.parent.removeChild(targetView);
                }
                
                // 只有非幻影珠或第一顆撞擊時觸發罐子震動
                if (!isGhost) {
                    if (canImg) {
                        canImg.src = 'png/tea_can_done.png';
                        canImg.style.transform = 'scale(1.15) rotate(-3deg)';
                        setTimeout(() => {
                            canImg.style.transform = 'scale(1) rotate(0deg)';
                        }, 120);
                    }
                    showFloatingText('✨', { x: targetX, y: targetY }, '#ffffff');
                }
            }

        }, idx * 120); // 120ms interval
    });
}

// ========================================================
//  SYSTEM REDESIGN
// ========================================================
function generateOrder() {
    const id = orderIdCounter++;
    const def = LEVEL_DATA[Math.min(currentLevelIdx, LEVEL_DATA.length - 1)];
    
    let requirements = {};
    let collected = {};

    if (currentLevelIdx === 0) {
        // Level 1 固定的教學訂單
        for (let k in def.order) {
            requirements[k] = def.order[k];
            collected[k] = 0;
        }
    } else {
        // 其他關卡依照需求權重或隨機生成
        const numTypes = Math.floor(Math.random() * 2) + 2; // 2-3 types
        const shuffled = [...PEARL_TYPES].filter(pt => def.allowedKeys.includes(pt.key)).sort(() => 0.5 - Math.random());
        shuffled.slice(0, numTypes).forEach(pt => {
            const amt = Math.floor(Math.random() * 5) + (3 + currentLevelIdx); // 隨關卡增加基本量
            requirements[pt.key] = amt;
            collected[pt.key] = 0;
        });
    }

    const duration = def.hasTimer ? (def.targetTime || 500) + (Math.random() * 60) : Infinity;

    const customer = window.CUSTOMER_DATA ? window.CUSTOMER_DATA[Math.floor(Math.random() * window.CUSTOMER_DATA.length)] : { name: "Guest", avatar: "https://via.placeholder.com/40" };
    const newOrder = {
        id,
        customerName: customer.name,
        customerAvatar: customer.avatar,
        drinkName: DRINK_TYPES[Math.floor(Math.random() * DRINK_TYPES.length)],
        requirements,
        collected,
        timeLeft: duration,
        totalTime: duration,
        played50s: false, // 提醒標記：50秒
        played6s: false   // 提醒標記：6秒
    };

    activeOrders.push(newOrder);

    // 如果當前沒選中任何單，自動選中新訂單
    if (selectedOrderId === null) {
        selectedOrderId = id;
    }

    updateOrdersUI();
    updateBeveragePanel();
}

function updateOrdersUI() {
    if (!domOrderGrid) return;
    domOrderGrid.innerHTML = '';
    
    activeOrders.forEach(order => {
        const hasTimer = order.totalTime !== Infinity;
        const pct = hasTimer ? (order.timeLeft / order.totalTime) * 100 : 0;
        const card = document.createElement('div');
        const isSelected = order.id === selectedOrderId;
        card.className = `order-card ${isSelected ? 'expanded selected' : ''}`;
        card.dataset.id = order.id; // 綁定 ID 方便增量更新
        
        // Toggle expansion (Accordion)
        card.onclick = (e) => {
            if (sndOrderClick) {
                sndOrderClick.currentTime = 0;
                sndOrderClick.play().catch(() => {});
            }
            selectedOrderId = isSelected ? null : order.id;
            updateOrdersUI();
            updateBeveragePanel();
        };

        const price = Object.values(order.requirements).reduce((a,b)=>a+b, 0) * 12 + 20;
        const timerHtml = hasTimer ? `
            <div style="width:100%; margin-top:8px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span class="timer-text" style="color:#ffe066; font-weight:900; font-size:1rem; text-shadow:0 0 10px rgba(255,224,102,0.4);">⏳ ${Math.ceil(order.timeLeft)}s</span>
                    <span style="color:#ffe066; font-size:0.75rem; font-weight:800; letter-spacing:1px; text-transform:uppercase; opacity:0.9;">Time Limit</span>
                </div>
                <div class="timer-bar-container" style="margin-top:0;">
                    <div class="timer-bar-fill ${pct < 30 ? 'urgent' : pct < 60 ? 'warning' : ''}" 
                         style="width: ${pct}%;"></div>
                </div>
            </div>
        ` : `<div style="width:100%; margin-top:8px; display:flex; align-items:center; gap:10px; opacity:0.7;">
                <div style="padding:4px 8px; background:rgba(255,255,255,0.1); border-radius:6px; font-size:0.8rem; font-weight:800; color:#aaa;">
                    Level 1~5 (不限時)
                </div>
             </div>`;

        card.innerHTML = `
            <div class="card-header" style="display:flex; flex-direction:column; gap:4px; width:100%;">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <img src="${order.customerAvatar || 'https://via.placeholder.com/44'}" alt="${order.customerName}" style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.3); background: rgba(255,255,255,0.1); object-fit: cover; flex-shrink: 0;">
                        <div style="color:white; font-weight:900; font-size:1.2rem;">${order.customerName}</div>
                    </div>
                    <div style="color:#6eff8a; font-weight:900; font-size:1.6rem; text-shadow: 0 0 10px rgba(110,255,138,0.4);">$${price}</div>
                </div>
                ${timerHtml}
            </div>
            <div class="card-content">
                <div class="req-list">
                    ${Object.entries(order.requirements).map(([key, needed]) => {
                        const pt = PEARL_TYPES.find(t => t.key === key);
                        const have = order.collected[key] || 0;
                        const done = have >= needed;
                        
                        // 原味珍珠用圓圈，其他用插圖
                        const iconHtml = (pt.key === 'original') 
                            ? `<div style="width:16px; height:16px; border-radius:50%; background:${pt.css}; border:1.5px solid #fff; box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`
                            : `<img src="${pt.icon}" style="width:18px; height:18px; object-fit:contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">`;
                            
                        return `
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:5px;">
                                ${iconHtml}
                                <span style="color:${done?'#6eff8a':'#fff'}; font-size:1rem; font-weight:700;">${pt.label}: ${have}/${needed}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        domOrderGrid.appendChild(card);
    });

    if (domOrderCount) domOrderCount.textContent = activeOrders.length;
}

/**
 * 增量更新：只更新倒數文字與進度條，不重繪 DOM
 */
function updateOrderTimersOnly() {
    activeOrders.forEach(order => {
        if (order.totalTime === Infinity) return;
        const card = domOrderGrid.querySelector(`.order-card[data-id="${order.id}"]`);
        if (!card) return;

        const timerText = card.querySelector('.timer-text');
        const timerFill = card.querySelector('.timer-bar-fill');
        
        if (timerText) {
            timerText.textContent = `⏳ ${Math.ceil(order.timeLeft)}s`;
        }
        
        if (timerFill) {
            const pct = (order.timeLeft / order.totalTime) * 100;
            timerFill.style.width = `${pct}%`;
            
            // 根據剩餘時間切換警告樣式 (與原本邏輯一致)
            timerFill.classList.remove('warning', 'urgent');
            if (pct < 30) timerFill.classList.add('urgent');
            else if (pct < 60) timerFill.classList.add('warning');
        }
    });
}

function updateBeveragePanel() {
    if (!domCollectionList) return;
    domCollectionList.innerHTML = '';
    
    const order = activeOrders.find(o => o.id === selectedOrderId);
    if (!order) {
        if (domCollectionTitle) domCollectionTitle.textContent = "🧋 收集進度";
        domCollectionList.innerHTML = '<div style="color:#4a2c16; font-size:0.95rem; font-weight:700; opacity:0.6;">請先點選訂單...</div>';
        return;
    }

    // 更新左側標題為客戶名稱
    if (domCollectionTitle) {
        domCollectionTitle.textContent = `🧋 ${order.customerName} 的進度`;
    }

    Object.entries(order.requirements).forEach(([key, needed]) => {
        const have = order.collected[key] || 0;
        if (have >= needed) return; // 已完成的品項直接消失 (不渲染)

        const typeEntry = PEARL_TYPES.find(t => t.key === key);
        const isSugar = typeEntry.key === 'sugar';
        const pill = document.createElement('div');
        pill.className = 'pearl-pill';
        pill.innerHTML = `
            <span class="pill-dot" style="background:${typeEntry.css}; box-shadow: 0 0 6px ${typeEntry.css}88; border: ${isSugar ? '1px solid #000' : '1px solid rgba(255,255,255,0.3)'};"></span>
            <span class="pill-text">${have}/${needed}</span>
        `;
        domCollectionList.appendChild(pill);
    });

    // 如果所有品項都消失了（代表都集滿了），顯示完成訊息
    if (domCollectionList.children.length === 0) {
        domCollectionList.innerHTML = '<div style="color:#6eff8a; font-size:1.1rem; font-weight:900; filter: drop-shadow(0 0 5px rgba(110,255,138,0.5));">✨ 製作完成！</div>';
    }
}

function loadLevel(idx) {
    // Reset HP & Stats
    bossHp = 5;
    wrongMatchCount = 0;
    levelOrdersFinished = 0;
    activeOrders = [];
    orderIdCounter = 0;
    selectedOrderId = null;
    
    // UI Reset
    domHearts.forEach(h => { h.classList.add('active'); h.classList.remove('pop'); });
    domLevelNum.textContent = idx + 1;
    
    // Clear cup
    clearPearls();
    
    // Spawner config
    const def = LEVEL_DATA[Math.min(idx, LEVEL_DATA.length - 1)];
    spawnPool = def.allowedKeys.map(k => PEARL_TYPES.find(t => t.key === k));

    // 依照 maxOrders 生成初始訂單
    for (let i = 0; i < def.maxOrders; i++) {
        setTimeout(() => {
            if (!gameOver) generateOrder();
        }, i * 1500); // 錯開生成節奏
    }

    // --- 新增：重設關卡計時 ---
    levelStartTime = Date.now();

    // --- UI 道具列解鎖邏輯 ---
    updateItemUI(idx);
    
    updateOrdersUI();
    updateBeveragePanel();
}

function updateItemUI(idx) {
    if (!domItemBar) return;
    
    // bomb unlock is at idx 4 (Level 5)
    if (idx >= 4) { 
        domItemBar.classList.remove('hidden');
    } else {
        domItemBar.classList.add('hidden');
    }

    // 根據 unlockedLevels 解鎖個別按鈕並給予初次獎勵
    const items = document.querySelectorAll('.item-slot');
    items.forEach(slot => {
        const itemKey = slot.getAttribute('data-item');
        if (unlockedLevels[itemKey] !== undefined && idx >= unlockedLevels[itemKey]) {
            slot.classList.remove('lock');
            
            // 初次解鎖贈送 3 個
            if (!hasRewardedForLevel[itemKey]) {
                itemInventory[itemKey] += 3;
                hasRewardedForLevel[itemKey] = true;
                showFeedback(`🎉 解鎖新道具！送你 3 個試吃`, 'success', 2500);
            }

            const iconEl = slot.querySelector('.icon');
            const badgeEl = slot.querySelector('.badge');
            if (iconEl) iconEl.textContent = getItemIcon(itemKey);
            if (badgeEl) badgeEl.textContent = itemInventory[itemKey];

            // 如果用完了，加一個視覺灰階但是可以點（準備點擊看廣告）
            if (itemInventory[itemKey] <= 0) {
                slot.classList.add('empty');
            } else {
                slot.classList.remove('empty');
            }
        } else {
            slot.classList.add('lock');
            const iconEl = slot.querySelector('.icon');
            if (iconEl) iconEl.textContent = '🔒';
        }
    });
}

// 輔助函式：取得道具圖示
function getItemIcon(key) {
    const icons = {
        'bomb': '💣',
        'clear_color': '🌈',
        'blackhole': '🕳️',
        'time_pause': '⏱️'
    };
    return icons[key] || '❓';
}

// [已移除舊版單訂單與計時輔助函式]

// [已移除舊版單訂單處理函式]

function advanceLevel() {
    domLevelClear.style.display = 'none';
    currentLevelIdx++;
    clearPearls();
    loadLevel(currentLevelIdx);
    startSpawner();
}

function resetCurrentLevel() {
    stopSpawner();
    clearPearls();
    loadLevel(currentLevelIdx);
    startSpawner();
}

// ========================================================
//  FLOATING TEXT
// ========================================================
function showFloatingText(text, pos, cssColor) {
    const hexColor = parseInt(cssColor.replace('#',''), 16);
    const t = new PIXI.Text(text, {
        fontFamily: 'Segoe UI, Arial',
        fontSize:   28,
        fontWeight: '900',
        fill:       hexColor,
        stroke:     0x000000,
        strokeThickness: 5,
        align: 'center',
    });
    t.position.set(pos.x, pos.y);
    t.anchor.set(0.5);
    gameStage.addChild(t);
    let tick = 0;
    const loop = () => {
        tick++;
        t.y -= 1.8;
        t.alpha -= 0.022;
        if (tick > 45) { gameStage.removeChild(t); app.ticker.remove(loop); }
    };
    app.ticker.add(loop);
}

function showFeedback(msg, cls = 'warn', autoDismissMs = 1500) {
    if (sndAttention) {
        sndAttention.currentTime = 0;
        sndAttention.play().catch(() => {});
    }
    if (!domFeedback) return;
    domFeedback.textContent = msg;
    domFeedback.className   = cls;
    domFeedback.style.display = 'block';
    if (autoDismissMs > 0) {
        setTimeout(() => { domFeedback.style.display = 'none'; }, autoDismissMs);
    }
}

// ========================================================
//  GAME FLOW
// ========================================================
function startGame(mode = 'story') {
    domStartScreen.style.display = 'none';
    gameMode = (typeof mode === 'string') ? mode : 'story';
    
    currentLevelIdx = 0;
    currentMoney    = 0;
    
    // Reset Inventory if playing from start
    if (mode === 'story') {
        itemInventory = { bomb: 0, clear_color: 0, color_swap: 0, time_pause: 0 };
        hasRewardedForLevel = { bomb: false, clear_color: false, color_swap: false, time_pause: false };
    }
    
    updateMoneyUI();
    gameOver        = false;

    clearPearls();
    loadLevel(currentLevelIdx);
    startSpawner();
}

function restartGame() {
    console.log("Restarting game at level index:", currentLevelIdx);
    if (domGameOverScreen) domGameOverScreen.style.display = 'none';
    if (domLevelClear) domLevelClear.style.display     = 'none';
    if (domFeedback) domFeedback.style.display       = 'none';
    // 不再重置 currentLevelIdx 與 currentMoney，讓 retryLevel 功能更合理
    gameOver        = false;

    // Remove dim overlay if any
    for (let i = app.stage.children.length - 1; i >= 0; i--) {
        const c = app.stage.children[i];
        if (c.isDimming) {
            app.stage.removeChild(c);
        }
    }

    clearPearls();
    loadLevel(currentLevelIdx);
    startSpawner();
}

function triggerGameOver(reason = 'anger') {
    if (gameOver) return;
    gameOver = true;
    stopSpawner();

    // dim canvas
    const dim = new PIXI.Graphics();
    dim.isDimming = true;
    dim.beginFill(0x000000, 0.65);
    dim.drawRect(0, 0, app.screen.width, app.screen.height);
    dim.endFill();
    app.stage.addChild(dim);

    if (domGameOverTitle) {
        if (reason === 'timeout') {
            domGameOverTitle.textContent = "⏱️ 訂單全數超時！";
        } else if (reason === 'overflow') {
            domGameOverTitle.textContent = "💥 珍珠滿溢了！";
        } else {
            domGameOverTitle.textContent = "💔 老闆爆氣了！";
        }
    }

    domFinalLevel.textContent = currentLevelIdx + 1;
    setTimeout(() => { domGameOverScreen.style.display = 'flex'; }, 600);
}

function clearPearls() {
    for (const p of pearls) {
        Composite.remove(engine.world, p.body);
        pearlsContainer.removeChild(p.view);
    }
    pearls = [];
    overflowTimer = 0;
}

function updateMoneyUI() {
    if (domMoneyValue) domMoneyValue.textContent = '$' + currentMoney;
}

function triggerShake() {
    if (gameOver || !isGameReady) return;
    const now = Date.now();
    if (now - lastShakeTime < 700) return; // 稍微拉長冷卻防鬼畜
    lastShakeTime = now;

    // Optional feedback
    playOnce(sndBottom, 0);

    // 加入杯身視覺震動動畫
    let shakeTicks = 12;
    const shakeLoop = () => {
        if (shakeTicks > 0) {
            cupContainer.position.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
            shakeTicks--;
        } else {
            cupContainer.position.set(0, 0);
            app.ticker.remove(shakeLoop);
        }
    };
    app.ticker.add(shakeLoop);

    // Apply moderate random upwards impulse
    for (const p of pearls) {
        if (p.body && p.body.position) {
            // 放大約 2.5 倍的衝量
            const forceX = (Math.random() - 0.5) * 0.10 * inputSensitivity;
            const forceY = (-0.15 - (Math.random() * 0.12)) * inputSensitivity;
            Matter.Body.applyForce(p.body, p.body.position, { x: forceX, y: forceY });
        }
    }

    // --- 新增：Shake 超過 8 次自動補珠 ---
    shakeCount++;
    if (shakeCount >= 8) {
        shakeCount = 0;
        if (!isSpawning) {
            spawnBatch(8); // 補 8 顆
        }
    }
}


// ========================================================
//  NEW: PAUSE & AD & MONEY ANIMATION
// ========================================================
function togglePause() {
    if (gameOver) return;
    isPaused = !isPaused;

    // 播放指定音效 (mp3/matthew...)
    if (sndClick) {
        sndClick.currentTime = 0;
        sndClick.play().catch(() => {});
    }

    if (isPaused) {
        runner.enabled = false;
        app.ticker.stop();
        domPauseBtn.classList.add('is-paused');
        domPauseOverlay.style.display = 'flex';
        updateLevelGridUI(); // 更新當前關卡高亮
    } else {
        runner.enabled = true;
        app.ticker.start();
        domPauseBtn.classList.remove('is-paused');
        domPauseOverlay.style.display = 'none';
    }
}

function initPauseMenu() {
    if (!domLevelGrid) return;
    domLevelGrid.innerHTML = '';
    for (let i = 0; i < 60; i++) {
        const btn = document.createElement('div');
        btn.className = 'level-btn';
        btn.textContent = i + 1;
        btn.onclick = () => {
            console.log("Level button clicked:", i + 1);
            currentLevelIdx = i;
            togglePause(); // 關閉選單
            
            // 強制中止可能還在跑的 spawner 與過期計時
            stopSpawner();
            
            restartGame(); // 重啟當前選擇的關卡
            showFeedback(`跳轉至第 ${i + 1} 關！`, "success", 2000); // 新增反饋確保執行成功
        };
        domLevelGrid.appendChild(btn);
    }
}

function updateLevelGridUI() {
    if (!domLevelGrid) return;
    const btns = domLevelGrid.querySelectorAll('.level-btn');
    btns.forEach((btn, idx) => {
        if (idx === currentLevelIdx) btn.classList.add('current');
        else btn.classList.remove('current');
    });
}

function handleAdClick() {
    if (isPaused || gameOver) return;
    
    showFeedback("📺 正在加載廣告...", "success", 2000);
    
    // 模擬廣告觀看結束後的獎勵
    setTimeout(() => {
        if (gameOver) return;
        const reward = 200;
        showFeedback("🎁 感謝觀看！獲得獎勵 $200", "success", 2000);
        
        // 從廣告按鈕飛出金幣
        const rect = domAdBtn.getBoundingClientRect();
        animateMoneyFly({ x: rect.left + 30, y: rect.top + 30 }, reward, true);
    }, 2500);
}

function animateMoneyFly(startPos, amount, isBigReward = false) {
    // 1. 建立飛越元素
    const coin = document.createElement('div');
    coin.className = 'flying-coin';
    coin.textContent = isBigReward ? `💰` : `+$${amount}`;
    document.body.appendChild(coin);

    // 2. 獲取錢包位置 (終點)
    const walletRect = domMoneyBox.getBoundingClientRect();
    const endX = walletRect.left + 40;
    const endY = walletRect.top + 25;

    // 3. 初始位置
    coin.style.left = startPos.x + 'px';
    coin.style.top = startPos.y + 'px';

    // 4. 動畫路徑 (使用 Web Animations API)
    const duration = isBigReward ? 1000 : 700;
    
    // 播放音效 (如果是大獎播放 level_pass)
    if (isBigReward && typeof sndAttention !== 'undefined') {
        const passSnd = new Audio('mp3/level_pass.mp3');
        passSnd.volume = 0.5;
        passSnd.play().catch(()=>{});
    } else {
        playOnce(sndPearl, 0);
    }

    const anim = coin.animate([
        { transform: `translate(0, 0) scale(0.5)`, opacity: 0 },
        { transform: `translate(0, -30px) scale(1.2)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${(endX - startPos.x) * 0.8}px, ${(endY - startPos.y) * 0.8}px) scale(1)`, opacity: 1, offset: 0.8 },
        { transform: `translate(${endX - startPos.x}px, ${endY - startPos.y}px) scale(0.8)`, opacity: 0 }
    ], {
        duration: duration,
        easing: 'cubic-bezier(0.165, 0.84, 0.44, 1)'
    });

    anim.onfinish = () => {
        document.body.removeChild(coin);
        
        // 更新數值
        currentMoney += amount;
        updateMoneyUI();

        // 播放「入帳」音效
        if (sndMoneyIn) {
            sndMoneyIn.currentTime = 0;
            sndMoneyIn.play().catch(() => {});
        }
        
        // 錢包反饋動畫
        domMoneyBox.classList.remove('wallet-pop');
        void domMoneyBox.offsetWidth; // trigger reflow
        domMoneyBox.classList.add('wallet-pop');
        
        // 播放撞擊音效
        playOnce(sndBottom, 0);
    };
}

// ========================================================
//  ITEM SYSTEM
// ========================================================
function promptAdForItem(itemKey) {
    if (confirm(`庫存不足！要觀看廣告獲得一個「${getItemIcon(itemKey)}」嗎？`)) {
        showFeedback("📺 正在加載廣告...", "success", 2000);
        setTimeout(() => {
            itemInventory[itemKey]++;
            showFeedback(`🎁 獲得一個 ${getItemIcon(itemKey)}!`, "success", 2000);
            updateItemUI(currentLevelIdx);
        }, 2500);
    }
}

let targetOverlay = null;
let timePauseTimer = null; // 用來追蹤時間暫停

function activateItem(itemKey) {
    if (activeItemState) return; // a different item is already active
    
    // UI 反饋：將選中的道具標記為 active
    const slots = document.querySelectorAll('.item-slot');
    slots.forEach(s => {
        if (s.getAttribute('data-item') === itemKey) s.classList.add('active');
        else s.classList.remove('active');
    });

    if (itemKey === 'bomb') {
        activeItemState = 'bomb';
        showTargetOverlay('💣 點擊杯子內任意位置引爆！');
    } else if (itemKey === 'clear_color') {
        activeItemState = 'clear_color';
        openColorPicker('消除哪種顏色？');
    } else if (itemKey === 'color_swap') {
        activeItemState = 'color_swap';
        openColorPicker('漆彈要換成哪種顏色？');
    } else if (itemKey === 'time_pause') {
        executeTimePause();
    }
}

function showTargetOverlay(instruction) {
    if (!targetOverlay) {
        targetOverlay = new PIXI.Graphics();
        targetOverlay.eventMode = 'static';
        targetOverlay.cursor = 'crosshair';
        targetOverlay.on('pointerdown', handleTargetClick);
        app.stage.addChild(targetOverlay);
    }
    targetOverlay.clear();
    targetOverlay.beginFill(0x000000, 0.4);
    targetOverlay.drawRect(0, 0, app.screen.width, app.screen.height);
    targetOverlay.endFill();
    targetOverlay.visible = true;
    
    showFeedback(instruction, 'success', 3000);
}

function hideTargetOverlay() {
    if (targetOverlay) {
        targetOverlay.visible = false;
    }
}

function cancelItemUse() {
    activeItemState = null;
    swapColorTarget = null;
    hideTargetOverlay();
    
    // 清除所有道具的 active 狀態
    const slots = document.querySelectorAll('.item-slot');
    slots.forEach(s => s.classList.remove('active'));

    const modal = document.getElementById('color-picker-modal');
    if (modal) modal.classList.add('hidden');
    
    showFeedback("已取消使用", "warn", 1000);
}

function handleTargetClick(e) {
    if (!activeItemState) return;
    const pos = e.global;

    if (activeItemState === 'bomb') {
        executeBomb(pos);
    } else if (activeItemState === 'color_swap') {
        executeColorSwap(pos, swapColorTarget);
    }
}

function openColorPicker(titleText) {
    const modal = document.getElementById('color-picker-modal');
    const title = document.getElementById('color-picker-title');
    const grid = document.getElementById('color-picker-grid');
    
    if (!modal || !grid) return;
    
    title.textContent = titleText;
    grid.innerHTML = '';
    
    // 從這關的 pool 抓可用的單純顏色 (排除不需要塗色的特殊物)
    spawnPool.forEach(pt => {
        const btn = document.createElement('div');
        btn.className = 'color-swatch-btn';
        btn.style.background = pt.css;
        
        if (pt.icon && pt.key !== 'original') {
            btn.innerHTML = `<img src="${pt.icon}">`;
        }
        
        btn.onclick = () => {
            modal.classList.add('hidden');
            if (activeItemState === 'clear_color') {
                executeClearColor(pt.key);
            } else if (activeItemState === 'color_swap') {
                swapColorTarget = pt.key;
                showTargetOverlay('🔫 點擊珍珠，將周圍染色！');
            }
        };
        grid.appendChild(btn);
    });
    
    modal.classList.remove('hidden');
}

function clearActiveItemSlots() {
    const slots = document.querySelectorAll('.item-slot');
    slots.forEach(s => s.classList.remove('active'));
}

function consumeItem(itemKey) {
    itemInventory[itemKey]--;
    updateItemUI(currentLevelIdx);
    clearActiveItemSlots();
}

// ------ 4大能力的具體執行 ------
function executeBomb(pos) {
    consumeItem('bomb');
    activeItemState = null;
    hideTargetOverlay();

    if (sndBottom) playOnce(sndBottom, 0); // Explosion sound replacement
    showFloatingText('💥 爆炸！', pos, '#ff3b30');

    if (domDropperSpout) domDropperSpout.classList.add('spout-shaking');
    setTimeout(() => { if (domDropperSpout) domDropperSpout.classList.remove('spout-shaking'); }, 300);

    const bombRadius = 130; 
    const killed = [];
    pearls.forEach(p => {
        const d = Math.hypot(p.body.position.x - pos.x, p.body.position.y - pos.y);
        if (d <= bombRadius && !p.isItem) {
            killed.push(p);
        } else if (d <= bombRadius * 1.5) {
            // Apply blast force to others
            const forceMag = 0.08 * (1 - d / (bombRadius * 1.8));
            if (forceMag > 0) {
                const angle = Math.atan2(p.body.position.y - pos.y, p.body.position.x - pos.x);
                Matter.Body.applyForce(p.body, p.body.position, {
                    x: Math.cos(angle) * forceMag * inputSensitivity,
                    y: Math.sin(angle) * forceMag * inputSensitivity
                });
            }
        }
    });

    if (killed.length > 0) {
        animatePearlElimination(killed, 'none', false); // false = 原地消失不飛越 UI
    }
}

function executeClearColor(colorKey) {
    consumeItem('clear_color');
    activeItemState = null;

    showFeedback("✨ 顏色消除！", "success", 1500);
    const killed = pearls.filter(p => !p.isItem && p.type.key === colorKey);
    if (killed.length > 0) {
        animatePearlElimination(killed, colorKey, false);
    }
}

function executeColorSwap(pos, targetColorKey) {
    consumeItem('color_swap');
    activeItemState = null;
    hideTargetOverlay();
    swapColorTarget = null;
    
    const swapRadius = 90; 
    const targetType = PEARL_TYPES.find(t => t.key === targetColorKey);
    if (!targetType) return;
    
    showFloatingText('🎨 染色！', pos, targetType.css);
    if (sndPearl) playOnce(sndPearl, 100);
    
    pearls.forEach(p => {
        if (p.isItem) return;
        const d = Math.hypot(p.body.position.x - pos.x, p.body.position.y - pos.y);
        if (d <= swapRadius) {
            p.type = targetType;
            if (p.view && p.view.children[0]) {
                const g = p.view.children[0];
                drawPearlGraphic(g, targetType, p.radius);
            }
            // Pop effect
            p.view.scale.set(1.4);
            setTimeout(() => { p.view.scale.set(1); }, 150);
        }
    });
}

function executeTimePause() {
    consumeItem('time_pause');
    activeItemState = null; // 確保狀態重置
    clearActiveItemSlots(); // 確保 UI 重置
    
    showFeedback("❄️ 時間暫停 10 秒！", "success", 2000);
    document.body.style.filter = "hue-rotate(180deg) blur(0.5px) contrast(1.2)";
    document.body.style.transition = "filter 0.5s ease"; // 平滑濾鏡
    
    if (timePauseTimer) {
        clearTimeout(timePauseTimer);
    }
    
    timePauseTimer = setTimeout(() => {
        document.body.style.filter = "none";
        showFeedback("⏱️ 時間恢復流動", "warn", 1500);
        timePauseTimer = null;
    }, 10000);
}

// ========================================================
//  BOOT / INIT
// ========================================================
// [已移除重複且損壞的 init 函式]

window.onload = init;

// --- Orientation Lock Helper ---
function requestLandscape() {
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(e => {
            console.log('Orientation lock failed:', e.message);
        });
    }
}

