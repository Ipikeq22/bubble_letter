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

// ====== Sound ======
// (gracefully ignore missing files)
function tryAudio(src) {
    try { const a = new Audio(src); a.volume = 0.6; return a; }
    catch(e) { return null; }
}
const sndBottom = tryAudio('mp3/buttum.mp3');
const sndPearl  = tryAudio('mp3/bu_drop.mp3');

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
    { key:'red',    label:'紅珍珠', base: 0xff595e, dark: 0xc92a31, css: '#ff595e' },
    { key:'yellow', label:'黃珍珠', base: 0xffca3a, dark: 0xd69e00, css: '#ffca3a' },
    { key:'green',  label:'綠珍珠', base: 0x8ac926, dark: 0x5a910a, css: '#8ac926' },
    { key:'blue',   label:'藍珍珠', base: 0x1982c4, dark: 0x0f5685, css: '#1982c4' },
    { key:'purple', label:'紫珍珠', base: 0x9b5de5, dark: 0x5c2d91, css: '#9b5de5' },
    { key:'orange', label:'橘珍珠', base: 0xff9f1c, dark: 0xcf7400, css: '#ff9f1c' },
];

// ====== Level Data ======
// Each level defines which pearl keys appear and what amounts are required.
// Part 1-3: no time limit, no anger.  Part 4+: timer & anger active.
const LEVEL_DATA = [
    // Level 1 – intro, 2 colours, small amounts
    { part: 1, allowedKeys: ['red','yellow'],              order: { red:4, yellow:3 },               timeLimit: 0 },
    // Level 2 – 3 colours
    { part: 2, allowedKeys: ['red','yellow','green'],      order: { red:5, green:4 },                timeLimit: 0 },
    // Level 3 – warmup complete
    { part: 3, allowedKeys: ['red','yellow','green','blue'], order: { red:5, yellow:4, green:3 },    timeLimit: 0 },
    // Level 4 – timer & anger BEGIN (Part 4)
    { part: 4, allowedKeys: ['red','yellow','green','blue','purple'], order: { red:6, blue:5, purple:4 }, timeLimit: 60 },
    // Level 5
    { part: 4, allowedKeys: PEARL_TYPES.map(p=>p.key),    order: { red:6, yellow:5, green:5 },      timeLimit: 55 },
    // Level 6
    { part: 4, allowedKeys: PEARL_TYPES.map(p=>p.key),    order: { blue:7, purple:5, orange:4 },    timeLimit: 50 },
    // Level 7 – harder
    { part: 4, allowedKeys: PEARL_TYPES.map(p=>p.key),    order: { red:8, yellow:6, green:5, blue:4 }, timeLimit: 50 },
    // Level 8
    { part: 4, allowedKeys: PEARL_TYPES.map(p=>p.key),    order: { red:8, orange:7, purple:6 },     timeLimit: 45 },
    // Level 9+ repeat with increasing difficulty handled by repeatLevel()
];

// ====== Game State ======
let currentLevelIdx = 0;   // index into LEVEL_DATA
let currentOrder   = {};   // { red:6, blue:5, ... }
let collected      = {};   // { red:0, blue:0, ... }
let bossAnger      = 100;
let isTimeLimitActive = false;
let timerValue     = 60;
let timerInterval  = null;
let spawnPool      = [];   // which pearl types are currently spawnable

// ====== DOM Handles ======
const domLevelNum      = document.getElementById('level-num');
const domTimerDisplay  = document.getElementById('timer-display');
const domTimerValue    = document.getElementById('timer-value');
const domBossAngerBar  = document.getElementById('boss-anger-bar');
const domAngerFill     = document.getElementById('anger-fill');
const domAngerValue    = document.getElementById('anger-value');
const domCollectionList= document.getElementById('collection-list');
const domOrderList     = document.getElementById('order-list');
const domFeedback      = document.getElementById('feedback-banner');
const domStartScreen   = document.getElementById('start-screen');
const domGameOverScreen= document.getElementById('game-over-screen');
const domLevelClear    = document.getElementById('level-clear-screen');
const domFinalLevel    = document.getElementById('final-level');
const domLevelClearMsg = document.getElementById('level-clear-msg');
const domStartBtn      = document.getElementById('start-btn');
const domRestartBtn    = document.getElementById('restart-btn');
const domNextLevelBtn  = document.getElementById('next-level-btn');

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
    Runner.run(Runner.create(), engine);

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
    domStartBtn.addEventListener('click', startGame);
    domRestartBtn.addEventListener('click', restartGame);
    domNextLevelBtn.addEventListener('click', advanceLevel);

    // --- Build Cup ---
    buildCup();

    isGameReady     = true;
    domStartBtn.disabled = false;
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
    const cupH       = Math.min(580, h * 0.65);
    const thickness  = 40;

    const cx = w / 2;
    const cy = h - cupH / 2 - 50;
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
    for (let i = 0; i < count; i++) {
        setTimeout(spawnPearl, i * 160);
    }
}

function startSpawner() {
    stopSpawner();
    // 開局掉 20 顆
    spawnBatch(PEARL_MIN);
    // 之後定期檢查補珠
    spawnInterval = setInterval(() => {
        if (gameOver) return;
        if (isCupOverfull()) return;          // 過滿暫停
        if (pearls.length < PEARL_MIN) {
            const add = Math.floor(Math.random() * 8) + 1;   // 1~8 顆
            spawnBatch(add);
        }
    }, SPAWN_CHECK);
}

function stopSpawner() {
    if (spawnInterval) { clearInterval(spawnInterval); spawnInterval = null; }
}

function spawnPearl() {
    if (gameOver) return;

    const typeEntry = spawnPool[Math.floor(Math.random() * spawnPool.length)];
    const radius    = 22 + Math.random() * 14;
    const cupTopW   = Math.min(480, app.screen.width * 0.82);
    const x         = app.screen.width / 2 + (Math.random() - 0.5) * (cupTopW - radius * 3);
    const y         = -radius;

    const body = Bodies.circle(x, y, radius, {
        restitution: 0.15,
        friction: 0.7,
        density: 0.002,
    });

    const view = new PIXI.Container();
    const g    = new PIXI.Graphics();
    drawPearlGraphic(g, typeEntry, radius);
    view.addChild(g);
    pearlsContainer.addChild(view);

    const pearlObj = { body, view, radius, id: body.id, type: typeEntry };
    pearls.push(pearlObj);

    view.eventMode = 'static';
    view.cursor    = 'pointer';
    view.on('pointerdown', (e) => { e.stopPropagation(); startDrag(pearlObj); });
    view.on('pointerenter', ()  => onDragEnter(pearlObj));

    Composite.add(engine.world, body);
}

function drawPearlGraphic(g, typeEntry, r, highlighted = false) {
    g.clear();
    if (highlighted) {
        // 白色外光暈邊框
        g.beginFill(0xffffff, 0.9);
        g.drawCircle(0, 0, r + 5);
        g.endFill();
    }
    // 保留原本顏色（不論是否高亮）
    g.beginFill(typeEntry.dark, 0.98);
    g.drawCircle(0, 0, r);
    g.endFill();
    g.beginFill(typeEntry.base, 0.95);
    g.drawCircle(-r*0.1, -r*0.1, r * 0.82);
    g.endFill();
    // 高亮時加上半透明橘色覆層讓選取感更明顯
    if (highlighted) {
        g.beginFill(0xffdd00, 0.25);
        g.drawCircle(0, 0, r);
        g.endFill();
    }
    // 光澤高光
    g.beginFill(0xffffff, 0.32);
    g.drawEllipse(-r*0.32, -r*0.32, r*0.24, r*0.14);
    g.endFill();
}

// ========================================================
//  DRAG / CONNECTION LOGIC
// ========================================================
function startDrag(pearl) {
    if (gameOver) return;
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
    if (!isDragging || gameOver) return;
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

function endDrag() {
    if (!isDragging) return;
    isDragging = false;

    if (selectedPearls.length >= 3) {
        // Valid connection!
        const colorKey = selectedPearls[0].type.key;
        const count    = selectedPearls.length;

        // Check if this colour is in the current order
        if (isTimeLimitActive && !(colorKey in currentOrder)) {
            // Wrong colour: penalise in Part 4+
            damageAnger(15);
            showFeedback(`❌ 錯誤顏色！-15 怒`, 'fail', 1200);
        } else {
            // Count toward collected
            collected[colorKey] = (collected[colorKey] || 0) + count;
            // Cap at order requirement
            if (colorKey in currentOrder) {
                collected[colorKey] = Math.min(collected[colorKey], currentOrder[colorKey]);
            }
            updateBeveragePanel();
            showFloatingText(`+${count}`, selectedPearls[0].body.position, selectedPearls[0].type.css);
        }

        // Remove pearls from world
        for (const p of selectedPearls) {
            Composite.remove(engine.world, p.body);
            pearlsContainer.removeChild(p.view);
            pearls = pearls.filter(gp => gp.id !== p.id);
        }

        checkOrderComplete();

    } else {
        // Too few – just unhighlight
        for (const p of selectedPearls) highlightPearl(p, false);
    }

    selectedPearls = [];
}

function highlightPearl(pearl, on) {
    const g = pearl.view.children[0];
    drawPearlGraphic(g, pearl.type, pearl.radius, on);
}

// ========================================================
//  ORDER / LEVEL SYSTEM
// ========================================================
function getLevelDef(idx) {
    if (idx < LEVEL_DATA.length) return LEVEL_DATA[idx];
    // Generated levels for idx >= LEVEL_DATA.length
    const base    = LEVEL_DATA[LEVEL_DATA.length - 1];
    const extra   = idx - LEVEL_DATA.length + 1;
    const newOrder= {};
    for (const [k, v] of Object.entries(base.order)) {
        newOrder[k] = v + extra * 2;
    }
    return {
        part: 4,
        allowedKeys: PEARL_TYPES.map(p => p.key),
        order: newOrder,
        timeLimit: Math.max(30, base.timeLimit - extra * 3),
    };
}

function loadLevel(idx) {
    const def = getLevelDef(idx);

    // Stop previous timer
    stopTimer();

    // Set state
    currentOrder = { ...def.order };
    collected    = {};
    for (const k of Object.keys(currentOrder)) collected[k] = 0;

    spawnPool = def.allowedKeys.map(k => PEARL_TYPES.find(t => t.key === k));

    // Update HUD level number
    domLevelNum.textContent = idx + 1;

    // Timer & Anger
    isTimeLimitActive = (def.part >= 4);
    if (isTimeLimitActive) {
        timerValue = def.timeLimit;
        domTimerDisplay.style.display = 'block';
        domBossAngerBar.style.display = 'flex';
        domTimerValue.textContent     = timerValue;
        domTimerDisplay.classList.remove('urgent');
        updateAngerUI();
        startTimer();
    } else {
        domTimerDisplay.style.display = 'none';
        domBossAngerBar.style.display = 'none';
    }

    updateOrderTablet();
    updateBeveragePanel();
}

function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
        if (gameOver) { stopTimer(); return; }
        timerValue--;
        domTimerValue.textContent = timerValue;
        if (timerValue <= 10) domTimerDisplay.classList.add('urgent');
        if (timerValue <= 0) {
            stopTimer();
            // Time out: damage and restart level
            damageAnger(25);
            showFeedback('⏰ 超時！-25 怒氣', 'fail', 1500);
            setTimeout(() => {
                if (!gameOver) resetCurrentLevel();
            }, 1600);
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function damageAnger(amount) {
    bossAnger = Math.max(0, bossAnger - amount);
    updateAngerUI();
    if (bossAnger <= 0) {
        setTimeout(triggerGameOver, 400);
    }
}

function updateAngerUI() {
    const pct = bossAnger;
    domAngerFill.style.width  = pct + '%';
    domAngerValue.textContent = bossAnger;
    if (pct > 50) {
        domAngerFill.style.background = 'linear-gradient(90deg,#ff4444,#ff9900)';
    } else if (pct > 25) {
        domAngerFill.style.background = 'linear-gradient(90deg,#ff2020,#ff6600)';
    } else {
        domAngerFill.style.background = 'linear-gradient(90deg,#cc0000,#ff2000)';
    }
}

function updateOrderTablet() {
    domOrderList.innerHTML = '';
    for (const [key, needed] of Object.entries(currentOrder)) {
        const typeEntry = PEARL_TYPES.find(t => t.key === key);
        const done      = (collected[key] || 0) >= needed;
        const row       = document.createElement('div');
        row.className   = 'order-row';
        row.innerHTML   = `
            <span class="pearl-dot" style="background:${typeEntry.css};box-shadow:0 0 8px ${typeEntry.css};"></span>
            <span class="order-text ${done?'done':''}">${typeEntry.label} ×${needed}</span>
        `;
        domOrderList.appendChild(row);
    }
}

function updateBeveragePanel() {
    domCollectionList.innerHTML = '';
    for (const [key, needed] of Object.entries(currentOrder)) {
        const typeEntry = PEARL_TYPES.find(t => t.key === key);
        const have      = collected[key] || 0;
        const pct       = Math.min(100, Math.round((have / needed) * 100));
        const done      = have >= needed;
        const row       = document.createElement('div');
        row.className   = 'order-row';
        row.style.flexDirection = 'column';
        row.style.gap = '3px';
        row.innerHTML   = `
            <div style="display:flex;align-items:center;gap:6px;">
                <span class="pearl-dot" style="background:${typeEntry.css};"></span>
                <span class="order-text" style="font-size:0.85rem;${done?'color:#6eff8a':''}">
                    ${have}/${needed}
                </span>
            </div>
            <div class="collect-bar-wrap">
                <div class="collect-bar" style="width:${pct}%;background:${typeEntry.css};"></div>
            </div>
        `;
        domCollectionList.appendChild(row);
    }
    // Also refresh order tablet tick marks
    updateOrderTablet();
}

function checkOrderComplete() {
    for (const [key, needed] of Object.entries(currentOrder)) {
        if ((collected[key] || 0) < needed) return false;
    }
    // All done!
    stopTimer();
    stopSpawner();
    showFeedback('🎉 訂單完成！', 'success', 0);
    const nextIdx = currentLevelIdx + 1;
    domLevelClearMsg.textContent = `準備 Level ${nextIdx + 1}…`;
    setTimeout(() => {
        domFeedback.style.display = 'none';
        domLevelClear.style.display = 'flex';
    }, 1200);
    return true;
}

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
function startGame() {
    domStartScreen.style.display = 'none';
    currentLevelIdx = 0;
    bossAnger       = 100;
    gameOver        = false;

    clearPearls();
    loadLevel(currentLevelIdx);
    startSpawner();
}

function restartGame() {
    domGameOverScreen.style.display = 'none';
    domLevelClear.style.display     = 'none';
    domFeedback.style.display       = 'none';
    currentLevelIdx = 0;
    bossAnger       = 100;
    gameOver        = false;

    // Remove dim overlay if any
    const dims = app.stage.children.filter(c => c.isDimming);
    dims.forEach(d => app.stage.removeChild(d));

    clearPearls();
    loadLevel(currentLevelIdx);
    startSpawner();
}

function triggerGameOver() {
    if (gameOver) return;
    gameOver = true;
    stopTimer();
    stopSpawner();

    // dim canvas
    const dim = new PIXI.Graphics();
    dim.isDimming = true;
    dim.beginFill(0x000000, 0.65);
    dim.drawRect(0, 0, app.screen.width, app.screen.height);
    dim.endFill();
    app.stage.addChild(dim);

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

// ========================================================
//  BOOT
// ========================================================
window.onload = init;
