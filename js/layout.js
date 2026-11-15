// Picks a layout for the device and keeps <body> classes up to date.
// Classic script (not a module) so it runs before first paint — no flash of the wrong layout.
//
//   lay-phone    narrow screens: tools along the bottom, furniture/properties as full-width drawers
//   lay-tablet   iPad & friends (touch, or a small window): big touch targets, tool rail on the left,
//                properties docked on the right in landscape (a drawer in portrait), furniture as a side sheet
//   lay-desktop  mouse + keyboard on a large window: everything docked
//   land / port  orientation;  wide = a big landscape tablet (furniture docks too);  coarse = touch-first sizing
//
// The user can override this from File ▸ Layout (stored per device).
(function () {
  var KEY = 'plan.layout';
  function pref() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function apply() {
    var w = window.innerWidth, h = window.innerHeight;
    var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    var p = pref(), mode;
    if (p === 'phone' || p === 'tablet' || p === 'desktop') mode = p;
    else if (w < 700) mode = 'phone';
    else if (coarse || w < 1100) mode = 'tablet';
    else mode = 'desktop';
    var b = document.body;
    ['lay-phone', 'lay-tablet', 'lay-desktop', 'land', 'port', 'wide', 'coarse'].forEach(function (c) { b.classList.remove(c); });
    b.classList.add('lay-' + mode, w >= h ? 'land' : 'port');
    // touch-first sizing: on real touch devices, on phones, or when a touch layout is chosen by hand
    if (p !== 'desktop' && (coarse || mode === 'phone' || (p !== 'auto' && mode !== 'desktop'))) b.classList.add('coarse');
    if (mode === 'tablet' && w >= h && w >= 1300) b.classList.add('wide');
    window.__layout = mode;
  }
  window.applyLayout = apply;
  window.setLayoutPref = function (v) { try { localStorage.setItem(KEY, v); } catch (e) { /* ignore */ } apply(); };
  window.getLayoutPref = pref;
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', function () { setTimeout(apply, 120); });
})();
