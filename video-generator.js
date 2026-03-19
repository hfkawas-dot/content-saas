const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VIDEO_TEMPLATES = [
  {
    id: 'product-description-10s',
    title: 'Product Description in 10 seconds',
    hook: 'Watch AI write a product description in 10 seconds',
    contentType: 'product-description',
    demoInput: 'Wireless noise-canceling earbuds with 30-hour battery',
  },
  {
    id: 'stop-writing-emails',
    title: 'Stop writing marketing emails',
    hook: 'Stop wasting hours writing marketing emails',
    contentType: 'marketing-email',
    demoInput: 'Spring sale announcement for an online fashion store',
  },
  {
    id: 'social-media-autopilot',
    title: 'Social media posts on autopilot',
    hook: 'Your social media manager just got replaced',
    contentType: 'social-media',
    demoInput: 'Launch announcement for a new fitness app',
  },
  {
    id: 'ad-copy-converts',
    title: 'Ad copy that actually converts',
    hook: 'This AI writes better ad copy than your agency',
    contentType: 'ad-copy',
    demoInput: 'Premium online cooking course for beginners',
  },
];

/**
 * Pick a template that hasn't been used recently
 */
async function pickTemplate(db) {
  const recentTemplates = await db.all(
    'SELECT template FROM marketing_videos ORDER BY created_at DESC LIMIT $1',
    VIDEO_TEMPLATES.length - 1
  );
  const recentIds = recentTemplates.map((r) => r.template);

  const available = VIDEO_TEMPLATES.filter(
    (t) => !recentIds.includes(t.id)
  );
  if (available.length === 0) return VIDEO_TEMPLATES[Math.floor(Math.random() * VIDEO_TEMPLATES.length)];
  return available[Math.floor(Math.random() * available.length)];
}

/**
 * Generate a video script using the Anthropic API
 */
async function generateVideoContent(db) {
  const template = await pickTemplate(db);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1200,
    system: `You are a short-form video script writer for TikTok/Reels/Shorts. You write scripts for promotional videos about ContentAI, an AI-powered content generation SaaS tool. The videos are 30 seconds long with 5 scenes. Be punchy, use attention-grabbing language. The app URL is contentai-o1s4.onrender.com`,
    messages: [
      {
        role: 'user',
        content: `Write a 30-second video script for this template: "${template.title}"

The hook/opening line idea: "${template.hook}"
The demo shows: AI generating a ${template.contentType} for "${template.demoInput}"

Return ONLY valid JSON (no markdown, no backticks) with this exact structure:
{
  "hook": "The attention-grabbing opening text (under 10 words)",
  "scenes": [
    {"text": "Scene overlay text (short, punchy)", "description": "What the viewer sees"},
    {"text": "...", "description": "..."},
    {"text": "...", "description": "..."},
    {"text": "...", "description": "..."}
  ],
  "cta": "Call to action text (under 8 words)",
  "demoContent": "The actual AI-generated content that appears in the simulated app interface (2-3 sentences that look like a real ${template.contentType})"
}`,
      },
    ],
  });

  let script;
  try {
    script = JSON.parse(message.content[0].text);
  } catch {
    // Fallback if JSON parsing fails
    script = {
      hook: template.hook,
      scenes: [
        { text: 'Type your prompt...', description: 'User typing in the app' },
        { text: 'AI is generating...', description: 'Loading animation' },
        { text: 'Done in seconds', description: 'Generated content appears' },
        { text: 'Professional quality every time', description: 'Final result' },
      ],
      cta: 'Try it free today',
      demoContent: `Introducing our premium wireless earbuds — engineered for crystal-clear sound and all-day comfort. With 30 hours of battery life and active noise cancellation, these earbuds let you immerse yourself in your world.`,
    };
  }

  script.templateId = template.id;
  script.templateTitle = template.title;
  script.contentType = template.contentType;
  script.demoInput = template.demoInput;

  // Save to DB
  const result = await db.run(
    'INSERT INTO marketing_videos (template, title, script, duration_seconds, status) VALUES ($1, $2, $3, $4, $5)',
    template.id, template.title, JSON.stringify(script), 30, 'ready'
  );

  return { id: result.lastID, script };
}

/**
 * Render a self-contained HTML video presentation page
 */
function renderVideoPage(script) {
  const safeHook = esc(script.hook);
  const safeCta = esc(script.cta);
  const safeDemoContent = esc(script.demoContent);
  const safeDemoInput = esc(script.demoInput || 'Generate marketing content');
  const safeContentType = esc(script.contentType || 'product-description');
  const scenes = (script.scenes || []).map((s) => ({
    text: esc(s.text),
    description: esc(s.description),
  }));

  // Content type display names
  const typeNames = {
    'product-description': 'Product Description',
    'marketing-email': 'Marketing Email',
    'social-media': 'Social Media Post',
    'ad-copy': 'Ad Copy',
  };
  const typeName = typeNames[script.contentType] || 'Content';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ContentAI Video Preview — ${esc(script.templateTitle)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh;color:#fff}

.instructions{
  background:#1a1a2e;color:#94a3b8;padding:14px 24px;font-size:14px;text-align:center;width:100%;
  border-bottom:1px solid #2a2a4a;
}
.instructions strong{color:#6366f1}

.phone-frame{
  width:375px;height:667px;
  border:3px solid #333;border-radius:40px;
  overflow:hidden;margin:24px auto;position:relative;
  background:#0a0a0f;
  box-shadow:0 0 60px rgba(99,102,241,0.15);
}

.video-container{
  width:100%;height:100%;position:relative;overflow:hidden;
  background:#0a0a0f;
}

/* ===== SCENE SYSTEM ===== */
.scene{
  position:absolute;inset:0;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:40px 24px;
  opacity:0;
  transition:opacity 0.8s ease;
  pointer-events:none;
}
.scene.active{opacity:1;pointer-events:auto}

/* ===== SCENE 1: HOOK ===== */
.scene-hook{background:linear-gradient(180deg,#0a0a0f 0%,#12121a 100%)}
.hook-text{
  font-size:32px;font-weight:800;text-align:center;line-height:1.2;
  background:linear-gradient(135deg,#fff 0%,#c4b5fd 50%,#6366f1 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;
  background-clip:text;
  overflow:hidden;
}
.hook-text .char{
  display:inline-block;opacity:0;transform:translateY(20px);
  animation:charIn 0.04s forwards;
}
@keyframes charIn{to{opacity:1;transform:translateY(0)}}

.hook-emoji{font-size:48px;margin-bottom:16px;animation:bounce 1s ease infinite}
@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}

/* ===== SCENE 2-4: APP DEMO ===== */
.scene-demo{background:#0a0a0f;padding:20px 16px;justify-content:flex-start;padding-top:32px}

.demo-overlay{
  position:absolute;top:32px;left:0;right:0;text-align:center;
  font-size:15px;font-weight:700;color:#a78bfa;
  text-transform:uppercase;letter-spacing:1.5px;
  z-index:10;
  opacity:0;animation:fadeSlideDown 0.6s 0.3s forwards;
}
@keyframes fadeSlideDown{to{opacity:1;transform:translateY(0)}from{opacity:0;transform:translateY(-10px)}}

/* Simulated ContentAI Interface */
.app-mock{
  width:100%;margin-top:40px;
  border:1px solid #1e1e2e;border-radius:12px;
  background:#12121a;overflow:hidden;
  animation:scaleIn 0.5s ease;
}
@keyframes scaleIn{from{transform:scale(0.95);opacity:0}to{transform:scale(1);opacity:1}}

.app-header{
  padding:12px 16px;border-bottom:1px solid #1e1e2e;
  display:flex;align-items:center;gap:8px;
}
.app-logo{font-size:14px;font-weight:700;color:#e4e4e7}
.app-logo span{color:#6366f1}
.app-badge{
  font-size:9px;background:#6366f1;color:#fff;
  padding:2px 6px;border-radius:4px;font-weight:600;
}

.app-body{padding:14px 16px}

.app-select{
  width:100%;padding:8px 12px;
  background:#1e1e2e;border:1px solid #2a2a4a;border-radius:8px;
  color:#e4e4e7;font-size:12px;margin-bottom:10px;
}

.app-input{
  width:100%;padding:10px 12px;
  background:#1e1e2e;border:1px solid #2a2a4a;border-radius:8px;
  color:#e4e4e7;font-size:12px;margin-bottom:10px;min-height:44px;
  line-height:1.4;
}

.app-btn{
  width:100%;padding:10px;
  background:linear-gradient(135deg,#6366f1,#8b5cf6);
  border:none;border-radius:8px;
  color:#fff;font-size:13px;font-weight:600;
  cursor:pointer;margin-bottom:12px;
}

.app-output{
  background:#0a0a0f;border:1px solid #1e1e2e;border-radius:8px;
  padding:12px;min-height:120px;position:relative;
}
.app-output-label{
  font-size:10px;color:#6366f1;font-weight:600;
  text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;
}
.app-output-text{
  font-size:12px;color:#e4e4e7;line-height:1.6;
  overflow:hidden;
}
.typing-cursor{
  display:inline-block;width:2px;height:14px;
  background:#6366f1;margin-left:2px;
  animation:blink 0.6s step-end infinite;vertical-align:middle;
}
@keyframes blink{50%{opacity:0}}

/* Loading dots */
.loading-dots{display:flex;gap:6px;justify-content:center;padding:20px}
.loading-dots span{
  width:8px;height:8px;border-radius:50%;background:#6366f1;
  animation:dotPulse 1.2s ease infinite;
}
.loading-dots span:nth-child(2){animation-delay:0.2s}
.loading-dots span:nth-child(3){animation-delay:0.4s}
@keyframes dotPulse{0%,100%{opacity:0.3;transform:scale(0.8)}50%{opacity:1;transform:scale(1.2)}}

/* ===== SCENE 5: CTA ===== */
.scene-cta{
  background:linear-gradient(180deg,#0a0a0f 0%,#12121a 50%,#0a0a0f 100%);
}
.cta-logo{
  font-size:36px;font-weight:800;margin-bottom:12px;
  color:#e4e4e7;
}
.cta-logo span{color:#6366f1}
.cta-text{
  font-size:22px;font-weight:700;text-align:center;
  margin-bottom:20px;color:#fff;line-height:1.3;
}
.cta-url{
  display:inline-block;padding:14px 28px;
  background:linear-gradient(135deg,#6366f1,#8b5cf6);
  border-radius:12px;font-size:14px;font-weight:700;
  color:#fff;
  animation:ctaPulse 2s ease infinite;
}
@keyframes ctaPulse{0%,100%{box-shadow:0 0 20px rgba(99,102,241,0.3)}50%{box-shadow:0 0 40px rgba(99,102,241,0.6)}}

.cta-free{
  margin-top:14px;font-size:13px;color:#a78bfa;font-weight:600;
}

/* ===== PROGRESS BAR ===== */
.progress-bar{
  position:absolute;bottom:0;left:0;height:3px;
  background:linear-gradient(90deg,#6366f1,#a78bfa);
  z-index:100;
  animation:progress 30s linear forwards;
}
@keyframes progress{from{width:0}to{width:100%}}

/* ===== SCENE OVERLAY TEXT ===== */
.scene-text-overlay{
  position:absolute;bottom:60px;left:0;right:0;
  text-align:center;padding:0 20px;
  font-size:13px;color:#71717a;font-weight:500;
}

/* ===== CONTROLS ===== */
.controls{
  display:flex;gap:12px;margin-bottom:24px;
}
.ctrl-btn{
  padding:10px 20px;background:#1a1a2e;border:1px solid #2a2a4a;
  border-radius:8px;color:#e4e4e7;font-size:13px;cursor:pointer;
  transition:all 0.2s;
}
.ctrl-btn:hover{background:#2a2a4a;border-color:#6366f1}
</style>
</head>
<body>

<div class="instructions">
  <strong>Screen-record this presentation</strong> to create a TikTok / Reels / Shorts video.
  Press <strong>Play</strong> below, then record the phone frame. Total: ~30 seconds.
</div>

<div class="phone-frame">
  <div class="video-container" id="videoContainer">
    <!-- SCENE 1: Hook -->
    <div class="scene scene-hook" id="scene0">
      <div class="hook-emoji">&#x1F525;</div>
      <div class="hook-text" id="hookText"></div>
    </div>

    <!-- SCENE 2: Typing the prompt -->
    <div class="scene scene-demo" id="scene1">
      <div class="demo-overlay">${scenes[0] ? scenes[0].text : 'Watch this...'}</div>
      <div class="app-mock">
        <div class="app-header">
          <div class="app-logo">Content<span>AI</span></div>
          <div class="app-badge">AI Powered</div>
        </div>
        <div class="app-body">
          <div class="app-select">${typeName}</div>
          <div class="app-input" id="promptArea"></div>
          <div class="app-btn">Generate with AI</div>
          <div class="app-output" style="opacity:0.3">
            <div class="app-output-label">Output</div>
            <div class="app-output-text" style="color:#71717a;font-style:italic">Your content will appear here...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- SCENE 3: Generating -->
    <div class="scene scene-demo" id="scene2">
      <div class="demo-overlay">${scenes[1] ? scenes[1].text : 'AI is working...'}</div>
      <div class="app-mock">
        <div class="app-header">
          <div class="app-logo">Content<span>AI</span></div>
          <div class="app-badge">AI Powered</div>
        </div>
        <div class="app-body">
          <div class="app-select">${typeName}</div>
          <div class="app-input" style="color:#71717a">${safeDemoInput}</div>
          <div class="app-btn" style="opacity:0.7">Generating...</div>
          <div class="app-output">
            <div class="app-output-label">Generating</div>
            <div class="loading-dots"><span></span><span></span><span></span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- SCENE 4: Result -->
    <div class="scene scene-demo" id="scene3">
      <div class="demo-overlay">${scenes[2] ? scenes[2].text : 'Done in seconds'}</div>
      <div class="app-mock">
        <div class="app-header">
          <div class="app-logo">Content<span>AI</span></div>
          <div class="app-badge">AI Powered</div>
        </div>
        <div class="app-body">
          <div class="app-select">${typeName}</div>
          <div class="app-input" style="color:#71717a">${safeDemoInput}</div>
          <div class="app-btn" style="background:linear-gradient(135deg,#22c55e,#16a34a)">&#x2713; Generated</div>
          <div class="app-output">
            <div class="app-output-label">Result</div>
            <div class="app-output-text" id="resultText"></div>
          </div>
        </div>
      </div>
      <div class="scene-text-overlay">${scenes[3] ? scenes[3].text : 'Professional quality every time'}</div>
    </div>

    <!-- SCENE 5: CTA -->
    <div class="scene scene-cta" id="scene4">
      <div class="cta-logo">Content<span>AI</span></div>
      <div class="cta-text">${safeCta}</div>
      <div class="cta-url">contentai-o1s4.onrender.com</div>
      <div class="cta-free">Start free &#x2014; no credit card needed</div>
    </div>

    <div class="progress-bar" id="progressBar" style="animation-play-state:paused"></div>
  </div>
</div>

<div class="controls">
  <button class="ctrl-btn" id="playBtn" onclick="startVideo()">&#x25B6; Play</button>
  <button class="ctrl-btn" onclick="resetVideo()">&#x21BB; Reset</button>
</div>

<script>
(function(){
  var hookRaw = ${JSON.stringify(script.hook)};
  var demoInput = ${JSON.stringify(script.demoInput || 'Generate marketing content')};
  var demoContent = ${JSON.stringify(script.demoContent)};

  var scenes = document.querySelectorAll('.scene');
  var currentScene = -1;
  var timers = [];
  var running = false;

  function clearTimers(){timers.forEach(function(t){clearTimeout(t)});timers=[]}

  function showScene(n){
    for(var i=0;i<scenes.length;i++){
      scenes[i].classList.remove('active');
    }
    if(n>=0 && n<scenes.length) scenes[n].classList.add('active');
    currentScene=n;
  }

  function typeText(el,text,speed,cb){
    el.textContent='';
    var i=0;
    function next(){
      if(i<text.length){
        el.textContent+=text[i];
        i++;
        timers.push(setTimeout(next,speed));
      } else if(cb) cb();
    }
    next();
  }

  function typeWithCursor(el,text,speed,cb){
    el.innerHTML='';
    var span=document.createElement('span');
    var cursor=document.createElement('span');
    cursor.className='typing-cursor';
    el.appendChild(span);
    el.appendChild(cursor);
    var i=0;
    function next(){
      if(i<text.length){
        span.textContent+=text[i];
        i++;
        timers.push(setTimeout(next,speed));
      } else {
        timers.push(setTimeout(function(){cursor.style.display='none';if(cb)cb()},500));
      }
    }
    next();
  }

  function animateHook(text,cb){
    var el=document.getElementById('hookText');
    el.innerHTML='';
    var chars=text.split('');
    for(var i=0;i<chars.length;i++){
      (function(ch,idx){
        var s=document.createElement('span');
        s.className='char';
        s.textContent=ch===' '?'\\u00A0':ch;
        s.style.animationDelay=(idx*0.05)+'s';
        el.appendChild(s);
      })(chars[i],i);
    }
    timers.push(setTimeout(cb,chars.length*50+800));
  }

  window.startVideo=function(){
    if(running)return;
    running=true;
    document.getElementById('playBtn').textContent='Playing...';
    document.getElementById('progressBar').style.animationPlayState='running';

    // Scene 1: Hook (0-6s)
    showScene(0);
    animateHook(hookRaw,function(){});

    // Scene 2: Typing prompt (6-12s)
    timers.push(setTimeout(function(){
      showScene(1);
      var promptEl=document.getElementById('promptArea');
      typeText(promptEl,demoInput,45,function(){});
    },6000));

    // Scene 3: Generating (12-18s)
    timers.push(setTimeout(function(){
      showScene(2);
    },12000));

    // Scene 4: Result with typewriter (18-26s)
    timers.push(setTimeout(function(){
      showScene(3);
      var resultEl=document.getElementById('resultText');
      typeWithCursor(resultEl,demoContent,18,function(){});
    },18000));

    // Scene 5: CTA (26-30s)
    timers.push(setTimeout(function(){
      showScene(4);
    },26000));

    // End
    timers.push(setTimeout(function(){
      running=false;
      document.getElementById('playBtn').textContent='\\u25B6 Play';
    },30500));
  };

  window.resetVideo=function(){
    clearTimers();
    running=false;
    showScene(-1);
    document.getElementById('playBtn').textContent='\\u25B6 Play';
    document.getElementById('hookText').innerHTML='';
    document.getElementById('promptArea').textContent='';
    document.getElementById('resultText').innerHTML='';
    var pb=document.getElementById('progressBar');
    pb.style.animation='none';
    pb.offsetHeight;
    pb.style.animation='progress 30s linear forwards';
    pb.style.animationPlayState='paused';
  };
})();
</script>
</body>
</html>`;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

module.exports = { generateVideoContent, renderVideoPage, VIDEO_TEMPLATES };
