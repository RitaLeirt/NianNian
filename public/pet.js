/**
 * 念念 NianNian
 * © 2026 Ruotong(Rita) LEI · ruotong_lei@outlook.com
 * 保留所有权利。
 *
 * 桌宠（精灵图逐帧动画）
 * 素材：/assets/wangcai.webp — 8列 × 9行，每帧 192×208px（布偶猫 Wangcai）。
 * 用 canvas 逐帧绘制，事件驱动状态切换：idle/waving/sleeping/alert/happy/waiting/running。
 */
(function (global) {
  'use strict';

  var SHEET = '/assets/wangcai.webp';
  var COLS = 8, ROWS = 9, FW = 192, FH = 208;

  // 行 → 动作映射（对照精灵表实际内容标定）
  // row0:坐姿待机 row1:跑跳 row2:走 row3:挥爪 row4:正坐(happy)
  // row5:耷拉/含泪(不用) row6:坐姿变体 row7:趴卧安睡 row8:皱眉(alert)
  var STATES = {
    idle:     { row: 0, frames: 6, fps: 2.2, loop: true },  // 待机：慢呼吸，不再频繁抖动
    running:  { row: 1, frames: 8, fps: 6,  loop: true },   // 拖拽时
    waving:   { row: 3, frames: 4, fps: 5,  loop: true },   // 主动交互，稍活泼
    happy:    { row: 4, frames: 5, fps: 6,  loop: true },   // 主动交互，稍活泼
    sleeping: { row: 7, frames: 6, fps: 1.5, loop: true },  // 趴卧安睡：最慢，安静
    waiting:  { row: 6, frames: 6, fps: 2,  loop: true },   // 等待：平缓
    alert:    { row: 8, frames: 6, fps: 4,  loop: true },   // 提醒：稍快引起注意
  };

  var img = new Image();
  var imgReady = false;
  img.src = SHEET;
  img.onload = function () { imgReady = true; };

  var prefersReduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * SpriteCat：把精灵图画到一个 canvas 上，按状态逐帧播放。
   * @param {HTMLCanvasElement} canvas
   * @param {Object} opt {scale, defaultState}
   */
  function SpriteCat(canvas, opt) {
    opt = opt || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = opt.scale || (canvas.width / FW);
    this.state = opt.defaultState || 'idle';
    this.frame = 0;
    this.acc = 0;
    this.last = 0;
    this.raf = null;
    this.facing = 1; // 1=朝左(素材原朝向) ，-1=朝右(水平翻转)
    this._tick = this._tick.bind(this);
    this.start();
  }
  // 设置朝向：'left' 用素材原图，'right' 水平翻转
  SpriteCat.prototype.setFacing = function (dir) {
    var f = dir === 'right' ? -1 : 1;
    this.facing = f;
  };
  // setState defined below with emotion tracking
  SpriteCat.prototype._draw = function () {
    if (!imgReady) return;
    var st = STATES[this.state];
    var sx = this.frame * FW;
    var sy = st.row * FH;
    var c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    var dw = FW * this.scale, dh = FH * this.scale;
    var dx = Math.round((this.canvas.width - dw) / 2);
    var dy = Math.round(this.canvas.height - dh); // 底部对齐，取整避免亚像素抖动
    c.imageSmoothingEnabled = true;
    if (this.facing === -1) {
      // 水平翻转：以画布中心镜像
      c.save();
      c.translate(this.canvas.width, 0);
      c.scale(-1, 1);
      c.drawImage(img, sx, sy, FW, FH, this.canvas.width - dx - dw, dy, dw, dh);
      c.restore();
    } else {
      c.drawImage(img, sx, sy, FW, FH, dx, dy, dw, dh);
    }
  };
  SpriteCat.prototype._tick = function (t) {
    if (!this.last) this.last = t;
    var dt = t - this.last;
    this.last = t;
    var st = STATES[this.state];
    // reduced-motion：只画第一帧，不推进动画
    if (!prefersReduced) {
      this.acc += dt;
      var interval = 1000 / st.fps;
      while (this.acc >= interval) {
        this.acc -= interval;
        this.frame = (this.frame + 1) % st.frames;
        if (!st.loop && this.frame === 0) this.frame = st.frames - 1;
      }
    }
    this._draw();
    this.raf = requestAnimationFrame(this._tick);
  };
  SpriteCat.prototype.start = function () { if (!this.raf) { this._draw(); this.raf = requestAnimationFrame(this._tick); } };
  SpriteCat.prototype.stop = function () { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; this.last = 0; } };
  // 返回表情简史
  SpriteCat.prototype.lastEmojis = function (n) {
    if (!this._emotions) this._emotions = [];
    return this._emotions.slice(-(n || 3)).join(' ');
  };
  SpriteCat.prototype.setState = function (name) {
    if (!STATES[name] || this.state === name) return;
    this.state = name;
    this.frame = 0;
    this.acc = 0;
    // 记录情绪轨迹
    if (!this._emotions) this._emotions = [];
    var emojiMap = { idle: '🐱', running: '💨', waving: '👋', happy: '😸', sleeping: '💤', waiting: '⏳', alert: '⚠️' };
    this._emotions.push(emojiMap[name] || '🐱');
    if (this._emotions.length > 10) this._emotions.shift();
  };

  global.NianNianPet = {
    SpriteCat: SpriteCat,
    STATES: STATES,
    ready: function (cb) { if (imgReady) cb(); else img.addEventListener('load', cb); },
    isReduced: prefersReduced,
  };
})(window);
