/**
 * weapp-adapter — 为 PixiJS v7 在微信小游戏中提供浏览器 API 垫片
 * 必须在 pixi.js 之前加载
 */

// ============================================================
// 1. requestAnimationFrame
// ============================================================
if (typeof requestAnimationFrame === 'undefined') {
  let lastTime = 0;
  globalThis.requestAnimationFrame = function (cb) {
    const now = Date.now();
    const delay = Math.max(0, 16 - (now - lastTime));
    lastTime = now + delay;
    return setTimeout(function () { cb(now + delay); }, delay);
  };
  globalThis.cancelAnimationFrame = function (id) { clearTimeout(id); };
}

// ============================================================
// 2. 系统信息
// ============================================================
const sysInfo = (typeof wx !== 'undefined' && wx.getSystemInfoSync)
  ? wx.getSystemInfoSync()
  : { screenWidth: 375, screenHeight: 667, pixelRatio: 2 };

// ============================================================
// 3. HTMLCanvasElement
// ============================================================
const _canvasListeners = [];

class HTMLCanvasElement {
  constructor() {
    var c = wx.createCanvas();
    c.width = c.width || sysInfo.screenWidth;
    c.height = c.height || sysInfo.screenHeight;
    this._canvas = c;
    this._evts = {};
    this.style = {};
    this.width = sysInfo.screenWidth;
    this.height = sysInfo.screenHeight;
  }

  getContext(type) {
    if (type === '2d' || type === 'webgl' || type === 'webgl2') {
      return this._canvas.getContext(type);
    }
    return null;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height, right: this.width, bottom: this.height };
  }

  addEventListener(type, fn) {
    if (!this._evts[type]) this._evts[type] = [];
    this._evts[type].push(fn);
  }

  removeEventListener(type, fn) {
    var list = this._evts[type];
    if (!list) return;
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  dispatchEvent(evt) {
    var list = this._evts[evt.type];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      var fn = list[i];
      if (typeof fn === 'function') fn(evt);
      else if (fn && typeof fn.handleEvent === 'function') fn.handleEvent(evt);
    }
  }

  setAttribute() {}
  getAttribute() { return null; }
  removeAttribute() {}
  toDataURL() { return this._canvas.toDataURL ? this._canvas.toDataURL() : ''; }
}

// ============================================================
// 4. HTMLImageElement
// ============================================================
class HTMLImageElement {
  constructor() {
    this._img = wx.createImage();
    this._src = '';
  }

  get src() { return this._src; }
  set src(val) {
    this._src = val;
    this._img.src = val;
    var self = this;
    this._img.onload = function () {
      self.width = self._img.width;
      self.height = self._img.height;
      if (self.onload) self.onload();
    };
    this._img.onerror = function (e) {
      if (self.onerror) self.onerror(e);
    };
  }

  get width() { return this._img.width; }
  set width(v) { this._img.width = v; }
  get height() { return this._img.height; }
  set height(v) { this._img.height = v; }

  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  getAttribute() { return null; }
}

// ============================================================
// 5. document
// ============================================================
var mainCanvasInstance = new HTMLCanvasElement();
_canvasListeners.push(mainCanvasInstance);

var doc = {
  body: {
    appendChild: function () {},
    removeChild: function () {},
    style: {},
  },
  createElement: function (tag) {
    if (tag === 'canvas') {
      var c = new HTMLCanvasElement();
      _canvasListeners.push(c);
      return c;
    }
    if (tag === 'img' || tag === 'image') return new HTMLImageElement();
    return {
      style: {},
      appendChild: function () {},
      removeChild: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
      setAttribute: function () {},
      getAttribute: function () { return null; },
    };
  },
  createElementNS: function (uri, tag) { return doc.createElement(tag); },
  getElementById: function () { return mainCanvasInstance; },
  querySelector: function () { return mainCanvasInstance; },
  querySelectorAll: function () { return [mainCanvasInstance]; },
  addEventListener: function () {},
  removeEventListener: function () {},
  createEvent: function () { return { initEvent: function () {} }; },
  visibilityState: 'visible',
  hidden: false,
};

// ============================================================
// 6. navigator & location
// ============================================================
var nav = {
  userAgent: 'Mozilla/5.0 WeChat MiniGame',
  platform: 'WeChat',
  language: 'zh-CN',
  appVersion: '',
};

// ============================================================
// 7. 安全赋值到 globalThis
// ============================================================
var propsToSet = [
  ['innerWidth', sysInfo.screenWidth],
  ['innerHeight', sysInfo.screenHeight],
  ['devicePixelRatio', sysInfo.pixelRatio || 2],
  ['screen', { width: sysInfo.screenWidth, height: sysInfo.screenHeight }],
  ['performance', { now: function () { return Date.now(); }, timing: {} }],
  ['document', doc],
  ['HTMLCanvasElement', HTMLCanvasElement],
  ['HTMLImageElement', HTMLImageElement],
  ['Image', HTMLImageElement],
  ['addEventListener', function () {}],
  ['removeEventListener', function () {}],
  ['Event', function Event(type) { this.type = type; }],
  ['PointerEvent', function () {}],
  ['CustomEvent', function () {}],
];

for (var i = 0; i < propsToSet.length; i++) {
  var key = propsToSet[i][0];
  var val = propsToSet[i][1];
  try { globalThis[key] = val; } catch (e) { /* 跳过只读属性 */ }
}

// navigator / location 单独处理（大概率只读）
try { globalThis.navigator = nav; } catch (e) {}
try { globalThis.location = { href: '', protocol: '', host: '', pathname: '' }; } catch (e) {}
try { globalThis.matchMedia = function () { return { matches: false, addListener: function () {}, removeListener: function () {} }; }; } catch (e) {}

// 暴露主 canvas
globalThis.canvas = mainCanvasInstance;

// ============================================================
// 8. 触摸事件桥接
// ============================================================
function _makeTouchEvt(type, wxEvt) {
  var t = (wxEvt.touches && wxEvt.touches[0]) ||
          (wxEvt.changedTouches && wxEvt.changedTouches[0]) ||
          { clientX: 0, clientY: 0, pageX: 0, pageY: 0, identifier: 0 };
  return {
    type: type,
    clientX: t.clientX,
    clientY: t.clientY,
    pageX: t.pageX,
    pageY: t.pageY,
    target: mainCanvasInstance,
    currentTarget: mainCanvasInstance,
    preventDefault: function () {},
    stopPropagation: function () {},
    pointerId: t.identifier || 0,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 1,
  };
}

function _notifyAll(type, wxEvt) {
  var evt = _makeTouchEvt(type, wxEvt);
  for (var i = 0; i < _canvasListeners.length; i++) {
    _canvasListeners[i].dispatchEvent(evt);
  }
}

if (typeof wx !== 'undefined') {
  wx.onTouchStart(function (e) { _notifyAll('pointerdown', e); _notifyAll('touchstart', e); _notifyAll('mousedown', e); });
  wx.onTouchMove(function (e) { _notifyAll('pointermove', e); _notifyAll('touchmove', e); _notifyAll('mousemove', e); });
  wx.onTouchEnd(function (e) { _notifyAll('pointerup', e); _notifyAll('touchend', e); _notifyAll('mouseup', e); });
  wx.onTouchCancel(function (e) { _notifyAll('pointercancel', e); _notifyAll('touchcancel', e); });
}
