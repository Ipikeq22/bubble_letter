// ====== Global Variables ======
const Engine = Matter.Engine,
      Runner = Matter.Runner,
      Bodies = Matter.Bodies,
      Composite = Matter.Composite,
      Events = Matter.Events;

let app;
let engine;
let dictionary = new Set();
let isGameReady = false;

// Pixi Containers
let gameStage, cupContainer, pearlsContainer, linesContainer;

// Physics Bodies
let pearls = [];
let cupWalls = [];

// Game State
let gameOver = false;
let spawnInterval;
let cupTopY = 0;
let overflowTimer = 0;
let isDragging = false;
let selectedPearls = [];
let connectionLine;

// UI Elements
const scoreElement = document.getElementById('score');
const statusMessage = document.getElementById('status-message');
let score = 0;

// ====== Setup System ======
async function init() {
    // 1. Initialise PixiJS
    app = new PIXI.Application({
        resizeTo: window,
        backgroundColor: 0xeaded2, // Milky tea light background
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        antialias: true
    });
    document.getElementById('game-container').appendChild(app.view);
    
    // Set up containers
    gameStage = new PIXI.Container();
    cupContainer = new PIXI.Container();
    pearlsContainer = new PIXI.Container();
    linesContainer = new PIXI.Container();
    
    gameStage.addChild(cupContainer);
    gameStage.addChild(pearlsContainer);
    gameStage.addChild(linesContainer);
    app.stage.addChild(gameStage);

    // Interaction setup
    connectionLine = new PIXI.Graphics();
    linesContainer.addChild(connectionLine);
    
    app.stage.eventMode = 'static';
    app.stage.hitArea = new PIXI.Rectangle(-5000, -5000, 10000, 10000);
    app.stage.on('pointerup', endDrag);
    app.stage.on('pointerupoutside', endDrag);
    app.stage.on('pointermove', onPointerMove);

    // 2. Initialise Matter.js Engine
    engine = Engine.create();
    
    // Create a runner
    const runner = Runner.create();
    Runner.run(runner, engine);

    // 3. Game Loop mapping Matter to Pixi
    app.ticker.add((delta) => {
        // Sync Pearls
        for (let i = 0; i < pearls.length; i++) {
            const pearl = pearls[i];
            pearl.view.position.x = pearl.body.position.x;
            pearl.view.position.y = pearl.body.position.y;
            pearl.view.rotation = pearl.body.angle;
        }

        // Draw connection line
        connectionLine.clear();
        if (isDragging && selectedPearls.length > 0) {
            connectionLine.lineStyle(10, 0xffaa00, 0.8);
            connectionLine.moveTo(selectedPearls[0].view.position.x, selectedPearls[0].view.position.y);
            for (let i = 1; i < selectedPearls.length; i++) {
                connectionLine.lineTo(selectedPearls[i].view.position.x, selectedPearls[i].view.position.y);
            }
            // Draw line to current mouse position
            const mousePos = app.renderer.events.pointer.global;
            connectionLine.lineTo(mousePos.x, mousePos.y);
        }

        // ====== Game Over Check ======
        if (!gameOver && pearls.length > 15) {
            // Check if any pearl is settled above the cup brim
            let overflowing = false;
            for (let i = 0; i < pearls.length; i++) {
                const p = pearls[i];
                // Require pearl to be visibly stacked OUTSIDE the cup and relatively stable
                if (p.body.position.y < cupTopY - 50 && p.body.speed < 0.5) {
                    overflowing = true;
                    break;
                }
            }
            if (overflowing) {
                overflowTimer++;
                // Wait for about 1.5 seconds (at 60fps) of consecutive overflowing state
                if (overflowTimer > 90) {
                    triggerGameOver();
                }
            } else {
                overflowTimer = 0; // Reset if the pile falls back in
            }
        }
    });

    // Handle Window Resize
    window.addEventListener('resize', handleResize);

    // 4. Load Dictionary
    await loadDictionary();

    // 5. Build Level
    buildCup();
    
    // 6. Start Spawning
    if (dictionary.size > 0) {
        isGameReady = true;
        startSpawner();
    }
}

// ====== Dictionary Fetch ======
async function loadDictionary() {
    statusMessage.style.display = 'block';
    statusMessage.innerText = '載入單字庫中...\nLoading Dictionary...';
    try {
        const response = await fetch('https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt');
        if (!response.ok) throw new Error("Network response was not ok");
        const text = await response.text();
        const words = text.split('\n')
                          .map(w => w.trim())
                          .filter(w => w.length >= 2)
                          .map(w => w.toUpperCase());
        dictionary = new Set(words);
        console.log(`Loaded ${dictionary.size} words.`);
        statusMessage.style.display = 'none';
    } catch (e) {
        console.error("Failed to load dictionary, using fallback:", e);
        statusMessage.innerText = '單字庫載入失敗，使用備用字庫！\nUsing Fallback Dictionary';
        // Fallback minimal dictionary for testing
        dictionary = new Set(['CAT', 'DOG', 'TEA', 'BOBA', 'MILK', 'CUP', 'SUN', 'FUN', 'RUN']);
        setTimeout(() => { statusMessage.style.display = 'none'; }, 2000);
    }
}

// ====== Game Objects ======
function buildCup() {
    // Clear existing
    if (cupWalls.length > 0) Composite.remove(engine.world, cupWalls);
    cupContainer.removeChildren();
    
    const w = app.screen.width;
    const h = app.screen.height;
    
    // Cup dimensions
    const cupW = Math.min(500, w * 0.85);
    const cupH = Math.min(600, h * 0.65);
    const cupW_half = cupW / 2;
    const thickness = 40;
    
    const cx = w / 2;
    const cy = h - cupH / 2 - 50; // offset from bottom
    cupTopY = cy - cupH / 2;
    
    // Create Matter bodies (static)
    const bottom = Bodies.rectangle(cx, cy + cupH/2, cupW + thickness * 2, thickness, { isStatic: true, friction: 0.1 });
    const left = Bodies.rectangle(cx - cupW_half - thickness/2, cy, thickness, cupH, { isStatic: true, friction: 0.1 });
    const right = Bodies.rectangle(cx + cupW_half + thickness/2, cy, thickness, cupH, { isStatic: true, friction: 0.1 });
    
    cupWalls = [bottom, left, right];
    Composite.add(engine.world, cupWalls);
    
    // Draw Pixi Graphics
    const graphics = new PIXI.Graphics();
    
    // Draw Glass Cup (Back and borders)
    graphics.lineStyle(8, 0xffffff, 0.7);
    graphics.beginFill(0xffffff, 0.25); // milky tea inner tint
    
    // We draw a U-shape outline
    graphics.moveTo(cx - cupW_half, cy - cupH/2);
    graphics.lineTo(cx - cupW_half, cy + cupH/2);
    graphics.lineTo(cx + cupW_half, cy + cupH/2);
    graphics.lineTo(cx + cupW_half, cy - cupH/2);
    graphics.endFill();
    
    // Outer glow for glass
    graphics.lineStyle(16, 0xffffff, 0.2);
    graphics.moveTo(cx - cupW_half, cy - cupH/2);
    graphics.lineTo(cx - cupW_half, cy + cupH/2);
    graphics.lineTo(cx + cupW_half, cy + cupH/2);
    graphics.lineTo(cx + cupW_half, cy - cupH/2);
    
    cupContainer.addChild(graphics);
}

function handleResize() {
    app.renderer.resize(window.innerWidth, window.innerHeight);
    buildCup();
}

// ====== Spawner ======
const letterFreq = [
    // Heavily weighted vowels for easier gameplay
    'E','E','E','E','E','E','E','E','E','E','E','E','E','E','E','E','E','E','E','E',
    'A','A','A','A','A','A','A','A','A','A','A','A','A','A','A',
    'O','O','O','O','O','O','O','O','O','O','O','O',
    'I','I','I','I','I','I','I','I','I','I','I','I',
    'U','U','U','U','U','U','U','U',
    // Common consonants
    'T','T','T','T','T','T','T','T','T','T',
    'N','N','N','N','N','N','N','N','N',
    'S','S','S','S','S','S','S','S','S',
    'R','R','R','R','R','R','R','R','R',
    'H','H','H','H','H','H',
    'L','L','L','L','L','L',
    'D','D','D','D','D',
    'C','C','C','C','C',
    'M','M','M','M',
    'F','F','F',
    'P','P','P','G','G','G','W','W','Y','Y','B','B','V',
    'K','X','J','Q','Z'
];

function getRandomLetter() {
    return letterFreq[Math.floor(Math.random() * letterFreq.length)];
}

function startSpawner() {
    spawnInterval = setInterval(spawnPearl, 1800);
}

function spawnPearl() {
    if (gameOver) return;
    
    const radius = 25 + Math.random() * 15; // 25 to 40 px radius
    const cupW = Math.min(500, app.screen.width * 0.85);
    const x = app.screen.width / 2 + (Math.random() - 0.5) * (cupW - radius * 3);
    const y = -radius;
    
    const letter = getRandomLetter();
    
    // Physics body
    const body = Bodies.circle(x, y, radius, {
        restitution: 0.1, // very slight bounce
        friction: 0.8,
        density: 0.002
    });
    
    // Pixi View
    const pearlView = new PIXI.Container();
    
    // Boba Graphics
    const graphics = new PIXI.Graphics();
    
    // Shadow
    graphics.beginFill(0x1a0f08, 0.95);
    graphics.drawCircle(0, 0, radius);
    graphics.endFill();
    // Inner light gradient simulation
    graphics.beginFill(0x3a2113, 0.95);
    graphics.drawCircle(-radius*0.1, -radius*0.1, radius*0.8);
    graphics.endFill();
    
    // Boba reflection
    graphics.beginFill(0xffffff, 0.3);
    graphics.drawEllipse(-radius*0.35, -radius*0.35, radius*0.25, radius*0.15);
    graphics.endFill();
    
    // Letter Text
    const textInfo = new PIXI.Text(letter, {
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: Math.max(20, radius * 0.8),
        fill: 0xffe9c9, // light milk tea text color
        fontWeight: '900',
        stroke: 0x1a0f08,
        strokeThickness: 2
    });
    textInfo.anchor.set(0.5);
    
    pearlView.addChild(graphics);
    pearlView.addChild(textInfo);
    
    pearlsContainer.addChild(pearlView);
    
    const pearlObj = { body, view: pearlView, letter, radius, id: body.id };
    pearls.push(pearlObj);
    
    // Interaction
    pearlView.eventMode = 'static';
    pearlView.cursor = 'pointer';
    pearlView.on('pointerdown', (e) => {
        e.stopPropagation();
        startDrag(pearlObj);
    });
    pearlView.on('pointerenter', () => onDragEnter(pearlObj));
    
    Composite.add(engine.world, body);
}

// ====== Interaction Logic ======

function startDrag(pearl) {
    if (gameOver) return;
    isDragging = true;
    selectedPearls = [pearl];
    highlightPearl(pearl, true);
}

function onDragEnter(pearl) {
    if (!isDragging || gameOver) return;
    if (selectedPearls.find(p => p.id === pearl.id)) return;
    
    const lastPearl = selectedPearls[selectedPearls.length - 1];
    const dist = Math.hypot(lastPearl.body.position.x - pearl.body.position.x, lastPearl.body.position.y - pearl.body.position.y);
    const maxDist = (lastPearl.radius + pearl.radius) * 2.5; // Easier to connect across gaps

    
    if (dist <= maxDist) {
        selectedPearls.push(pearl);
        highlightPearl(pearl, true);
    }
}

function onPointerMove(e) {
    if (!isDragging || gameOver) return;
    const pos = e.global;
    
    for (let p of pearls) {
        if (!selectedPearls.find(sp => sp.id === p.id)) {
            const dist = Math.hypot(p.body.position.x - pos.x, p.body.position.y - pos.y);
            if (dist < p.radius) {
                onDragEnter(p);
            }
        }
    }
}

function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    
    if (selectedPearls.length > 0) {
        const word = selectedPearls.map(p => p.letter).join('');
        
        if (word.length >= 2 && dictionary.has(word)) {
            // Valid Word!
            console.log("Valid Word:", word);
            score += word.length * 100;
            scoreElement.innerText = score;
            
            showFloatingText(word, word.length * 100, selectedPearls[0].body.position);
            
            selectedPearls.forEach(p => {
                Composite.remove(engine.world, p.body);
                pearlsContainer.removeChild(p.view);
                pearls = pearls.filter(gp => gp.id !== p.id);
            });
        } else {
            // Invalid Word
            selectedPearls.forEach(p => highlightPearl(p, false));
        }
    }
    selectedPearls = [];
}

function highlightPearl(pearl, isHighlighted) {
    const g = pearl.view.children[0];
    g.clear();
    
    const r = pearl.radius;
    if (isHighlighted) {
        g.beginFill(0xffaa00, 0.95);
    } else {
        g.beginFill(0x1a0f08, 0.95);
    }
    g.drawCircle(0, 0, r);
    g.endFill();
    
    if (!isHighlighted) {
        g.beginFill(0x3a2113, 0.95);
        g.drawCircle(-r*0.1, -r*0.1, r*0.8);
        g.endFill();
    }
    g.beginFill(0xffffff, 0.3);
    g.drawEllipse(-r*0.35, -r*0.35, r*0.25, r*0.15);
    g.endFill();
}

function showFloatingText(word, points, pos) {
    const textInfo = new PIXI.Text(`${word}\n+${points}`, {
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: 30,
        fill: 0xffaa00,
        fontWeight: '900',
        stroke: 0xffffff,
        strokeThickness: 5,
        align: 'center'
    });
    textInfo.position.set(pos.x, pos.y);
    textInfo.anchor.set(0.5);
    gameStage.addChild(textInfo);
    
    let time = 0;
    const ticker = () => {
        time += 1;
        textInfo.y -= 2;
        textInfo.alpha -= 0.02;
        if (time > 50) {
            gameStage.removeChild(textInfo);
            app.ticker.remove(ticker);
        }
    };
    app.ticker.add(ticker);
}

function triggerGameOver() {
    gameOver = true;
    clearInterval(spawnInterval);
    statusMessage.innerText = `遊戲結束！滿出來啦！\nGame Over\n最終分數 / Final Score : ${score}`;
    statusMessage.style.display = 'block';
    statusMessage.style.background = 'rgba(230, 80, 80, 0.9)';
    
    // Screen dim
    const dim = new PIXI.Graphics();
    dim.beginFill(0x000000, 0.6);
    dim.drawRect(0, 0, app.screen.width, app.screen.height);
    dim.endFill();
    app.stage.addChild(dim);
}

// Start
window.onload = init;
