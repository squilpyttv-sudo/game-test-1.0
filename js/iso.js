/* ==========================================================================
   CS2 PRO SIMULATOR — js/iso.js
   The isometric canvas renderer. Shaded cuboids, 2:1 projection.
   ========================================================================== */
(function () {
  'use strict';

  var TILE_W = 32, TILE_H = 16;         // full tile size
  var HW = TILE_W / 2, HH = TILE_H / 2; // half-tile: 16, 8
  var WALL_H = 76;                      // back-wall height in px

  /* ---- projection ------------------------------------------------------- */
  function iso(x, y, z) {
    return { sx: (x - y) * HW, sy: (x + y) * HH - z };
  }

  /* ---- color shading ------------------------------------------------------ */
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
  function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }
  function toHex2(v) { var s = v.toString(16); return s.length === 1 ? '0' + s : s; }
  function rgbToHex(r, g, b) { return '#' + toHex2(r) + toHex2(g) + toHex2(b); }

  function shade(hex, amount) {
    var c = hexToRgb(hex);
    var r, g, b;
    if (amount >= 0) {
      r = c.r + (255 - c.r) * amount;
      g = c.g + (255 - c.g) * amount;
      b = c.b + (255 - c.b) * amount;
    } else {
      r = c.r * (1 + amount);
      g = c.g * (1 + amount);
      b = c.b * (1 + amount);
    }
    return rgbToHex(clamp255(r), clamp255(g), clamp255(b));
  }

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }

  /* ---- primitives --------------------------------------------------------- */
  // V16 pass 1 — PIXEL-GRID QUANTISATION. Every projected vertex snaps to a
  // whole device pixel, so no polygon in the world can land on a half-pixel
  // and smear into a 2px antialiased edge. Shared vertices round identically
  // (same input -> same output), so adjacent faces still meet seamlessly.
  function project(x, y, z, camera) {
    var p = iso(x, y, z);
    var scale = camera.scale || 1;
    return { x: Math.round(p.sx * scale + camera.ox), y: Math.round(p.sy * scale + camera.oy) };
  }

  function tracePath(ctx, pts, close) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (close !== false) ctx.closePath();
  }

  // A 1px stroke centred on an integer coordinate straddles two pixel columns
  // and blurs. Translating the context by half a pixel first puts the stroke
  // squarely inside one column — the crisp-line trick, applied to every
  // outline in the renderer (V16 pass 1).
  function crispStroke(ctx, pts, color, close, width) {
    ctx.save();
    ctx.translate(0.5, 0.5);
    tracePath(ctx, pts, close);
    ctx.lineWidth = width || 1;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  function drawPoly(ctx, pts, fill, strokeColor) {
    tracePath(ctx, pts, true);
    ctx.fillStyle = fill;
    ctx.fill();
    if (strokeColor) crispStroke(ctx, pts, strokeColor, true);
  }

  // box(ctx, x, y, z, w, d, h, color) — the shared cuboid drawer from SPEC §2.
  // `camera` is an optional {ox,oy} screen offset (defaults to 0,0).
  // V16: box() is now a thin alias for boxRamp(). Before this pass there were
  // two shading conventions in the file — box()'s ad-hoc additive lerp and the
  // V15 multiplicative ramp — and the ~30 props that had never been restyled
  // were stranded on the old one. Routing box() through the ramp migrates all
  // of them in one move, which is the entire point: ONE shared language, not
  // two. (boxRamp is defined below; function declarations hoist.)
  function box(ctx, x, y, z, w, d, h, color, camera, opts) {
    boxRamp(ctx, x, y, z, w, d, h, color, camera, opts);
  }

  // ---- V15 shading ramp (ART-DIRECTION.md §2.2 / SPEC-V15-BATCH-A §10) ----
  // ONE fixed multiplicative ramp, shared by every prop that adopts the new
  // V15 art direction, so every family/tier that uses it reads as one set
  // instead of each prop inventing its own shading (the box() ramp above —
  // top ×1.22/right ×-0.28 additive lerp-toward-white/black — is the OLD
  // per-prop-ad-hoc convention this replaces; box() itself is left alone so
  // the ~30 not-yet-restyled props keep their current look until their own
  // pass). Exported as Iso.rampShade(hex) -> {top,left,right,outline} for
  // later art passes that want the four values directly; Iso.boxRamp(...)
  // below is the same cuboid drawer as box() but shaded through this ramp.
  // Do not inline these multipliers per item — extend this helper instead.
  // V16 pass 3 — the outer silhouette outline is now strict pure black. The
  // old near-black `#0b0e1c` survives only as the *internal* fallback tint for
  // surfaces so dark that a "darker tint of themselves" would vanish.
  var OUTLINE = '#000000';
  var SEAM_FLOOR = '#0b0e1c';

  // V16 pass 2 — "CHUBBY" TOY PROPORTIONS, applied once in the shared cuboid
  // drawers rather than re-authored per prop. Vertical scale drops 15% and
  // footprints broaden 4% about their own centre, so the whole world reads as
  // a solid toy instead of tall/thin/clinical. Crucially `z` is squashed by
  // the SAME factor as `h`: a part sitting at z=24 on a 24-tall box still
  // lands exactly on it, so nothing floats or sinks.
  var VSCALE = 0.85;
  var FATTEN = 1.04;
  function chub(x, y, z, w, d, h) {
    var gx = w * (FATTEN - 1) / 2, gy = d * (FATTEN - 1) / 2;
    return {
      x: x - gx, y: y - gy, z: z * VSCALE,
      w: w * FATTEN, d: d * FATTEN, h: h * VSCALE
    };
  }

  function mulColor(hex, mult) {
    var c = hexToRgb(hex);
    return rgbToHex(clamp255(c.r * mult), clamp255(c.g * mult), clamp255(c.b * mult));
  }
  function luma(hex) {
    var c = hexToRgb(hex);
    return c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  }
  // V16 pass 4 — EXACTLY THREE TONES PER MATERIAL, implied top-left light.
  //   top   = highlight (×1.30)
  //   left  = base      (×1.00)
  //   right = shadow    (~25-30% darker, pushed slightly blue/purple so the
  //           shadow side reads as cool light-falloff, not just "less paint")
  // Plus three derived values that pass 3 needs:
  //   outline   — the 1px PURE BLACK outer silhouette
  //   accent    — the 1px bright line along the top-left edge of top surfaces
  //   seam*     — internal line art (drawer seams, folds, panel lines). Never
  //               black: each is a darker tint of ITS OWN local surface.
  function rampShade(hex) {
    // A "material" may be given as an explicit 3-tone triple instead of a
    // single base colour, for the objects SPEC-V16 §2.2 specifies literal
    // per-face hex for (pizza boxes, fridges, terracotta...). It still goes
    // through THIS helper — same outline, same accent, same seam rules — so
    // there is still exactly one ramp, just two ways to feed it.
    if (hex && typeof hex === 'object') {
      return {
        top: hex.top, left: hex.left, right: hex.right,
        outline: OUTLINE,
        accent: hex.accent || lerpColor(hex.top, '#ffffff', 0.34),
        topSeam: hex.seam || seamOf(hex.top),
        leftSeam: hex.seam || seamOf(hex.left),
        rightSeam: hex.seam || seamOf(hex.right)
      };
    }
    var c = hexToRgb(hex);
    var top = mulColor(hex, 1.30);
    var right = rgbToHex(
      clamp255(c.r * 0.70 * 0.96),
      clamp255(c.g * 0.70 * 0.95),
      clamp255(c.b * 0.70 * 1.14)
    );
    return {
      top: top,
      left: hex,
      right: right,
      outline: OUTLINE,
      // the top-left "rim light": the top tone pushed a further 30% toward
      // white so it survives even on an already-pale material.
      accent: lerpColor(top, '#ffffff', 0.34),
      topSeam: seamOf(top),
      leftSeam: seamOf(hex),
      rightSeam: seamOf(right)
    };
  }

  // seamOf(surface) — the internal line-art tint for a given surface colour:
  // 45% darker than the surface it is drawn on, with a floor so a nearly
  // black surface still gets a visible (rather than invisible) seam.
  function seamOf(surfaceHex) {
    var s = mulColor(surfaceHex, 0.55);
    return luma(s) < luma(SEAM_FLOOR) ? SEAM_FLOOR : s;
  }

  // boxRamp — the shared cuboid drawer, and the ONE place the V16 art
  // language lives. Faces are filled unstroked; then internal edges get their
  // local seam tint, the outer silhouette gets a single pure-black 1px pass,
  // and the top-left edge of the top face gets the bright accent.
  // `opts` (all optional): {noAccent, noOutline, seam:'#..'} for parts that
  // are visually *inside* another object's silhouette.
  function boxRamp(ctx, x, y, z, w, d, h, color, camera, opts) {
    camera = camera || { ox: 0, oy: 0 };
    opts = opts || {};
    var q = chub(x, y, z, w, d, h);
    x = q.x; y = q.y; z = q.z; w = q.w; d = q.d; h = q.h;

    var B01 = project(x, y + d, z, camera);
    var B11 = project(x + w, y + d, z, camera);
    var B10 = project(x + w, y, z, camera);
    var T00 = project(x, y, z + h, camera);
    var T10 = project(x + w, y, z + h, camera);
    var T11 = project(x + w, y + d, z + h, camera);
    var T01 = project(x, y + d, z + h, camera);

    var r = rampShade(color);

    drawPoly(ctx, [B01, B11, T11, T01], r.left, null);
    drawPoly(ctx, [B10, B11, T11, T10], r.right, null);
    drawPoly(ctx, [T00, T10, T11, T01], r.top, null);

    // internal edges — tinted, never black
    crispStroke(ctx, [T01, T11], opts.seam || r.leftSeam, false);
    crispStroke(ctx, [T10, T11], opts.seam || r.rightSeam, false);
    if (h > 0) crispStroke(ctx, [T11, B11], opts.seam || r.leftSeam, false);

    // outer silhouette — 1px pure black, drawn last so nothing eats it
    if (!opts.noOutline) {
      crispStroke(ctx, [T00, T10, B10, B11, B01, T01], r.outline, true);
    }
    // 1px bright accent along the top-left edge of the top face, inset one
    // pixel so it sits beside the black outline rather than under it.
    if (!opts.noAccent) {
      crispStroke(ctx, [
        { x: T00.x + 1, y: T00.y + 1 }, { x: T01.x + 1, y: T01.y + 1 }
      ], r.accent, false);
    }
  }

  // faceRamp helpers — draw a 1px line in world space through the ramp, for
  // prop-level internal line art (grain, creases, panel lines, grill bars).
  function isoLine(ctx, x0, y0, z0, x1, y1, z1, color, camera) {
    camera = camera || { ox: 0, oy: 0 };
    var a = chub(x0, y0, z0, 0, 0, 0), b = chub(x1, y1, z1, 0, 0, 0);
    crispStroke(ctx, [project(x0, y0, a.z, camera), project(x1, y1, b.z, camera)], color, false);
  }

  // pixelCircle — a real midpoint-rasterised circle (Bresenham), plotted as
  // whole 1px rects. Canvas `arc()` would antialias into a soft grey ring,
  // which is the one thing a 16-bit sprite must never do; the fan cage and
  // every round bevel go through this instead. `fillCol` (optional) floods
  // the interior first.
  function pixelCircle(ctx, cx, cy, radius, strokeCol, fillCol) {
    cx = Math.round(cx); cy = Math.round(cy); radius = Math.round(radius);
    var x = radius, y = 0, err = 1 - radius;
    var spans = {};
    function span(yy, x0, x1) {
      if (!spans[yy] || x0 < spans[yy][0]) spans[yy] = [x0, x1];
    }
    var pts = [];
    while (x >= y) {
      pts.push([x, y], [y, x], [-x, y], [-y, x], [-x, -y], [-y, -x], [x, -y], [y, -x]);
      y++;
      if (err < 0) err += 2 * y + 1;
      else { x--; err += 2 * (y - x) + 1; }
    }
    var i;
    if (fillCol) {
      for (i = 0; i < pts.length; i++) span(cy + pts[i][1], cx + pts[i][0], cx - pts[i][0]);
      ctx.fillStyle = fillCol;
      for (var k in spans) {
        var s = spans[k];
        ctx.fillRect(Math.min(s[0], s[1]), parseInt(k, 10), Math.abs(s[1] - s[0]) + 1, 1);
      }
    }
    if (strokeCol) {
      ctx.fillStyle = strokeCol;
      for (i = 0; i < pts.length; i++) ctx.fillRect(cx + pts[i][0], cy + pts[i][1], 1, 1);
    }
  }

  // isoDot — an n x n pixel-grid dot at a world position (magnets, spine
  // dots, tufting, vent holes, grease spots). Snapped to whole pixels.
  function isoDot(ctx, x, y, z, color, camera, sizeX, sizeY) {
    camera = camera || { ox: 0, oy: 0 };
    var p = project(x, y, z * VSCALE, camera);
    ctx.fillStyle = color;
    ctx.fillRect(p.x, p.y, sizeX || 2, sizeY || sizeX || 2);
  }

  function diamond(ctx, x, y, z, w, d, color, camera) {
    camera = camera || { ox: 0, oy: 0 };
    z *= VSCALE;
    var p00 = project(x, y, z, camera);
    var p10 = project(x + w, y, z, camera);
    var p11 = project(x + w, y + d, z, camera);
    var p01 = project(x, y + d, z, camera);
    drawPoly(ctx, [p00, p10, p11, p01], color, shade(color, -0.35));
  }

  // diamondRamp — same flat quad as diamond(), but stroked through the V16
  // ramp's outline value (rampShade(color).outline, near-black or the
  // universal --outline, whichever reads darker) instead of diamond()'s own
  // ad-hoc shade(color,-0.35) stroke. Fill uses rampShade's top face (the
  // lightest of the four) since a floor-flat prop like a rug only ever shows
  // its "top". This does NOT introduce a second ramp — it is rampShade()
  // applied to a flat shape instead of a cuboid (ART-DIRECTION §2.2).
  function diamondRamp(ctx, x, y, z, w, d, color, camera) {
    camera = camera || { ox: 0, oy: 0 };
    z *= VSCALE;
    var p00 = project(x, y, z, camera);
    var p10 = project(x + w, y, z, camera);
    var p11 = project(x + w, y + d, z, camera);
    var p01 = project(x, y + d, z, camera);
    var r = rampShade(color);
    drawPoly(ctx, [p00, p10, p11, p01], r.top, r.outline);
    // top-left rim light, matching boxRamp's accent on every top surface
    crispStroke(ctx, [{ x: p00.x + 1, y: p00.y + 1 }, { x: p01.x + 1, y: p01.y + 1 }], r.accent, false);
  }

  function glow(ctx, sx, sy, radius, color, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
    var c = hexToRgb(color);
    g.addColorStop(0, 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')');
    g.addColorStop(1, 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function lerpColor(hexA, hexB, u) {
    var a = hexToRgb(hexA), b = hexToRgb(hexB);
    return rgbToHex(clamp255(lerp(a.r, b.r, u)), clamp255(lerp(a.g, b.g, u)), clamp255(lerp(a.b, b.b, u)));
  }
  /* ---- SPEC-V21 §7 — CUSTOMISATION TINT ------------------------------------
     A placed item may carry a `tint` (State.data.placed[i].tint), already
     validated against its family's palette by State.setItemTint(). This block
     is the ONLY place iso.js knows what a tint is; the five props below just
     ask it for a base colour and hand that to the existing ramp.

     THE RULE THAT MATTERS: a tint recolours the BASE, it never paints a face.
     Everything downstream (boxRamp -> rampShade: top ×1.30 / left ×1.00 /
     right ×0.70-cooled, pure-black silhouette, top-left accent, seamOf()
     internal line art) re-derives from that base, so a dyed prop keeps the
     exact same three-tone modelling as an undyed one. A flat fill over the
     geometry would be the one failure mode this whole feature can have.

     NO ID LIST LIVES HERE. Which items are customisable, and whether a given
     one is fabric or light, is `def.customisable` / `def.ledCustomise` in
     js/data.js, read through State.customiseFamily() — the single source of
     truth (SPEC-V21 §1/§5). A sixth customisable item needs no edit in this
     file beyond its own prop art.
  ------------------------------------------------------------------------- */

  // tintFor(itemId, tint) — build the per-instance tint context that rides in
  // drawFamily()'s `extra` bag. Both callers (renderRoom's placed loop and
  // renderPropIcon) go through this, so the room and the icon can never
  // disagree about a colour's family.
  function tintFor(itemId, tint) {
    if (typeof tint !== 'string' || !tint) return { tint: null, tintEmissive: false };
    var S = window.Game && window.Game.State;
    var fam = (S && S.customiseFamily) ? S.customiseFamily(itemId) : null;
    return { tint: tint, tintEmissive: fam === 'led' };
  }

  // tintOf(extra, emissive) — a prop asks for its tint, declaring the material
  // it is made of: `true` for a light-emitting surface (LED strip, neon tube,
  // floor screen), `false` for cloth (banner, blind slat). A tint whose family
  // does not match the asking material is IGNORED and the prop renders factory
  // art — so a mismatch can never produce a half-tinted prop (a cyan body with
  // a rainbow glow, say). With the flags in js/data.js correct this never
  // fires; it exists so a future data mistake degrades to "unchanged art"
  // rather than to broken art.
  // A null/absent tint returns null here and every prop takes its untouched
  // factory branch — the V21 regression risk, kept to one comparison.
  function tintOf(extra, emissive) {
    if (!extra || typeof extra.tint !== 'string' || !extra.tint) return null;
    return (!!extra.tintEmissive === !!emissive) ? extra.tint : null;
  }

  // dyeRel(baseHex, refHex, tint) — dye a SECONDARY surface of a tinted
  // material (a blind's opaque backing cloth behind its slats) by carrying
  // over the value relationship it had with the primary surface, rather than
  // by inventing a second constant. luma(#9E9581)/luma(#D6CBB2) = 0.735, so a
  // dyed backing stays exactly 26.5% darker than its slats at every hue and
  // the two never converge into one flat plane.
  function dyeRel(baseHex, refHex, tint) {
    if (!tint) return baseHex;
    var ref = luma(refHex);
    return mulColor(tint, ref > 0 ? luma(baseHex) / ref : 1);
  }

  // ledBreathe(time) — 0..1 on a slow ~2.4s sine. An untinted LED in this room
  // is alive because it cycles hue; a tinted one cannot (the entire point of
  // picking a colour is that it stays), so the "this is a light, not a painted
  // rectangle" cue moves to a gentle luminance breathe. Amplitude is small on
  // purpose: the prop should look powered, not like it is faulty.
  function ledBreathe(time) { return 0.5 + 0.5 * Math.sin((time || 0) / 380); }

  // stopColor: multi-stop color ramp, e.g. [{u:0,c:'#..'},{u:0.5,c:'#..'},{u:1,c:'#..'}]
  // — used to blend day -> sunset -> night through a vivid warm midpoint
  // rather than a flat 2-color lerp (SPEC-V3 §2: "never a hard swap").
  function stopColor(stops, u) {
    u = clamp01(u);
    for (var i = 0; i < stops.length - 1; i++) {
      var s0 = stops[i], s1 = stops[i + 1];
      if (u <= s1.u) {
        var span = (s1.u - s0.u) || 1;
        return lerpColor(s0.c, s1.c, (u - s0.u) / span);
      }
    }
    return stops[stops.length - 1].c;
  }
  function smoothstep(e0, e1, x) {
    var u = clamp01((x - e0) / (e1 - e0));
    return u * u * (3 - 2 * u);
  }

  /* ---- locations (SPEC-V2 §6/§7) --------------------------------------------
     Data.locations (js/data.js, frozen) holds the economic facts (grid size,
     cost, rent, stream mult, backdrop id). It intentionally carries no visual
     material data — that's a renderer concern, so it lives here. This table
     replaced the legacy Data.roomTiers path (deleted outright in
     TASKS-REMAINING #5) for anything iso.js draws; grid
     size for rendering always comes from State.currentGrid() (base + bought
     expansions), never from Data.locations directly.

     NAME COLLISION, worth knowing before you read further: the `roomTier`
     parameter on computeCamera()/drawFloor()/drawWalls()/wallTexture() below
     is a LOCAL name for a LOCATION_VISUALS-derived object. It never referred
     to that deleted table. ------------------------------------------------- */
  // V16 §2.3 — MATERIALS PER LOCATION. Six locations, and the whole point of
  // the set is that it reads as a PROGRESSION: the basement is the only one
  // that is damaged at all, and every step up is a visibly better material —
  // dingy wallpaper over rotten boards, then clean paint over honey parquet,
  // whitewash over sandstone, deep indigo over walnut with gold trim, slate
  // over polished concrete with chrome, and finally bright whitewash over
  // rich teak. Floors deliberately sit DARKER than the walls at every tier so
  // props (which are lit top-left) pop off them.
  //   damaged  — basement only: peeling plaster + floor cutouts.
  //   accent   — the material's own "expensive detail" colour (inlay/grout).
  //   floorSeam— 'plank' draws long board seams, 'tile' draws grout crosses.
  //
  // SPEC-V20 §1 — the `windows: N` field that used to live on every entry is
  // GONE, along with drawWalls()'s two loops that baked N windows into the
  // shell. No location draws a window any more; windows are purchasable,
  // wall-mounted props (propMap's window_* ids -> props.window below).
  // The legacy `Data.roomTiers` table that carried the matching dead
  // `windows:` field has since been deleted outright (TASKS-REMAINING #5);
  // see the tombstone comment where it used to sit in js/data.js.
  var LOCATION_VISUALS = [
    // 0 — PARENTS' BASEMENT: dingy tan wallpaper, rotten boards. The ONLY
    // location with damage textures.
    { wallColor: '#A08D74', floorA: '#6B5644', floorB: '#5E4B3B', trimColor: '#4A3A2C',
      damaged: true, accent: '#8E7761', floorSeam: 'plank' },
    // 1 — CITY CENTRE APARTMENT: clean cool paint, honey parquet.
    { wallColor: '#7F8CA8', floorA: '#8A6A48', floorB: '#7A5C3E', trimColor: '#3D4459',
      accent: '#AEBBD4', floorSeam: 'plank' },
    // 2 — BEACH VILLA: whitewashed plaster, pale sandstone tile, teal trim.
    { wallColor: '#DED3B8', floorA: '#C0A87C', floorB: '#AF976C', trimColor: '#2F8F86',
      accent: '#F4EEDC', floorSeam: 'tile' },
    // 3 — ESPORTS MANSION: deep indigo walls, dark walnut, gold trim.
    { wallColor: '#413465', floorA: '#5A4636', floorB: '#4E3C2E', trimColor: '#C9A34A',
      accent: '#E0BE64', floorSeam: 'plank' },
    // 4 — PENTHOUSE SUITE: slate, polished concrete, chrome.
    { wallColor: '#37405A', floorA: '#6E7686', floorB: '#616978', trimColor: '#C2C9D6',
      accent: '#DFE5F0', floorSeam: 'tile' },
    // 5 — PRIVATE ISLAND COMPOUND: bright whitewash, rich teak, teal/gold.
    { wallColor: '#EFE4CD', floorA: '#B98A55', floorB: '#A77A49', trimColor: '#2A9D8F',
      accent: '#FFF8E6', floorSeam: 'plank' }
  ];

  // getRoomVisual(state): the single place that turns save data into the
  // renderer's room shape — locationId + expansions (via State.currentGrid())
  // + a per-location material palette. Legacy `state.roomTier` is never read.
  function getRoomVisual(state) {
    var Data = window.Game.Data, State = window.Game.State;
    var locId = (state && state.locationId) || 0;
    var style = LOCATION_VISUALS[locId] || LOCATION_VISUALS[0];
    var loc = (Data.locations && Data.locations[locId]) || (Data.locations && Data.locations[0]);
    var grid = (State && State.currentGrid) ? State.currentGrid() : null;
    return {
      gridW: grid ? grid.w : (loc ? loc.gridW : 6),
      gridD: grid ? grid.d : (loc ? loc.gridD : 6),
      wallColor: style.wallColor, floorA: style.floorA, floorB: style.floorB,
      trimColor: style.trimColor,
      damaged: !!style.damaged, accent: style.accent, floorSeam: style.floorSeam || 'plank',
      locationId: locId,
      backdrop: (loc && loc.backdrop) || 'suburban_night',
      name: loc ? loc.name : ''
    };
  }

  /* ---- starfield backdrop -------------------------------------------------
     Deterministic pseudo-random star field (seeded, so it doesn't jitter
     frame to frame) rendered behind the room. Slow twinkle via time. ------ */
  var STAR_CACHE = { key: '', stars: [] };
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function buildStars(w, h) {
    var key = w + 'x' + h;
    if (STAR_CACHE.key === key) return STAR_CACHE.stars;
    var rnd = mulberry32(1337);
    var count = Math.max(40, Math.round((w * h) / 5200));
    var stars = [];
    for (var i = 0; i < count; i++) {
      stars.push({
        x: rnd() * w,
        y: rnd() * h,
        r: 0.5 + rnd() * 1.3,
        phase: rnd() * Math.PI * 2,
        speed: 0.0007 + rnd() * 0.0016,
        big: rnd() < 0.12
      });
    }
    STAR_CACHE = { key: key, stars: stars };
    return stars;
  }
  function drawStarfield(ctx, w, h, time) {
    ctx.save();
    var grad = ctx.createRadialGradient(w * 0.5, h * 0.18, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.85);
    grad.addColorStop(0, '#141a3a');
    grad.addColorStop(1, '#070a16');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    var stars = buildStars(w, h);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * s.speed + s.phase));
      ctx.globalAlpha = tw * (s.big ? 1 : 0.7);
      ctx.fillStyle = s.big ? '#eaf0ff' : '#c7d0f0';
      var r = s.big ? s.r * 1.6 : s.r;
      ctx.fillRect(s.x - r / 2, s.y - r / 2, r, r);
    }
    ctx.restore();
  }

  /* ---- location backdrops (SPEC-V2 §7, day/night cycle SPEC-V3 §2) ----------
     Each location gets a distinct, procedurally-drawn scene behind the room
     (no image assets) so a move feels like a real change of scene. All use a
     seeded cache the same way buildStars() does, so silhouettes don't jitter
     frame to frame — only glow/twinkle/blink terms move with `time`.

     Every backdrop now also takes `dnT` (0..1 = State.dayPhase().sunsetProgress)
     and blends daylight blue -> warm sunset -> deep night through a 3-stop
     color ramp (stopColor(), §2: "never a hard swap"). `dnT` sits at 0 for the
     whole DAY phase, ramps 0->1 continuously across the 60s SUNSET window,
     and locks at 1 for all of NIGHT — so per-frame interpolation only has to
     happen during that one window, exactly matching the spec's timing. ---- */
  var SILH_CACHE = {};
  function silhouette(cacheKey, w, h, seed, count, build) {
    var key = cacheKey + ':' + w + 'x' + h;
    var c = SILH_CACHE[cacheKey];
    if (c && c.key === key) return c.items;
    var rnd = mulberry32(seed);
    var items = [];
    for (var i = 0; i < count; i++) items.push(build(rnd, i));
    SILH_CACHE[cacheKey] = { key: key, items: items };
    return items;
  }

  // skyGradient: fills the full canvas with a vertical gradient whose color
  // stops span only the top `horizonPx` (matching the original per-backdrop
  // technique — everything below the horizon just inherits the bottom
  // color as a flat wash). top/bottom colors are each 3-stop day/sunset/
  // night ramps blended by dnT.
  function skyGradient(ctx, w, h, horizonPx, stops, dnT) {
    var topC = stopColor([{ u: 0, c: stops.top[0] }, { u: 0.5, c: stops.top[1] }, { u: 1, c: stops.top[2] }], dnT);
    var botC = stopColor([{ u: 0, c: stops.bottom[0] }, { u: 0.5, c: stops.bottom[1] }, { u: 1, c: stops.bottom[2] }], dnT);
    var grad = ctx.createLinearGradient(0, 0, 0, horizonPx);
    grad.addColorStop(0, topC);
    grad.addColorStop(1, botC);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // starOverlay: reuses the seeded starfield; alpha fades in across the back
  // half of sunset into night (§2: "stars fade in across sunset").
  function starOverlay(ctx, w, bandH, time, dnT) {
    var starAlpha = smoothstep(0.35, 0.85, dnT);
    if (starAlpha <= 0.01) return;
    var stars = buildStars(w, Math.max(60, bandH));
    ctx.save();
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      if (s.y > bandH) continue;
      var tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time * s.speed + s.phase));
      ctx.globalAlpha = starAlpha * tw * (s.big ? 1 : 0.7);
      ctx.fillStyle = s.big ? '#eaf0ff' : '#c7d0f0';
      var r = s.big ? s.r * 1.6 : s.r;
      ctx.fillRect(s.x - r / 2, s.y - r / 2, r, r);
    }
    ctx.restore();
  }

  // drawSunMoon: one shared celestial body — a sun that sinks toward the
  // horizon and fades out through the sunset window, crossfading into a
  // moon that rises and settles for the rest of the night (§2: "any
  // sun/moon element moves"). `horizonPx` anchors the bottom of its arc.
  function drawSunMoon(ctx, w, horizonPx, dnT) {
    var sunAlpha = 1 - smoothstep(0.45, 0.75, dnT);
    if (sunAlpha > 0.01) {
      var sunT = clamp01(dnT / 0.7);
      var sx = w * lerp(0.28, 0.80, sunT);
      var sy = lerp(horizonPx * 0.14, horizonPx * 1.02, sunT * sunT);
      var sunCol = stopColor([{ u: 0, c: '#fff3c4' }, { u: 0.55, c: '#ffb15c' }, { u: 1, c: '#ff7a4a' }], sunT);
      ctx.save();
      ctx.globalAlpha = sunAlpha;
      glow(ctx, sx, sy, 46, sunCol, 0.30);
      ctx.fillStyle = sunCol;
      ctx.beginPath(); ctx.arc(sx, sy, 15, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    var moonAlpha = smoothstep(0.55, 0.85, dnT);
    if (moonAlpha > 0.01) {
      var moonT = smoothstep(0.55, 1, dnT);
      var mx = w * lerp(0.72, 0.62, moonT);
      var my = lerp(horizonPx * 0.9, horizonPx * 0.22, moonT);
      ctx.save();
      ctx.globalAlpha = moonAlpha;
      glow(ctx, mx, my, 32, '#c9d6ff', 0.20);
      ctx.fillStyle = '#eef1ff';
      ctx.beginPath(); ctx.arc(mx, my, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(160,175,220,0.55)';
      ctx.beginPath(); ctx.arc(mx - 3.5, my - 2, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(mx + 2, my + 3.5, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // drawGroundBase (SPEC-V6 §29): the flat day/sunset/night-ramped gradient
  // fill every per-location ground plane starts from, `baseY` down to the
  // bottom of the canvas. Shared because every ground fn below needs exactly
  // this step; the texture layered on top of it is what actually varies per
  // location, so that part stays hand-rolled in each fn rather than forced
  // through one shared shape.
  function drawGroundBase(ctx, w, h, baseY, topC, botC) {
    var grad = ctx.createLinearGradient(0, baseY, 0, h);
    grad.addColorStop(0, topC);
    grad.addColorStop(1, botC);
    ctx.fillStyle = grad;
    ctx.fillRect(0, baseY, w, Math.max(0, h - baseY));
  }

  // drawGrassGround (SPEC-V5 §31): the distant houses were floating over
  // nothing — fill the ground beneath/in front of them with a textured
  // green plane, not a flat wash. `baseY` is the houses' base line (top of
  // the plane); it extends down to the bottom of the canvas so it reads
  // behind the room silhouette on every side. Textured with a soft vertical
  // shade (near = darker/richer), a handful of low-alpha tonal patches, and
  // small darker tuft strokes — all seeded so they don't jitter frame to
  // frame. Colors ramp day -> sunset (warmer, slightly gold-kissed) ->
  // night (deep blue-green), matching the sky's own 3-stop ramp.
  function drawGrassGround(ctx, w, h, baseY, dnT, time) {
    var topC = stopColor([{ u: 0, c: '#8fce5c' }, { u: 0.5, c: '#7a9a4a' }, { u: 1, c: '#16352a' }], dnT);
    var botC = stopColor([{ u: 0, c: '#4f9a3c' }, { u: 0.5, c: '#4c6a2e' }, { u: 1, c: '#0a1f1a' }], dnT);
    ctx.save();
    var grad = ctx.createLinearGradient(0, baseY, 0, h);
    grad.addColorStop(0, topC);
    grad.addColorStop(1, botC);
    ctx.fillStyle = grad;
    ctx.fillRect(0, baseY, w, Math.max(0, h - baseY));

    // subtle tonal patches — soft, low-alpha blobs of lighter/darker green
    var patches = silhouette('grass_patches', w, h, 7331, 14, function (rnd) {
      return {
        x: rnd() * w, y: baseY + rnd() * rnd() * (h - baseY),
        r: 18 + rnd() * 34, dark: rnd() < 0.5
      };
    });
    var patchCol = stopColor([{ u: 0, c: '#ffffff' }, { u: 0.5, c: '#ffe9a8' }, { u: 1, c: '#0a2a20' }], dnT);
    patches.forEach(function (p) {
      ctx.globalAlpha = p.dark ? 0.07 : 0.05;
      ctx.fillStyle = p.dark ? '#0e2a1c' : patchCol;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r, p.r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // darker tufts — short little blade clumps, denser near the bottom
    var tuftCol = stopColor([{ u: 0, c: '#2e6b25' }, { u: 0.5, c: '#3d5322' }, { u: 1, c: '#04140f' }], dnT);
    var tufts = silhouette('grass_tufts', w, h, 9042, 46, function (rnd) {
      var t = rnd();
      return { x: rnd() * w, y: baseY + t * (h - baseY), s: 2 + t * 3.5, sway: rnd() * Math.PI * 2 };
    });
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = tuftCol;
    ctx.lineWidth = 1;
    tufts.forEach(function (t) {
      var sway = Math.sin(time / 1400 + t.sway) * 0.6;
      ctx.beginPath();
      ctx.moveTo(t.x - t.s, t.y);
      ctx.lineTo(t.x + sway, t.y - t.s * 1.6);
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x + t.s + sway, t.y - t.s * 1.3);
      ctx.stroke();
    });
    ctx.restore();
  }

  // location 0 — suburban street: bright morning-blue sky by day, a warm
  // gold/violet sunset, then the original navy night with lit windows.
  function drawSuburbanNight(ctx, w, h, time, dnT) {
    ctx.save();
    var horizon = h * 0.5;
    skyGradient(ctx, w, h, horizon, {
      top:    ['#5fa8e8', '#4a3a6e', '#0b1029'],
      bottom: ['#cfe8ff', '#ff9d5c', '#1a2144']
    }, dnT);

    starOverlay(ctx, w, h * 0.34, time, dnT);
    drawSunMoon(ctx, w, horizon, dnT);

    // V16 §2.3 — HOUSES NO LONGER FLOAT. Three concrete causes, all fixed
    // here, and the concept itself is untouched:
    //   (a) the ground plane was painted AFTER the houses, so nothing ever
    //       read as being *underneath* them — the ground is now laid first;
    //   (b) six fixed-width houses spaced +6px apart did not reach the right
    //       edge and left sky-coloured GAPS between them, so individual
    //       roofs read as detached objects hanging in the sky — the row now
    //       repeats until it covers the full canvas width, with no gap wider
    //       than a house is tall;
    //   (c) every house was flush with the horizon line to the pixel — each
    //       one now sinks 4px BELOW it and gets a 1px contact-shadow line,
    //       which is what actually sells "standing on the ground".
    // ...and (d) the horizon itself sat at 0.34h, which is BELOW the top of
    // the room's own side walls — so the only part of any house that ever
    // cleared the wall was the tip of its roof, a triangle apparently
    // hanging in the sky with no building under it. Lifting the horizon to
    // 0.26h puts the ground line, the hedge and the lower storeys all above
    // the wall line on both sides of the room, so you can see what the roofs
    // are standing on.
    var baseY = Math.round(h * 0.26);
    drawGrassGround(ctx, w, h, baseY, dnT, time);

    var houses = silhouette('suburban_houses', w, h, 4242, 14, function (rnd, i) {
      var hw = 42 + rnd() * 46, hh = 26 + rnd() * 38;
      return { hw: hw, hh: hh, roof: 8 + rnd() * 12, lit: rnd() < 0.55, litSeed: rnd() };
    });
    var bodyCol = stopColor([{ u: 0, c: '#c9a876' }, { u: 0.5, c: '#2c2440' }, { u: 1, c: '#131a34' }], dnT);
    var roofCol = stopColor([{ u: 0, c: '#9a6a48' }, { u: 0.5, c: '#1e1830' }, { u: 1, c: '#0d1226' }], dnT);
    var hedgeCol = stopColor([{ u: 0, c: '#5f9440' }, { u: 0.5, c: '#4a5c2c' }, { u: 1, c: '#0d2418' }], dnT);
    var litFactor = smoothstep(0.2, 0.75, dnT);
    // a continuous hedge/treeline right on the horizon: the unbroken
    // silhouette that keeps the skyline from ever showing sky at ground level
    ctx.fillStyle = hedgeCol;
    ctx.fillRect(0, baseY - 5, w, 9);
    for (var hx = 0; hx < w; hx += 7) {
      var bump = 3 + ((hx * 7919) % 5);
      ctx.fillRect(hx, baseY - 5 - bump, 7, bump);
    }

    var x = -10, i = 0;
    while (x < w + 20) {
      var hs = houses[i % houses.length];
      i++;
      var top = baseY - hs.hh;
      ctx.fillStyle = bodyCol;
      ctx.fillRect(Math.round(x), top, Math.round(hs.hw), hs.hh + 4); // +4: embedded
      ctx.fillStyle = roofCol;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) - 3, top);
      ctx.lineTo(Math.round(x + hs.hw / 2), top - hs.roof);
      ctx.lineTo(Math.round(x + hs.hw) + 3, top);
      ctx.closePath();
      ctx.fill();
      if (hs.lit && litFactor > 0.02) {
        var flicker = 0.7 + 0.3 * Math.sin(time / 650 + hs.litSeed * 40);
        ctx.fillStyle = 'rgba(255,196,90,' + (0.55 * flicker * litFactor).toFixed(3) + ')';
        ctx.fillRect(Math.round(x + hs.hw * 0.28), baseY - hs.hh * 0.62, 6, 8);
        ctx.fillRect(Math.round(x + hs.hw * 0.60), baseY - hs.hh * 0.4, 6, 8);
      }
      // 1px contact shadow where the wall meets the ground
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(Math.round(x) - 2, baseY + 4, Math.round(hs.hw) + 4, 2);
      x += hs.hw + 2 + (i % 3);
    }
    glow(ctx, w * 0.5, baseY - 6, 55, '#ffd54a', 0.04 + 0.08 * litFactor);
    ctx.restore();
  }

  // drawPavementGround (§29): sidewalk slabs over asphalt beneath the
  // skyline — expansion-joint seams in a loose grid, plus a few glossy
  // rain-puddle highlights that only read once the neon comes up at night.
  function drawPavementGround(ctx, w, h, baseY, dnT, time) {
    var topC = stopColor([{ u: 0, c: '#9aa0a8' }, { u: 0.5, c: '#7a6a68' }, { u: 1, c: '#242a3c' }], dnT);
    var botC = stopColor([{ u: 0, c: '#6e747c' }, { u: 0.5, c: '#4a4048' }, { u: 1, c: '#141828' }], dnT);
    ctx.save();
    drawGroundBase(ctx, w, h, baseY, topC, botC);

    // slab seams — a loose grid of expansion joints, denser (closer
    // together) toward the bottom to sell perspective.
    var seamCol = stopColor([{ u: 0, c: '#5c6470' }, { u: 0.5, c: '#382e34' }, { u: 1, c: '#0c1018' }], dnT);
    ctx.strokeStyle = seamCol;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    var rows = 6;
    for (var r = 1; r <= rows; r++) {
      var t = r / rows;
      var y = baseY + (h - baseY) * (t * t);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    var cols = silhouette('pavement_cols', w, h, 6102, 9, function (rnd) { return { u: rnd() }; });
    cols.forEach(function (c) {
      ctx.beginPath(); ctx.moveTo(c.u * w, baseY); ctx.lineTo(c.u * w, h); ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // hairline surface cracks, seeded
    var cracks = silhouette('pavement_cracks', w, h, 4477, 10, function (rnd) {
      return { x: rnd() * w, y: baseY + rnd() * (h - baseY), len: 6 + rnd() * 10, ang: rnd() * Math.PI };
    });
    ctx.strokeStyle = seamCol;
    ctx.globalAlpha = 0.35;
    cracks.forEach(function (c) {
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + Math.cos(c.ang) * c.len, c.y + Math.sin(c.ang) * c.len * 0.4);
      ctx.stroke();
    });

    // rain-puddle glints — only visible once night's neon is up
    var puddleAlpha = smoothstep(0.35, 0.85, dnT);
    if (puddleAlpha > 0.02) {
      var puddles = silhouette('pavement_puddles', w, h, 8811, 4, function (rnd) {
        return { x: rnd() * w, y: baseY + 20 + rnd() * (h - baseY - 20), rw: 14 + rnd() * 18, seed: rnd() };
      });
      puddles.forEach(function (p) {
        var shimmer = 0.5 + 0.5 * Math.sin(time / 500 + p.seed * 30);
        ctx.globalAlpha = puddleAlpha * (0.10 + 0.08 * shimmer);
        ctx.fillStyle = '#8fd6ff';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.rw, p.rw * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // location 1 — city centre apartment, neon skyline: bright day haze over
  // the towers, gold/pink dusk, then the original purple-blue night with
  // neon windows blinking at full strength.
  var NEON_COLORS = ['#34d3ff', '#ff4d9d', '#8847ff', '#ffd54a', '#3ddc84'];
  function drawNeonSkyline(ctx, w, h, time, dnT) {
    ctx.save();
    var horizon = h * 0.55;
    skyGradient(ctx, w, h, horizon, {
      top:    ['#6fa4e0', '#3a2255', '#140a2c'],
      bottom: ['#cfe0f5', '#ff8f6c', '#241a44']
    }, dnT);
    starOverlay(ctx, w, h * 0.3, time, dnT);
    drawSunMoon(ctx, w, horizon, dnT);

    var baseY = h * 0.40;
    var towers = silhouette('neon_towers', w, h, 909, 8, function (rnd, i) {
      var tw = 30 + rnd() * 34, th = 50 + rnd() * 120;
      var winCols = 2 + Math.floor(rnd() * 2), winRows = 3 + Math.floor(rnd() * 5);
      return { tw: tw, th: th, winCols: winCols, winRows: winRows, seed: rnd() };
    });
    var bodyCol = stopColor([{ u: 0, c: '#3a4468' }, { u: 0.5, c: '#241a3c' }, { u: 1, c: '#160f30' }], dnT);
    var neonFactor = 0.12 + 0.88 * smoothstep(0.15, 0.7, dnT);
    var x = -6;
    towers.forEach(function (tw2) {
      ctx.fillStyle = bodyCol;
      ctx.fillRect(x, baseY - tw2.th, tw2.tw, tw2.th);
      var padX = 4, padY = 6, cw = (tw2.tw - padX * 2) / tw2.winCols, ch = 7;
      for (var r = 0; r < tw2.winRows; r++) {
        for (var c = 0; c < tw2.winCols; c++) {
          var seedVal = (tw2.seed * 97 + r * 13 + c * 7) % 1;
          if (seedVal > 0.62) continue;
          var blink = 0.55 + 0.45 * Math.sin(time / 500 + r * 2 + c * 3 + tw2.seed * 30);
          var col = NEON_COLORS[Math.floor(seedVal * 971) % NEON_COLORS.length];
          ctx.globalAlpha = (0.55 + 0.35 * blink) * neonFactor;
          ctx.fillStyle = col;
          ctx.fillRect(x + padX + c * cw, baseY - tw2.th + padY + r * (ch + 5), cw - 2, ch);
        }
      }
      ctx.globalAlpha = 1;
      x += tw2.tw + 5;
    });
    glow(ctx, w * 0.22, baseY - 90, 70, '#8847ff', 0.02 + 0.08 * neonFactor);
    glow(ctx, w * 0.78, baseY - 130, 80, '#34d3ff', 0.02 + 0.07 * neonFactor);
    drawPavementGround(ctx, w, h, baseY, dnT, time);
    ctx.restore();
  }

  // drawSandGround (§29): dry beach sand, with a handful of low-alpha tonal
  // patches (like drawGrassGround's) plus short wind-ripple arcs instead of
  // grass tufts — reads as sand, not grass, at a glance.
  function drawSandGround(ctx, w, h, baseY, dnT, time) {
    var topC = stopColor([{ u: 0, c: '#f0dfb0' }, { u: 0.5, c: '#e8b978' }, { u: 1, c: '#332c20' }], dnT);
    var botC = stopColor([{ u: 0, c: '#d9c68c' }, { u: 0.5, c: '#c2925a' }, { u: 1, c: '#1e170f' }], dnT);
    ctx.save();
    drawGroundBase(ctx, w, h, baseY, topC, botC);

    var patches = silhouette('sand_patches', w, h, 2201, 12, function (rnd) {
      return { x: rnd() * w, y: baseY + rnd() * rnd() * (h - baseY), r: 16 + rnd() * 30, dark: rnd() < 0.5 };
    });
    var patchCol = stopColor([{ u: 0, c: '#fff6da' }, { u: 0.5, c: '#ffdca0' }, { u: 1, c: '#3c2f1c' }], dnT);
    patches.forEach(function (p) {
      ctx.globalAlpha = p.dark ? 0.06 : 0.07;
      ctx.fillStyle = p.dark ? '#b58a4e' : patchCol;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r, p.r * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // wind-ripple arcs, denser near the bottom
    var rippleCol = stopColor([{ u: 0, c: '#c9a468' }, { u: 0.5, c: '#a6763e' }, { u: 1, c: '#241c12' }], dnT);
    var ripples = silhouette('sand_ripples', w, h, 6690, 24, function (rnd) {
      var t = rnd();
      return { x: rnd() * w, y: baseY + t * (h - baseY), rw: 10 + t * 16, sway: rnd() * Math.PI * 2 };
    });
    ctx.strokeStyle = rippleCol;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ripples.forEach(function (r) {
      var wob = Math.sin(time / 1800 + r.sway) * 1.2;
      ctx.beginPath();
      ctx.moveTo(r.x - r.rw, r.y);
      ctx.quadraticCurveTo(r.x, r.y + 2 + wob, r.x + r.rw, r.y);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // location 2 — beach villa, ocean: bright turquoise noon by day, the
  // original warm sunset at the midpoint, dark moonlit water by night.
  function drawOceanSunset(ctx, w, h, time, dnT) {
    ctx.save();
    var horizon = h * 0.40;
    skyGradient(ctx, w, h, horizon, {
      top:    ['#4fa8e0', '#3a2a5c', '#0c1230'],
      bottom: ['#bfe6ff', '#c9527a', '#1c2c4a']
    }, dnT);
    starOverlay(ctx, w, horizon, time, dnT);
    drawSunMoon(ctx, w, horizon, dnT);

    var seaTopCol = stopColor([{ u: 0, c: '#3fb8c9' }, { u: 0.5, c: '#ff9a5c' }, { u: 1, c: '#16243c' }], dnT);
    var seaBotCol = stopColor([{ u: 0, c: '#1c6f8a' }, { u: 0.5, c: '#274d78' }, { u: 1, c: '#0a1224' }], dnT);
    var seaGrad = ctx.createLinearGradient(0, horizon, 0, horizon + h * 0.14);
    seaGrad.addColorStop(0, seaTopCol); seaGrad.addColorStop(1, seaBotCol);
    ctx.fillStyle = seaGrad;
    ctx.fillRect(0, horizon, w, h * 0.14);

    var shimmerCol = stopColor([{ u: 0, c: '#eafcff' }, { u: 0.5, c: '#ffd54a' }, { u: 1, c: '#8fb0ff' }], dnT);
    var shimmerX = w * lerp(0.5, 0.66, smoothstep(0, 0.7, dnT));
    for (var i = 0; i < 5; i++) {
      var ly = horizon + 4 + i * 6;
      var shimmer = 0.4 + 0.6 * Math.sin(time / 400 + i * 1.4);
      ctx.fillStyle = shimmerCol;
      ctx.globalAlpha = (0.14 + 0.08 * (1 - dnT * 0.5)) * shimmer;
      ctx.fillRect(shimmerX - 40 + i * 3, ly, 80 - i * 12, 2);
    }
    ctx.globalAlpha = 1;

    var palms = silhouette('palms', w, h, 555, 3, function (rnd) {
      return { side: rnd() < 0.5 ? -1 : 1, hgt: 60 + rnd() * 40, lean: (rnd() - 0.5) * 0.5 };
    });
    var palmCol = stopColor([{ u: 0, c: '#2f4a2c' }, { u: 0.5, c: '#241428' }, { u: 1, c: '#0e1020' }], dnT);
    palms.forEach(function (p, i) {
      var px = p.side < 0 ? w * (0.06 + i * 0.02) : w * (0.90 - i * 0.02);
      ctx.strokeStyle = palmCol;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(px, horizon + 2);
      ctx.quadraticCurveTo(px + p.lean * 30, horizon - p.hgt * 0.6, px + p.lean * 46, horizon - p.hgt);
      ctx.stroke();
      ctx.fillStyle = palmCol;
      var fx = px + p.lean * 46, fy = horizon - p.hgt;
      for (var fr = 0; fr < 5; fr++) {
        var ang = (fr / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(fx + Math.cos(ang) * 14, fy + Math.sin(ang) * 8 - 4, 16, 6, ang, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    drawSandGround(ctx, w, h, horizon + h * 0.14, dnT, time);
    ctx.restore();
  }

  // drawLawnGround (§29): manicured lawn — alternating mowing-stripe bands
  // (the classic "cut in lanes" pattern) instead of drawGrassGround's wild
  // tufts, since this is the ESPORTS MANSION's front lawn, not a backyard.
  function drawLawnGround(ctx, w, h, baseY, dnT, time) {
    var topC = stopColor([{ u: 0, c: '#6fae4a' }, { u: 0.5, c: '#4a6a34' }, { u: 1, c: '#163a20' }], dnT);
    var botC = stopColor([{ u: 0, c: '#4c8f34' }, { u: 0.5, c: '#375020' }, { u: 1, c: '#0e2416' }], dnT);
    ctx.save();
    drawGroundBase(ctx, w, h, baseY, topC, botC);
    var stripeCol = stopColor([{ u: 0, c: '#ffffff' }, { u: 0.5, c: '#ffe9a8' }, { u: 1, c: '#0a2214' }], dnT);
    var stripes = 8;
    for (var i = 0; i < stripes; i++) {
      var t0 = i / stripes, t1 = (i + 1) / stripes;
      var y0 = baseY + (h - baseY) * (t0 * t0), y1 = baseY + (h - baseY) * (t1 * t1);
      ctx.globalAlpha = (i % 2 === 0) ? 0.06 : 0;
      ctx.fillStyle = stripeCol;
      ctx.fillRect(0, y0, w, Math.max(1, y1 - y0));
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // drawGravelPatch (§29): fills an arbitrary polygon (the driveway wedge)
  // with a gravel texture — base tone + scattered stone-fleck flecks,
  // clipped to the given path — instead of the old flat translucent wash.
  function drawGravelPatch(ctx, pts, w, h, dnT) {
    var baseC = stopColor([{ u: 0, c: '#cbc3b2' }, { u: 0.5, c: '#a89676' }, { u: 1, c: '#332e28' }], dnT);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = baseC;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    var flecks = silhouette('gravel_flecks', w, h, 3345, 90, function (rnd) {
      return { x: rnd() * w, y: rnd() * h, r: 0.6 + rnd() * 1.1, light: rnd() < 0.5 };
    });
    ctx.globalAlpha = 0.5;
    flecks.forEach(function (f) {
      ctx.fillStyle = f.light ? '#efe8d6' : '#5a5044';
      ctx.fillRect(f.x, f.y, f.r, f.r);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // location 3 — esports mansion, gated hillside drive: sunlit green hills
  // by day, the original cool dusk at the midpoint, near-black hills with
  // bright lamp-topped gate pillars by night.
  function drawHillsGatedDrive(ctx, w, h, time, dnT) {
    ctx.save();
    var horizon = h * 0.42;
    skyGradient(ctx, w, h, horizon, {
      top:    ['#5a8fd8', '#372a56', '#161028'],
      bottom: ['#dce8f7', '#584f78', '#2a2444']
    }, dnT);
    starOverlay(ctx, w, horizon, time, dnT);
    drawSunMoon(ctx, w, horizon, dnT);

    var hills = silhouette('hills', w, h, 314, 3, function (rnd, i) {
      return { amp: 18 + rnd() * 18, phase: rnd() * 10, base: horizon - i * 2 };
    });
    var hillCols = [
      stopColor([{ u: 0, c: '#4a6b3c' }, { u: 0.5, c: '#2e2a4a' }, { u: 1, c: '#1a1730' }], dnT),
      stopColor([{ u: 0, c: '#3d5c32' }, { u: 0.5, c: '#241f3c' }, { u: 1, c: '#141227' }], dnT),
      stopColor([{ u: 0, c: '#35502c' }, { u: 0.5, c: '#1a1730' }, { u: 1, c: '#0e0c1e' }], dnT)
    ];
    hills.forEach(function (hl, i) {
      ctx.fillStyle = hillCols[i] || hillCols[0];
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      for (var x = 0; x <= w; x += 12) {
        var y = hl.base - hl.amp * (0.5 + 0.5 * Math.sin(x / 70 + hl.phase + i));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, horizon); ctx.closePath(); ctx.fill();
    });

    // §29: manicured lawn fills the ground first (the hills above were
    // floating over nothing below `horizon`), THEN the gate + gravel drive
    // sit on top of it, matching the original render order intent.
    drawLawnGround(ctx, w, h, horizon, dnT, time);

    var gateY = horizon - 2;
    var pillarW = 16, pillarH = 46, gapHalf = 48;
    var lampFactor = 0.35 + 0.65 * smoothstep(0.15, 0.75, dnT);
    [-1, 1].forEach(function (side) {
      var px = w / 2 + side * gapHalf;
      ctx.fillStyle = '#332c50';
      ctx.fillRect(px - pillarW / 2, gateY - pillarH, pillarW, pillarH);
      ctx.fillStyle = '#3d3560';
      ctx.fillRect(px - pillarW / 2 - 2, gateY - pillarH - 6, pillarW + 4, 8);
      var pulse = 0.6 + 0.4 * Math.sin(time / 480 + side * 2);
      glow(ctx, px, gateY - pillarH - 8, 26 * pulse, '#ffd54a', 0.16 * lampFactor);
    });
    // gravel driveway wedge — was a flat translucent wash with no texture;
    // now an actual gravel-flecked surface (§10/§29 "both look bad" applies
    // here too — a paved drive shouldn't read as a glass overlay).
    drawGravelPatch(ctx, [
      { x: w / 2 - 20, y: h },
      { x: w / 2 + 20, y: h },
      { x: w / 2 + 3, y: gateY },
      { x: w / 2 - 3, y: gateY }
    ], w, h, dnT);
    ctx.restore();
  }

  // drawDeckingGround (§29/§10): composite decking planks — tight, even,
  // slightly-warm horizontal board lines. Distinct from drawPavementGround's
  // looser concrete-slab grid on purpose (this is furnished outdoor decking,
  // not a public sidewalk).
  function drawDeckingGround(ctx, w, h, baseY, dnT, time) {
    var topC = stopColor([{ u: 0, c: '#9a8a76' }, { u: 0.5, c: '#8a6f5c' }, { u: 1, c: '#28242e' }], dnT);
    var botC = stopColor([{ u: 0, c: '#6e5c4a' }, { u: 0.5, c: '#5c4636' }, { u: 1, c: '#181420' }], dnT);
    ctx.save();
    drawGroundBase(ctx, w, h, baseY, topC, botC);
    var plankCol = stopColor([{ u: 0, c: '#4a3a2c' }, { u: 0.5, c: '#3a2a20' }, { u: 1, c: '#0c0810' }], dnT);
    ctx.strokeStyle = plankCol;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    var planks = 14;
    for (var i = 1; i <= planks; i++) {
      var t = i / planks;
      var y = baseY + (h - baseY) * (t * t);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // location 4 — penthouse suite, rooftop terrace above the city (§29 — NEW
  // location, previously had no backdrop of its own at all and silently
  // rendered as drawSuburbanNight via the `|| drawSuburbanNight` fallback
  // below). A hazy, low-contrast skyline glow sits BELOW the horizon line —
  // this is an elevated view looking out over the city, not up at towers —
  // with a glass terrace railing and a couple of planters grounding the
  // foreground, sitting on composite decking.
  function drawRooftopHaze(ctx, w, h, time, dnT) {
    ctx.save();
    var horizon = h * 0.40;
    skyGradient(ctx, w, h, horizon, {
      top:    ['#6fb0e8', '#4a3a6e', '#0c1130'],
      bottom: ['#dcebff', '#e08a6c', '#2a2648']
    }, dnT);
    starOverlay(ctx, w, h * 0.28, time, dnT);
    drawSunMoon(ctx, w, horizon, dnT);

    // hazy distant skyline — small, desaturated, low-alpha silhouettes
    // right at the horizon (we're ABOVE the city here, looking out over it).
    var hazeAlpha = 0.35 + 0.25 * smoothstep(0.15, 0.7, dnT);
    var towers = silhouette('haze_towers', w, h, 7112, 10, function (rnd) {
      return { tw: 16 + rnd() * 20, th: 10 + rnd() * 26, lit: rnd() < 0.5, seed: rnd() };
    });
    var hazeCol = stopColor([{ u: 0, c: '#8fa8c4' }, { u: 0.5, c: '#7a5c68' }, { u: 1, c: '#181b30' }], dnT);
    var x = -4;
    ctx.globalAlpha = hazeAlpha;
    towers.forEach(function (t) {
      ctx.fillStyle = hazeCol;
      ctx.fillRect(x, horizon - t.th, t.tw, t.th);
      x += t.tw + 3;
    });
    ctx.globalAlpha = 1;
    // warm haze glow band — the city's collective light pollution, brighter
    // once the sun's down.
    var glowFactor = 0.10 + 0.20 * smoothstep(0.2, 0.75, dnT);
    glow(ctx, w * 0.5, horizon, w * 0.6, '#ffcf8a', glowFactor);

    drawDeckingGround(ctx, w, h, horizon, dnT, time);

    // glass balustrade — thin rail + posts along the terrace edge, haze
    // glowing faintly through the glass panels.
    var railY = horizon + 8;
    var postCol = '#20263e';
    ctx.fillStyle = 'rgba(220,235,255,0.10)';
    ctx.fillRect(0, railY - 14, w, 14);
    ctx.fillStyle = postCol;
    for (var px = 6; px < w; px += 34) ctx.fillRect(px, railY - 15, 3, 16);
    ctx.fillRect(0, railY - 1, w, 2);

    // planters + a warm string-light run along the rail (reads more once
    // night comes in).
    var planters = silhouette('terrace_planters', w, h, 5540, 3, function (rnd, i) {
      return { x: w * (0.12 + i * 0.36 + rnd() * 0.06), r: 9 + rnd() * 4 };
    });
    var leafCol = stopColor([{ u: 0, c: '#4a8f4a' }, { u: 0.5, c: '#3a6a3a' }, { u: 1, c: '#12241a' }], dnT);
    planters.forEach(function (p) {
      ctx.fillStyle = '#332c2a';
      ctx.fillRect(p.x - p.r * 0.6, railY, p.r * 1.2, 8);
      ctx.fillStyle = leafCol;
      ctx.beginPath(); ctx.ellipse(p.x, railY - 2, p.r, p.r * 0.7, 0, Math.PI, 0); ctx.fill();
    });
    var lightFactor = smoothstep(0.3, 0.8, dnT);
    if (lightFactor > 0.02) {
      for (var lx = 10; lx < w; lx += 22) {
        var tw2 = 0.5 + 0.5 * Math.sin(time / 500 + lx);
        ctx.globalAlpha = lightFactor * (0.4 + 0.4 * tw2);
        ctx.fillStyle = '#ffd9a0';
        ctx.fillRect(lx, railY - 15, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // drawWaterlineGround (§29): sand meeting shallow turquoise water — a wet-
  // sand band with a scalloped wave-break edge, THEN dry sand below it. This
  // is the ground for the private island's OWN room, distinct from
  // drawSandGround (beach villa) which never touches open water directly.
  function drawWaterlineGround(ctx, w, h, baseY, dnT, time) {
    var shallowTop = stopColor([{ u: 0, c: '#4fd0d8' }, { u: 0.5, c: '#e0a86c' }, { u: 1, c: '#163c48' }], dnT);
    var shallowBot = stopColor([{ u: 0, c: '#2fa0ae' }, { u: 0.5, c: '#b87850' }, { u: 1, c: '#0e2836' }], dnT);
    var waterBandH = (h - baseY) * 0.30;
    ctx.save();
    drawGroundBase(ctx, w, h, baseY, shallowTop, shallowBot);

    // scalloped wave-break line at the sand/water edge
    var edgeY = baseY + waterBandH;
    var foamCol = stopColor([{ u: 0, c: '#eafcff' }, { u: 0.5, c: '#fff0da' }, { u: 1, c: '#284450' }], dnT);
    ctx.strokeStyle = foamCol;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var x = 0; x <= w; x += 10) {
      var wob = Math.sin(x / 26 + time / 900) * 2.2;
      if (x === 0) ctx.moveTo(x, edgeY + wob); else ctx.lineTo(x, edgeY + wob);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // dry sand below the waterline
    var sandTop = stopColor([{ u: 0, c: '#f0dfb0' }, { u: 0.5, c: '#e8b978' }, { u: 1, c: '#332c20' }], dnT);
    var sandBot = stopColor([{ u: 0, c: '#d9c68c' }, { u: 0.5, c: '#c2925a' }, { u: 1, c: '#1e170f' }], dnT);
    drawGroundBase(ctx, w, h, edgeY, sandTop, sandBot);
    var patches = silhouette('island_sand_patches', w, h, 3391, 10, function (rnd) {
      return { x: rnd() * w, y: edgeY + rnd() * rnd() * (h - edgeY), r: 14 + rnd() * 26 };
    });
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#fff6da';
    patches.forEach(function (p) {
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r, p.r * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // location 5 — private island compound, sand meeting water (§29 — NEW
  // location, previously had no backdrop and silently fell back to
  // drawSuburbanNight the same way the penthouse did). Grander/more
  // saturated take on the beach villa's palette, plus a small dock jutting
  // into the shallows to sell "private."
  function drawIslandShore(ctx, w, h, time, dnT) {
    ctx.save();
    var horizon = h * 0.36;
    skyGradient(ctx, w, h, horizon, {
      top:    ['#3f9ce0', '#3a2a68', '#0a1030'],
      bottom: ['#bdeeff', '#ff8a6c', '#1c2c4a']
    }, dnT);
    starOverlay(ctx, w, horizon, time, dnT);
    drawSunMoon(ctx, w, horizon, dnT);

    // a faint distant island silhouette on the open-water horizon
    var farCol = stopColor([{ u: 0, c: '#6fb0c8' }, { u: 0.5, c: '#3a3a5c' }, { u: 1, c: '#0e1424' }], dnT);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = farCol;
    ctx.beginPath();
    ctx.ellipse(w * 0.74, horizon - 1, 34, 6, 0, Math.PI, 0);
    ctx.fill();
    ctx.globalAlpha = 1;

    var baseY = horizon + h * 0.06;
    drawWaterlineGround(ctx, w, h, baseY, dnT, time);

    // small dock — a short walkway of planks running from the sand out into
    // the shallow water, on pilings.
    var dockY = baseY + (h - baseY) * 0.34;
    var dockCol = stopColor([{ u: 0, c: '#8a6a45' }, { u: 0.5, c: '#5c4230' }, { u: 1, c: '#221a14' }], dnT);
    ctx.fillStyle = dockCol;
    ctx.fillRect(w * 0.62, dockY, w * 0.18, 7);
    ctx.globalAlpha = 0.7;
    for (var dx = w * 0.64; dx < w * 0.78; dx += 10) ctx.fillRect(dx, dockY + 6, 2, 10);
    ctx.globalAlpha = 1;

    var palms = silhouette('island_palms', w, h, 771, 2, function (rnd, i) {
      return { hgt: 56 + rnd() * 34, lean: (rnd() - 0.5) * 0.5, px: w * (0.08 + i * 0.10) };
    });
    var palmCol = stopColor([{ u: 0, c: '#2f5a34' }, { u: 0.5, c: '#241428' }, { u: 1, c: '#0e1020' }], dnT);
    palms.forEach(function (p) {
      ctx.strokeStyle = palmCol;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(p.px, baseY + 4);
      ctx.quadraticCurveTo(p.px + p.lean * 30, baseY - p.hgt * 0.6, p.px + p.lean * 46, baseY - p.hgt);
      ctx.stroke();
      ctx.fillStyle = palmCol;
      var fx = p.px + p.lean * 46, fy = baseY - p.hgt;
      for (var fr = 0; fr < 5; fr++) {
        var ang = (fr / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(fx + Math.cos(ang) * 14, fy + Math.sin(ang) * 8 - 4, 16, 6, ang, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();
  }

  var BACKDROPS = {
    suburban_night: drawSuburbanNight,
    neon_skyline: drawNeonSkyline,
    ocean_sunset: drawOceanSunset,
    hills_gated_drive: drawHillsGatedDrive,
    rooftop_haze: drawRooftopHaze,
    island_shore: drawIslandShore
  };

  function drawBackdrop(ctx, w, h, time, backdropId, dayNightT) {
    var fn = BACKDROPS[backdropId] || drawSuburbanNight;
    fn(ctx, w, h, time, dayNightT || 0);
  }

  // ambientOverlay: a whole-canvas color grade tying the room's own lighting
  // to the backdrop's day/night state (§2: "ambient light on the room
  // itself... cooler and dimmer at night... reads as part of the scene, not
  // pasted on top"). A warm glow kisses everything at the sunset midpoint,
  // then a cool dark wash builds in toward night.
  function ambientOverlay(ctx, w, h, dnT) {
    var warm = 1 - Math.abs(dnT - 0.5) * 2;
    if (warm > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = warm * 0.14;
      ctx.fillStyle = '#ff9d5c';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    var cool = smoothstep(0.12, 1, dnT);
    if (cool > 0) {
      ctx.save();
      ctx.globalAlpha = cool * 0.40;
      ctx.fillStyle = '#0a1030';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  // drawTravelTransition(ctx, w, h, t, fromBackdropId, toBackdropId) — the
  // moving minigame's short travel beat (SPEC-V2 §7 step 4): the backdrop
  // swaps partway through while a van drives left-to-right across a road
  // strip. `t` is progress 0..1, driven by the caller's rAF loop.
  function drawVanShape(ctx, x, y, scale) {
    scale = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(5,7,16,0.35)';
    ctx.fillRect(-4, 34, 66, 6);
    ctx.fillStyle = '#e9dcc0';
    ctx.fillRect(0, 4, 58, 26);
    ctx.fillStyle = '#c9a04a';
    ctx.fillRect(0, 4, 58, 6);
    ctx.fillStyle = '#3ddc84';
    ctx.fillRect(4, 16, 38, 5);
    ctx.fillStyle = '#2a3260';
    ctx.fillRect(42, -8, 16, 16);
    ctx.fillStyle = '#34d3ff';
    ctx.fillRect(46, -5, 8, 7);
    ctx.fillStyle = '#141a30';
    ctx.beginPath(); ctx.arc(12, 32, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(45, 32, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6b7ac4';
    ctx.beginPath(); ctx.arc(12, 32, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(45, 32, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawTravelTransition(ctx, w, h, t, fromBackdropId, toBackdropId) {
    var showTo = t >= 0.5;
    // Always shown in full daylight (dayNightT 0) regardless of the actual
    // in-game phase — a short, flattering preview of the new scene, not a
    // simulation of what time it is there.
    drawBackdrop(ctx, w, h, t * 2200, showTo ? toBackdropId : fromBackdropId, 0);

    var roadY = h * 0.64;
    ctx.fillStyle = '#1c2036';
    ctx.fillRect(0, roadY, w, h - roadY);
    ctx.strokeStyle = 'rgba(234,240,255,0.5)';
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 14]);
    ctx.lineDashOffset = -t * 420;
    ctx.beginPath();
    ctx.moveTo(0, roadY + (h - roadY) * 0.5);
    ctx.lineTo(w, roadY + (h - roadY) * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    var vanX = -74 + t * (w + 148);
    drawVanShape(ctx, vanX, roadY - 34, 1.15);

    var mid = Math.abs(t - 0.5);
    if (mid < 0.07) {
      ctx.fillStyle = 'rgba(8,10,20,' + ((1 - mid / 0.07) * 0.55).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
    }
  }

  /* ---- camera ----------------------------------------------------------------
     Computes a screen offset AND a zoom `scale` so a room (which at raw 32x16
     tile size is quite small) fills most of the available canvas, regardless
     of room tier / canvas size. ------------------------------------------- */
  function computeCamera(canvasW, canvasH, roomTier) {
    var gridW = roomTier.gridW, gridD = roomTier.gridD;
    var corners = [[0, 0], [gridW, 0], [0, gridD], [gridW, gridD]];
    var minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
    corners.forEach(function (c) {
      var p = iso(c[0], c[1], 0);
      minSx = Math.min(minSx, p.sx); maxSx = Math.max(maxSx, p.sx);
      minSy = Math.min(minSy, p.sy); maxSy = Math.max(maxSy, p.sy);
    });
    var headroom = 12; // raw px above the wall top reserved for tall props/glow
    var rawW = (maxSx - minSx) || 1;
    var rawH = (maxSy - minSy) + WALL_H + headroom;

    // The room's raw footprint is wider (screen-space) than the very tall
    // portrait viewport, so width is almost always the binding constraint.
    // Let the floor's diamond side-tips bleed very slightly past the canvas
    // edge (the wrap clips overflow) so we can push scale — and therefore
    // the whole room's fill of the frame — much closer to the height bound.
    var availW = canvasW * 1.12;
    var availH = canvasH * 0.94;
    var scale = Math.min(availW / rawW, availH / rawH);
    // SPEC-V7 §2: bigger rooms must zoom out more, all the way up to 11x11.
    // The old hard floor of 1.6 clamped the fit scale UP past what an
    // 11x11 room actually needs, overflowing the canvas — the floor here
    // only guards against a truly degenerate (near-zero) canvas, it must
    // never win against the real fit computation for any room size.
    scale = Math.max(0.35, Math.min(scale, 7));

    var floorCenterX = (minSx + maxSx) / 2;
    var ox = canvasW / 2 - floorCenterX * scale;
    var topMargin = (WALL_H + headroom) * scale;
    var oy = topMargin - minSy * scale;
    var totalH = (maxSy - minSy) * scale + topMargin;
    if (totalH < canvasH) oy += (canvasH - totalH) / 2;

    // SPEC-V7 §4: raw projected bounds, exposed so hub.js's zoom/pan
    // controller can compute a clamped pan at any zoom level (not just this
    // exact fit scale) without duplicating this projection math — visualTop/
    // visualBottom are the full vertical extent (wall top + headroom down to
    // the floor's far edge), matching what oy/totalH above are framing.
    return {
      ox: ox, oy: oy, scale: scale,
      minSx: minSx, maxSx: maxSx,
      visualTop: minSy - (WALL_H + headroom), visualBottom: maxSy
    };
  }

  function screenToGrid(sx, sy, camera) {
    var scale = camera.scale || 1;
    var lx = (sx - camera.ox) / scale, ly = (sy - camera.oy) / scale;
    var gx = (lx / HW + ly / HH) / 2;
    var gy = (ly / HH - lx / HW) / 2;
    return { x: gx, y: gy };
  }

  /* ---- prop library --------------------------------------------------------
     Each prop family is 2-8 box() calls assembled around a floor anchor
     (gx, gy). Tier (0..3) scales size/detail. All colors are raw hex — this
     is canvas art, not CSS, so the "use tokens" rule doesn't apply here.

     ---- rotation (SPEC-V5 §5u) -----------------------------------------
     Every box() call inside a family is written as a LOCAL offset within
     its 1x1 anchor tile (gx+lx, gy+ly, w, d). Rotating the whole assembly by
     0/90/180/270 is exactly rotating each of those axis-aligned local rects
     around the tile's own center (0.5,0.5) — a multiple-of-90 rotation of an
     axis-aligned rect is always another axis-aligned rect, so this is a
     closed-form transform, not an approximation, and box()'s existing
     left/right/top face shading still lights it correctly (that shading only
     ever reacts to the world-space footprint it's handed, never to any
     stored notion of "which side is the front"). This is genuinely new,
     correct isometric art for every orientation — it's just generated
     geometrically instead of 4 hand-authored variants per family.

     A family opts in with one line — `var box = rotatedBoxRamp(gx, gy, rot);`
     at its own top, shadowing the outer `box` for the rest of that function
     body — every existing box(...) call below it then rotates for free with
     zero other changes. `rotatedDiamondRamp(gx, gy, rot)` is the same trick
     for families that draw with diamond() instead (flat floor pieces).

     V16: the pre-ramp wrappers rotatedBox()/rotatedDiamond() no longer have
     any callers — every family is on the ramp now — but they are kept as
     thin aliases so any code outside this file (or a half-applied patch from
     a parallel package) that still names them keeps working, and so that a
     new family cannot accidentally opt OUT of the shared art language by
     picking the older-sounding name.

     SPEC-V11-FIXES §1: EVERY family opts in now, no exceptions. This used to
     stop at desk/chair/pc/monitor — "purely decorative" families (rug,
     poster, plant, trophy, energy items, rgb, cat, bed) were left un-rotated
     on the theory that they read the same from every side. That theory was
     wrong for at least bed (a mattress has a clear head/foot end) and it
     produced the actual bug being fixed here: tapping ROTATE on a bed or any
     decor prop silently did nothing, which reads as broken, not "correct
     because symmetric." Rotating a genuinely symmetric shape (rug — a square
     diamond centered on the tile) is a geometric no-op, so opting everything
     in uniformly costs nothing for the symmetric cases and fixes the
     asymmetric ones, without needing a whitelist that can drift out of sync
     with the art again. See ROTATING_FAMILIES below — it now mirrors this:
     every family is in it, and pickProp() rotates every family's hit-anchor
     to match.
  ------------------------------------------------------------------------- */
  function rotateRect(lx, ly, w, d, rot) {
    rot = ((rot % 4) + 4) % 4;
    if (rot === 1) return { lx: 1 - ly - d, ly: lx, w: d, d: w };
    if (rot === 2) return { lx: 1 - lx - w, ly: 1 - ly - d, w: w, d: d };
    if (rot === 3) return { lx: ly, ly: 1 - lx - w, w: d, d: w };
    return { lx: lx, ly: ly, w: w, d: d };
  }
  function rotatePoint(lx, ly, rot) {
    var r = rotateRect(lx, ly, 0, 0, rot);
    return { lx: r.lx, ly: r.ly };
  }
  function rotatedBox(gx, gy, rot) {
    // V16: box() *is* boxRamp() now, so this and rotatedBoxRamp are the same
    // wrapper. Kept as an alias rather than deleted — see the note above.
    return rotatedBoxRamp(gx, gy, rot);
  }
  // rotatedBoxRamp: same wrapper as rotatedBox but draws through boxRamp()
  // (the V15 ramp) instead of box() — every V15-era family below shadows
  // its local `box` with this instead of rotatedBox.
  function rotatedBoxRamp(gx, gy, rot) {
    if (!rot) return boxRamp;
    return function (ctx, x, y, z, w, d, h, color, camera) {
      var r = rotateRect(x - gx, y - gy, w, d, rot);
      boxRamp(ctx, gx + r.lx, gy + r.ly, z, r.w, r.d, h, color, camera);
    };
  }
  // rotatedDiamond: same wrapper as rotatedBox but for diamond() — used by
  // flat floor props (rug) instead of extruded ones.
  function rotatedDiamond(gx, gy, rot) {
    if (!rot) return diamond;
    return function (ctx, x, y, z, w, d, color, camera) {
      var r = rotateRect(x - gx, y - gy, w, d, rot);
      diamond(ctx, gx + r.lx, gy + r.ly, z, r.w, r.d, color, camera);
    };
  }
  // rotatedDiamondRamp: same wrapper as rotatedDiamond but draws through
  // diamondRamp() (the V16 ramp) instead of diamond().
  function rotatedDiamondRamp(gx, gy, rot) {
    if (!rot) return diamondRamp;
    return function (ctx, x, y, z, w, d, color, camera) {
      var r = rotateRect(x - gx, y - gy, w, d, rot);
      diamondRamp(ctx, gx + r.lx, gy + r.ly, z, r.w, r.d, color, camera);
    };
  }
  // rotatedLocalPoint: for the odd prop that projects a bare point (glow
  // centers, mostly) instead of going through box()/diamond() — rotates that
  // one local offset the same way, about the same tile center, so a glow
  // stays glued to the geometry it's supposed to be sitting on/inside once
  // that geometry itself rotates.
  function rotatedLocalPoint(gx, gy, ax, ay, rot) {
    // ax/ay are absolute world coords (e.g. gx + 0.9), matching how project()
    // is normally called — converted to tile-local, rotated, converted back.
    if (!rot) return { x: ax, y: ay };
    var r = rotatePoint(ax - gx, ay - gy, rot);
    return { x: gx + r.lx, y: gy + r.ly };
  }

  // detailPt — project a prop-local world point through the SAME rotation and
  // the SAME chub() vertical squash that rotatedBoxRamp applies to the prop's
  // cuboids. Every piece of 1px line art added in V16 (seams, spine dots,
  // magnets, tufting, grease spots) goes through this, so details can never
  // drift off the geometry they are drawn onto at rot 1/2/3.
  function detailPt(gx, gy, rot, camera, ax, ay, az) {
    var p = rotatedLocalPoint(gx, gy, ax, ay, rot);
    return project(p.x, p.y, az * VSCALE, camera);
  }
  // detailer(...) — curried detailPt for a given prop instance.
  function detailer(gx, gy, rot, camera) {
    return function (ax, ay, az) { return detailPt(gx, gy, rot, camera, ax, ay, az); };
  }

  /* ---- SPEC-V17 §4 — FACE CULLING FOR DETAIL LINE ART ---------------------
     detailPt()/detailer() fixed WHERE a detail lands after rotation, but not
     WHETHER it should be drawn at all. Detail line art (fridge doors, PC front
     panels, monitor screens, desk drawers, seams, magnets) is authored on one
     specific face of the prop's local tile. In this projection a cuboid only
     ever paints two vertical faces — boxRamp's `left` poly is the face at
     max-local-y and its `right` poly the face at max-local-x. The other two
     are behind the solid body and are never drawn.

     Details, however, are painted AFTER the body, with no depth buffer. So a
     detail authored on the front face is still painted at rotations where that
     face has swung round the back — straight over the top of the body that
     should be hiding it. That is the owner's bug verbatim: "rotate a fridge to
     the side and you can see its door through its side and back walls."

     Naming: 'y+' is the authored front (max local y, the face pointing at the
     camera at rot 0), 'x+' the authored right side, 'y-'/'x-' their opposites.
     rotateRect() permutes local faces onto world faces like so:

       local face | world face at rot 0 / 1 / 2 / 3 | drawn at rot
       -----------+--------------------------------+--------------
       y+ (front) | y+   x-   y-   x+              | 0, 3
       x+ (right) | x+   y+   x-   y-              | 0, 1
       y- (back)  | y-   x+   y+   x-              | 1, 2
       x- (left)  | x-   y-   x+   y+              | 2, 3

     Top-face detail (z at the top of a box) is visible at every rotation and
     needs no gate. -------------------------------------------------------- */
  function faceVisible(face, rot) {
    rot = (((rot | 0) % 4) + 4) % 4;
    if (face === 'x+') return rot === 0 || rot === 1;
    if (face === 'y-') return rot === 1 || rot === 2;
    if (face === 'x-') return rot === 2 || rot === 3;
    return rot === 0 || rot === 3; // 'y+' — the authored front
  }
  // faces(rot) -> { front, right, back, left } booleans. Families with more
  // than one gated detail block read better through this than through four
  // separate faceVisible() calls. front = 'y+', right = 'x+'.
  function faces(rot) {
    return {
      front: faceVisible('y+', rot),
      right: faceVisible('x+', rot),
      back: faceVisible('y-', rot),
      left: faceVisible('x-', rot)
    };
  }
  // faceY(rot, yFront, yBack) — for the handful of details that belong to a
  // body which genuinely looks the same from both y-faces (a fan cage, an
  // indicator lamp). Rather than vanishing at rot 1/2 they hop to the local
  // face that IS camera-facing, so the detail keeps sitting on solid
  // geometry instead of floating a few px off it. Only use this where the
  // two faces are interchangeable — a fridge door is not.
  function faceY(rot, yFront, yBack) {
    return faceVisible('y+', rot) ? yFront : yBack;
  }
  function pixRect(ctx, p, dx, dy, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(p.x + dx, p.y + dy, w, h);
  }

  var props = {};

  // DESK_TOP_Z (SPEC-V6 §10 — rewritten): the world-Z of the desk's actual
  // tabletop surface. props.monitor reads this same constant so a monitor
  // always sits physically ON the desk instead of the two being independent
  // floor props that happen to occupy the same tile — which is what made the
  // old monitor read as a giant unrelated slab planted in the floor next to
  // a desk it visually had nothing to do with.
  var DESK_TOP_Z = 15;

  // DESK (V16 Package P4 — ART-DIRECTION §2.2). Was on the old box() path,
  // 4 tiers sharing IDENTICAL geometry with only the palette swapped — the
  // exact PC-family defect the brief calls out by name. Now drawn through
  // rotatedBoxRamp (shared V16 outline+ramp) AND each tier grows its own
  // footprint/leg-count/add-on silhouette: plain sawhorse legs -> flatpack
  // w/ drawer -> gaming w/ RGB strip + cable tray -> battlestation w/ a
  // raised monitor-riser shelf on top. topH/apronH/legH stay CONSTANT across
  // tiers on purpose — DESK_TOP_Z is a fixed world-Z that props.monitor
  // anchors to, so the tabletop surface must land at the same height on
  // every tier no matter how the footprint or legs change.
  props.desk = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var P = detailer(gx, gy, rot, camera);
    var F = faces(rot); // SPEC-V17 §4 — see faceVisible() above
    var topPal = ['#8a6a45', '#5f6fae', '#333a5c', '#1c2440'];
    var legPal = ['#4a3826', '#262c48', '#171b30', '#0d1020'];
    var top = topPal[tier] || topPal[0];
    var leg = legPal[tier] || legPal[2];
    var topH = 2.5, apronH = 1.8;
    var legH = DESK_TOP_Z - topH - apronH;
    // footprint grows tier over tier — the single biggest legibility fix
    // (a color-only swap is invisible at icon scale; a bigger, busier desk
    // reads as "better" even before the add-ons register).
    /* V22b (owner item 4): "the plywood desk is a little too small, some
       monitors look like half of their stand is floating."

       Measured rather than eyeballed, and it was a DEPTH problem, not a width
       one. props.monitor puts its foot plate at local y 0.60..0.70. A desk's
       top spans `oy .. oy + d` where `oy = 0.90 - d`, so the back edge sits at
       0.90 - d:
         tier 0, d 0.24 -> back edge 0.66. The stand's rear 0.06 overhangs
                           into thin air — exactly what the owner saw.
         tier 1, d 0.30 -> back edge 0.60. Flush to the millimetre, i.e. one
                           rounding error from the same defect.
       Every depth is now >= 0.32, so the top reaches 0.58 or further back and
       the whole foot plate lands on timber at every tier.

       The ceiling is 0.40: the PC tower stands in the tile's back half and
       ends at y 0.46 (see props.pc), so a desk deeper than 0.40 would put its
       back edge at 0.50 and start intersecting the tower — the overlap item 4
       of the previous list existed to remove. 0.32..0.40 is the whole legal
       window and these four values sit inside it.

       Widths grow with it so the desks stay proportioned rather than becoming
       deep narrow planks, and both series stay strictly monotonic so the tier
       ladder still reads as an upgrade at a glance. */
    var w = [0.80, 0.88, 0.96, 1.02][tier] || 0.80;
    var d = [0.32, 0.34, 0.38, 0.40][tier] || 0.32;
    var legT = [0.06, 0.08, 0.09, 0.10][tier] || 0.06;
    var ox = gx + 0.03, oy = gy + 0.90 - d;
    var frontY = oy + d;

    if (tier === 0) {
      // PLYWOOD: bare legs run floor-to-tabletop with no apron skirt tying
      // them together — reads as the cheapest possible desk.
      box(ctx, ox + w * 0.06, oy + d * 0.15, 0, legT, legT, legH + apronH, leg, camera);
      box(ctx, ox + w - legT - w * 0.06, oy + d * 0.15, 0, legT, legT, legH + apronH, leg, camera);
      box(ctx, ox + w * 0.06, oy + d * 0.72, 0, legT, legT, legH + apronH, leg, camera);
      box(ctx, ox + w - legT - w * 0.06, oy + d * 0.72, 0, legT, legT, legH + apronH, leg, camera);
    } else {
      box(ctx, ox + w * 0.06, oy + d * 0.15, 0, legT, legT, legH, leg, camera);
      box(ctx, ox + w - legT - w * 0.06, oy + d * 0.15, 0, legT, legT, legH, leg, camera);
      box(ctx, ox + w * 0.06, oy + d * 0.72, 0, legT, legT, legH, leg, camera);
      box(ctx, ox + w - legT - w * 0.06, oy + d * 0.72, 0, legT, legT, legH, leg, camera);
      // apron: a shallow skirt band that visually ties the 4 legs to the
      // tabletop — tier 0 skips this on purpose (see above).
      box(ctx, ox, oy, legH, w, d, apronH, mulColor(top, 0.55), camera);
    }
    // tabletop — always topH tall, always ending at DESK_TOP_Z.
    box(ctx, ox, oy, DESK_TOP_Z - topH, w, d, topH, top, camera);

    // ---- V19 §2 — delicate pass on the desk -----------------------------
    // Nothing louder, nothing new in the silhouette: the desk is the most
    // seen prop in the room, so it gets made better, not bigger. Three 1px
    // details, all on the tabletop, all through the existing ramp's own
    // tints via shade() so no second ramp is introduced:
    //  (a) a lighter chamfer along the two camera-facing top edges, which is
    //      what stops the tabletop reading as a printed rectangle;
    //  (b) a darker seam one pixel under the front edge, so the top has a
    //      visible THICKNESS instead of a painted-on border;
    //  (c) grain on the two wood tiers only — the laminate/glass tiers stay
    //      clean, which is itself a tier cue.
    crispStroke(ctx, [P(ox, oy, DESK_TOP_Z), P(ox, oy + d, DESK_TOP_Z)], shade(top, 0.30), false);
    crispStroke(ctx, [P(ox, oy + d, DESK_TOP_Z), P(ox + w, oy + d, DESK_TOP_Z)], shade(top, 0.30), false);
    crispStroke(ctx, [P(ox, oy + d, DESK_TOP_Z - 1), P(ox + w, oy + d, DESK_TOP_Z - 1)], shade(top, -0.28), false);
    if (tier <= 1) {
      for (var gi = 0; gi < 3; gi++) {
        crispStroke(ctx, [
          P(ox + w * 0.06, oy + d * (0.26 + gi * 0.24), DESK_TOP_Z),
          P(ox + w * 0.94, oy + d * (0.26 + gi * 0.24), DESK_TOP_Z)
        ], shade(top, -0.16), false);
      }
    }
    // metal foot caps: 1px of light under each leg, which lifts the desk off
    // the floor plane instead of letting the legs dissolve into it.
    var capZ = 0.5;
    crispStroke(ctx, [P(ox + w * 0.06, oy + d * 0.15 + legT, capZ), P(ox + w * 0.06 + legT, oy + d * 0.15 + legT, capZ)], '#8A93A8', false);
    crispStroke(ctx, [P(ox + w - legT - w * 0.06, oy + d * 0.15 + legT, capZ), P(ox + w - w * 0.06, oy + d * 0.15 + legT, capZ)], '#8A93A8', false);

    if (tier === 1) {
      /* FLATPACK (owner report): this used to hang a drawer unit under the
         tabletop — a w*0.30 x d*0.76 x legH*0.75 block in mulColor(top, 0.65).
         At that size it was not a detail on the desk, it was a second object
         beside it, and off tier 1's blue-grey top the tint landed somewhere
         near grey. The owner read it as "some kind of grey box attached to the
         desk", which is exactly what it was.

         Replaced with a MODESTY PANEL: a thin sheet spanning the back edge
         between the legs. That is a real flatpack-desk feature and, unlike the
         drawer, it lives INSIDE the desk's own footprint — 0.03 deep against
         the back edge, so it can never read as a separate volume from any
         angle. It still gives tier 1 the "assembled furniture" cue that tier
         0's bare sawhorse lacks, which is the job the drawer was there to do.

         mulColor(top, 0.72) keeps it plainly the same material as the
         tabletop, one step darker for the shaded inner face — not a new
         colour, and never grey. */
      box(ctx, ox + w * 0.06, oy + d * 0.10, legH * 0.28, w * 0.88, 0.03, legH * 0.58, mulColor(top, 0.72), camera);
    }
    if (tier >= 2) {
      // RGB underglow strip along the front apron face — front-face only
      if (F.front) box(ctx, ox + w * 0.06, frontY - 0.01, legH + 0.3, w * 0.86, 0.03, apronH * 0.6, '#8847ff', camera);
      // Cable tray. It used to be pinned at gy+0.15 while the desk body sits
      // at gy+0.54..0.62 — a 0.4-tile gap, so it rendered as a detached black
      // wall lying on the floor beside the desk at every rotation. It is a
      // cable tray: it belongs slung UNDER the tabletop, against the back
      // edge of the desk's own footprint.
      box(ctx, ox + w * 0.10, oy + d * 0.06, legH * 0.42, w * 0.80, d * 0.16, 2.2, '#12162a', camera);
    }
    if (tier >= 3) {
      // BATTLESTATION: a raised monitor-riser shelf on the tabletop's back
      // edge, with its own thin RGB trim — the silhouette a battlestation
      // is known for and none of the lower tiers have.
      box(ctx, ox + w * 0.10, oy, DESK_TOP_Z, w * 0.60, d * 0.45, 1.6, mulColor(top, 1.2), camera);
      box(ctx, ox + w * 0.10, oy, DESK_TOP_Z + 1.6, w * 0.60, 0.03, 0.5, '#ff6bd6', camera);
    }
  };

  // PC TOWER (SPEC-V15-BATCH-C §4 fix). The old tower was a 0.13x0.15 sliver
  // positioned at the tile's edge — at 56x56 icon scale it measured ~57
  // non-transparent px above baseline, and IDENTICALLY across all four
  // tiers, because only its accent color changed between tiers, never its
  // geometry (a color swap can't move the pixel-alpha count). Every tier
  // below now owns its own case size AND its own silhouette feature —
  // plain case -> glass panel -> AIO radiator -> hue-cycling dual RGB —
  // so budget->elite reads as an obvious upgrade path at icon scale and
  // in-room alike, through the shared Iso.boxRamp/rampShade ramp (do not
  // add a second ramp — ART-DIRECTION.md §2.2 / SPEC-V15-BATCH-A §10).
  props.pc = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var F = faces(rot); // SPEC-V17 §4 — see faceVisible() above
    var P = detailer(gx, gy, rot, camera);
    // ---- V19 §2 — PROPORTIONS -------------------------------------------
    // Owner defect: the rigs were "big dark boxes the size of a fridge".
    // They were, literally. This world's scale is fixed by two constants:
    // 16 z-units = 1 world unit (a w=d=1, h=16 box renders as a cube), and
    // DESK_TOP_Z = 15, i.e. a 75cm desk. So 1 z-unit = 5cm and 1 world unit
    // = 80cm. The old towers were h 23..33 = 115cm..165cm tall and 0.37..0.46
    // = 30cm..37cm wide — taller than the desk they stand next to and wider
    // than a chair seat. That is a refrigerator.
    // Real cases, re-measured: mATX 42cm, mid-tower 50cm, high-airflow 57cm,
    // full tower 65cm; all 18..22cm wide and 40..44cm deep. Below, in
    // z-units and world units, that is h 8.4..13, w 0.22..0.27, d 0.50..0.55
    // — every tier now clearly shorter than DESK_TOP_Z, so a tower reads as
    // sitting BESIDE or UNDER the desk. Tiers stay distinct on all three
    // axes plus their per-tier silhouette features (do not regress the
    // SPEC-V15-BATCH-C §4 fix).
    // NOTE on the footprint numbers: this world does NOT use one uniform
    // scale. Heights are near-literal (DESK_TOP_Z 15 = a 75cm desk, so 1
    // z-unit = 5cm) but footprints are drawn compressed so props sit inside
    // their tile — the desk itself is only 0.24..0.40 deep for a 60cm-deep
    // desk. So the case footprint is matched to the DESK's convention, not
    // to centimetres, and the heights are matched to the desk's. The result
    // is a silhouette taller than it is wide: an upright tower.
    var w = [0.16, 0.17, 0.18, 0.19][tier] || 0.16;
    var d = [0.30, 0.32, 0.34, 0.36][tier] || 0.30;
    var h = [9, 10.5, 12, 13.5][tier] || 9;
    // Palette: the old one topped out at #14172c, which at 1:1 is a hole in
    // the floor. Every tier is lifted into readable graphite/steel and each
    // owns a different metal, so tier is legible from hue as well as size.
    var CASE_MAT = [
      { top: '#6A7186', left: '#525A70', right: '#373D4E', accent: '#9AA3B8' }, // 0 steel grey
      { top: '#5E6A94', left: '#47527A', right: '#2F3754', accent: '#93A0C8' }, // 1 gunmetal blue
      { top: '#4E7B8E', left: '#3A6173', right: '#26404E', accent: '#87B4C6' }, // 2 anodised teal
      { top: '#4A4460', left: '#37324A', right: '#241F33', accent: '#8C82AE' }  // 3 black chrome
    ][tier] || { top: '#6A7186', left: '#525A70', right: '#373D4E', accent: '#9AA3B8' };
    var ventCol =  ['#252A38', '#1F2434', '#1B2530', '#191624'][tier] || '#252A38';
    var glassCol = ['#414a63', '#3E5F91', '#2F6D8E', '#3B3170'][tier] || '#414a63';
    var accent =   ['#4b69ff', '#34d3ff', '#3ddc84', '#ff8a1f'][tier] || '#4b69ff';
    /* V22 (owner item 4) — WHERE THE TOWER STANDS ON A SHARED DESK TILE.

       This used to be `oy = gy + 0.56 - d/2`, i.e. y 0.41..0.71 at tier 0.
       Every desk tier occupies the FRONT of the tile — props.desk uses
       `oy = gy + 0.90 - d`, so its back edge sits at y 0.50 (tier 3, the
       deepest) through y 0.66 (tier 0). The tower's old span therefore ran
       straight THROUGH the desk, which is what produced the overlap the owner
       reported at almost every rotation.

       The tile is now split front/back: the desk owns the front half, the
       tower stands in the back half. 0.10 + the deepest case (0.36) = 0.46,
       which clears even the deepest desk's 0.50 back edge with room to spare.
       Both halves are LOCAL coordinates and a workstation rotates as a group
       (State.moveGroup shares one rot across desk/pc/monitor), so the split
       holds at all four rotations rather than only the one it was checked at.

       Kept centred in x so the tower still reads as part of the workstation
       rather than shoved into a corner. CATEGORY_ORDER puts `pc` behind the
       desk and monitor, so the two never fight for the same pixels. */
    var ox = gx + 0.5 - w / 2;
    var oy = gy + 0.10;
    var frontY = oy + d;   // the left/front face's plane (rampShade's ×1.00 face)
    var rightX = ox + w;   // the right face's plane (rampShade's ×0.70 face)
    var vi;

    // rubber feet — a 0.7-unit lift under the case. Small, but it is the
    // difference between "a case standing on the floor" and "a block sunk
    // into it", and it is what makes the silhouette read as sleek.
    box(ctx, ox + w * 0.10, oy + d * 0.08, 0, w * 0.80, d * 0.12, 0.7, '#151824', camera);
    box(ctx, ox + w * 0.10, oy + d * 0.80, 0, w * 0.80, d * 0.12, 0.7, '#151824', camera);

    // case body, through the V15 ramp
    box(ctx, ox, oy, 0.7, w, d, h, CASE_MAT, camera);

    // ---- front panel ----------------------------------------------------
    // A recessed mesh intake occupying the lower two-thirds, a fine 1px
    // perforation pattern over it, and a real front I/O cluster. SPEC-V17 §4:
    // all of it is skinned onto the front face and must be culled at rot 1/2.
    if (F.front) {
      box(ctx, ox + w * 0.12, frontY - 0.012, 1.4, w * 0.76, 0.03, h * 0.62, ventCol, camera);
      for (vi = 0; vi < 5; vi++) {
        crispStroke(ctx, [
          P(ox + w * 0.16, frontY, 2.2 + vi * (h * 0.56 / 5)),
          P(ox + w * 0.84, frontY, 2.2 + vi * (h * 0.56 / 5))
        ], '#454E63', false);
      }
      // Front I/O: a lit power button plus two ports. Positioned in WORLD
      // coordinates, one P() call each — an earlier version placed them with
      // screen-space dx offsets from a single point, which at rot 3 threw
      // them clean off the silhouette and left a floating "T" beside the
      // case. Never offset a detail in screen px along an axis the rotation
      // can flip.
      pixRect(ctx, P(ox + w * 0.30, frontY, 0.7 + h * 0.88), -1, -1, 2, 2, accent);
      pixRect(ctx, P(ox + w * 0.58, frontY, 0.7 + h * 0.90), 0, 0, 2, 1, '#9AA3B8');
      pixRect(ctx, P(ox + w * 0.58, frontY, 0.7 + h * 0.84), 0, 0, 2, 1, '#9AA3B8');
      // top-edge chamfer highlight along the front face
      crispStroke(ctx, [P(ox, frontY, 0.7 + h), P(ox + w, frontY, 0.7 + h)], CASE_MAT.accent, false);
    } else {
      // The BACK of the case. Previously a blank painted slab at rot 1/2,
      // which is half the rotations. A real rear panel is cheap and it is
      // exactly what makes the tower still read as a PC from behind: a
      // motherboard I/O shield, a PSU cutout and expansion-slot covers.
      var backY = oy;
      box(ctx, ox + w * 0.14, backY - 0.012, 0.7 + h * 0.66, w * 0.70, 0.03, h * 0.24, '#1A1F30', camera);
      box(ctx, ox + w * 0.12, backY - 0.012, 1.2, w * 0.76, 0.03, h * 0.20, ventCol, camera);
      for (vi = 0; vi < 3; vi++) {
        crispStroke(ctx, [
          P(ox + w * 0.30, backY, 0.7 + h * 0.34 + vi * 1.3),
          P(ox + w * 0.88, backY, 0.7 + h * 0.34 + vi * 1.3)
        ], '#3A425A', false);
      }
      crispStroke(ctx, [P(ox, backY, 0.7 + h), P(ox + w, backY, 0.7 + h)], CASE_MAT.accent, false);
    }

    if (tier >= 1) {
      // tempered glass side panel on the right face, inset with a visible
      // frame margin so it reads as a PANEL and not as a repaint of the
      // whole side. Right-face only (rot 0/1).
      if (F.right) {
        box(ctx, rightX - 0.012, oy + d * 0.10, 1.4 + h * 0.10, 0.03, d * 0.80, h * 0.74, glassCol, camera);
        // what you see THROUGH the glass: a horizontal GPU slab and a small
        // vertical cooler tower. Two shapes, and the rig stops being a slab.
        box(ctx, rightX - 0.02, oy + d * 0.16, 1.4 + h * 0.22, 0.02, d * 0.60, h * 0.16, '#1A1F30', camera);
        box(ctx, rightX - 0.02, oy + d * 0.52, 1.4 + h * 0.44, 0.02, d * 0.24, h * 0.30, '#2A3145', camera);
        // 2px specular streak on the glass, top-left — the standard cue for
        // "this is a reflective surface" on a pixel grid.
        pixRect(ctx, P(rightX, oy + d * 0.74, 1.4 + h * 0.78), -1, 0, 1, 3, 'rgba(255,255,255,0.45)');
      }
      // steady accent strip down the front edge. Not hue-cycling — that's
      // reserved for elite (tier 3), so a glance separates the top tier
      // from mid/watercooled even before case size registers.
      if (F.front) box(ctx, ox + w * 0.03, frontY - 0.014, 1.4, w * 0.07, 0.035, h * 0.80, accent, camera);
    } else {
      // budget: one steady LED bar, dim single color, no glass, no glow —
      // clearly a lesser rig than the tiers above it.
      if (F.front) box(ctx, ox + w * 0.04, frontY - 0.014, 1.4, w * 0.09, 0.035, h * 0.45, accent, camera);
    }

    if (tier >= 2) {
      // AIO radiator, top-mounted — the watercooled/elite silhouette cue,
      // overhanging the case footprint slightly so it reads as a separate
      // part rather than a taller case.
      box(ctx, ox - 0.012, oy - 0.012, 0.7 + h, w + 0.024, d + 0.024, 1.5, ventCol, camera);
      var pulse = 0.5 + 0.5 * Math.sin((time || 0) / 260 + gx + gy);
      box(ctx, ox + w * 0.15, oy + d * 0.18, 0.7 + h + 1.5, w * 0.70, d * 0.64, 0.9, mulColor('#34d3ff', 0.75 + 0.35 * pulse), camera);
      // two 1px fan-hub dots on the radiator top face — visible at every rot
      pixRect(ctx, P(ox + w * 0.5, oy + d * 0.34, 0.7 + h + 2.4), -1, -1, 2, 2, '#0E1420');
      pixRect(ctx, P(ox + w * 0.5, oy + d * 0.68, 0.7 + h + 2.4), -1, -1, 2, 2, '#0E1420');
    }

    if (tier >= 3) {
      // elite: hue-cycling RGB — the front strip re-drawn on top of tier 1's
      // steady one, plus a second hue-shifted trim along the glass panel's
      // top edge. The only tier whose color visibly animates over time.
      var hue = ((time || 0) / 18 + (gx + gy) * 55) % 360;
      if (F.front) box(ctx, ox + w * 0.03, frontY - 0.014, 1.4, w * 0.07, 0.035, h * 0.80, hslToHex(hue, 88, 62), camera);
      if (F.right) box(ctx, rightX - 0.014, oy + d * 0.08, 0.7 + h + 2.6, 0.035, d * 0.84, 0.7, hslToHex((hue + 120) % 360, 85, 60), camera);
    }
    // NOTE: the monitor used to be drawn here as part of the PC. SPEC-V5 §5r
    // gave it its own real shop category/prop (props.monitor below) — a PC
    // no longer draws a screen of its own at all.
  };

  // Monitor (SPEC-V6 §10 — rewritten). Previously a fixed floor-to-~23-tall
  // slab with no bezel definition, so it read as a giant unbroken cyan card
  // planted in the floor rather than a screen. Now it's stand + bezel/frame
  // + inset glow, physically mounted on DESK_TOP_Z (the desk's own tabletop
  // constant above) and centered toward the BACK of the desk's footprint so
  // the tabletop's front edge stays visible in front of it. hub.js's
  // placement rule (js/hub.js tileValid()) is what guarantees a desk is
  // always present under a monitor now, so anchoring to DESK_TOP_Z is safe.
  // MONITOR (V16 Package P4). Was on the old box() path, 3 tiers sharing one
  // bezel size with only the glow color swapped. Now the panel itself grows
  // (basic -> 144hz -> 240 OLED), the basic tier is a single flat screen,
  // 144hz adds a second (dual-monitor) panel, and the OLED tier goes
  // ultrawide with a curved-screen taper plus RGB trim on both edges — a
  // visibly different rig at a glance, not just a different tint.
  props.monitor = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var P = detailer(gx, gy, rot, camera);
    var F = faces(rot); // SPEC-V17 §4 — see faceVisible() above
    var glowPal = ['#34d3ff', '#3ddc84', '#ff6bd6'];
    var glowCol = glowPal[tier] || glowPal[0];
    var standH = 3;
    var bezelW = [0.40, 0.44, 0.54][tier] || 0.40;
    var bezelH = [9, 11, 12.5][tier] || 9;
    var neckZ = DESK_TOP_Z + 0.8;
    var frameZ = neckZ + standH;
    var flicker = 0.85 + 0.15 * Math.sin((time || 0) / 180 + gx * 3);
    var bx0 = gx + 0.30 - bezelW / 2 + 0.16;
    var mi;
    // ---- V19 §2 — delicate pass on the monitor --------------------------
    // The chassis was one flat #151a2c on every surface, which made the
    // frame read as a hole rather than as a moulded plastic housing. It is
    // now a proper 3-tone material through the SAME ramp (no second ramp),
    // and the stand gets a wider, thinner foot — the single change that most
    // makes a monitor look like a monitor rather than a sign on a post.
    var CHASSIS = { top: '#3A4160', left: '#252B44', right: '#151A2C', accent: '#5E688C' };
    var STAND = { top: '#2E3550', left: '#1E2439', right: '#131725', accent: '#4C5578' };

    box(ctx, gx + 0.40, gy + 0.60, DESK_TOP_Z, 0.18, 0.10, 0.6, STAND, camera);      // wide thin foot plate on the desk
    box(ctx, gx + 0.47, gy + 0.635, DESK_TOP_Z + 0.6, 0.04, 0.03, standH + 0.2, STAND, camera); // neck
    box(ctx, bx0, gy + 0.60, frameZ, bezelW, 0.045, bezelH, CHASSIS, camera);        // bezel/frame
    // SPEC-V17 §4: the lit panel lives on the bezel's front face. At rot 1/2
    // you are looking at the BACK of the monitor — the glow must not be
    // painted through the frame.
    if (F.front) {
      box(ctx, bx0 + 0.02, gy + 0.605, frameZ + 1.2, bezelW - 0.08, 0.02, bezelH - 2.4, shade(glowCol, flicker - 1.15), camera); // screen glow, inset within the frame
      // 1px dark inner-bezel line boxing the panel, so the screen sits INSIDE
      // the frame instead of being flush-printed onto it
      var s0 = P(bx0 + 0.02, gy + 0.605, frameZ + 1.2), s1 = P(bx0 + bezelW - 0.06, gy + 0.605, frameZ + 1.2);
      var s2 = P(bx0 + bezelW - 0.06, gy + 0.605, frameZ + bezelH - 1.2), s3 = P(bx0 + 0.02, gy + 0.605, frameZ + bezelH - 1.2);
      crispStroke(ctx, [s0, s1, s2, s3], '#0B0E1A', true);
      // the panel is brighter at the top and falls off toward the bottom —
      // two extra 1px bands, not a gradient, which is how a backlit LCD
      // reads on a pixel grid
      for (mi = 0; mi < 2; mi++) {
        crispStroke(ctx, [
          P(bx0 + 0.03, gy + 0.6, frameZ + bezelH - 2.0 - mi),
          P(bx0 + bezelW - 0.07, gy + 0.6, frameZ + bezelH - 2.0 - mi)
        ], shade(glowCol, 0.30 - mi * 0.12), false);
      }
      // power LED under the bottom bezel, and a 1px specular on the frame's
      // top-left corner
      pixRect(ctx, P(bx0 + bezelW * 0.5, gy + 0.6, frameZ + 0.6), 0, 0, 1, 1, glowCol);
      crispStroke(ctx, [P(bx0, gy + 0.6, frameZ + bezelH), P(bx0 + bezelW, gy + 0.6, frameZ + bezelH)], CHASSIS.accent, false);
    } else {
      // Looking at the BACK of the monitor. Previously this was a blank dark
      // slab — the "renders poorly from back angles" complaint. A real
      // monitor rear has a VESA plate and a vent grid, and both are cheap:
      var by = gy + 0.60;
      box(ctx, bx0 + bezelW * 0.32, by - 0.012, frameZ + bezelH * 0.30, bezelW * 0.36, 0.03, bezelH * 0.34, STAND, camera);
      for (mi = 0; mi < 5; mi++) {
        crispStroke(ctx, [
          P(bx0 + bezelW * 0.10, by, frameZ + bezelH * 0.70 + mi * 1.2),
          P(bx0 + bezelW * 0.90, by, frameZ + bezelH * 0.70 + mi * 1.2)
        ], '#10141F', false);
      }
      crispStroke(ctx, [P(bx0, by, frameZ + bezelH), P(bx0 + bezelW, by, frameZ + bezelH)], CHASSIS.accent, false);
    }

    if (tier === 1) {
      // 144HZ: a smaller second panel beside the main one — dual-monitor
      // setup, the clearest "more than basic" cue at icon scale.
      box(ctx, gx + 0.70, gy + 0.63, frameZ + 1.2, 0.24, 0.04, bezelH * 0.72, '#151a2c', camera);
      if (F.front) box(ctx, gx + 0.715, gy + 0.635, frameZ + 2.2, 0.19, 0.018, bezelH * 0.72 - 2, shade(glowCol, flicker - 1.2), camera);
      // thin RGB top trim — anchored to bx0 (it used to use a hardcoded x
      // that no longer matched the bezel) and flush on the bezel top, no gap
      box(ctx, bx0, gy + 0.593, frameZ + bezelH, bezelW, 0.03, 0.9, shade(glowCol, 0.2), camera);
    }
    if (tier >= 2) {
      // 240 OLED: ultrawide curved panel — extra width plus a taper cut on
      // each outer edge to read as "curved" in flat iso shading, and RGB
      // trim running down both side edges instead of just the top.
      // Top trim is a real bar sitting ON the bezel, so it stays at every
      // rotation. The two edge strips are skinned onto the FRONT face and
      // must be culled at rot 1/2, and the old "curved accent overhang" bar
      // floated 1.3 units above the bezel attached to nothing — from behind
      // it read as loose pink specks in mid-air. It now sits flush on the
      // top trim instead of hovering over it.
      // ONE trim bar, sitting directly on the bezel and overhanging it on
      // both sides — that overhang is the ultrawide cue. The previous version
      // also floated a second accent bar 1.3 units above the panel, attached
      // to nothing; at rot 1/2 it detached completely and read as loose pink
      // specks hanging in the air above the monitor. Deleted, not moved.
      box(ctx, bx0 - 0.03, gy + 0.593, frameZ + bezelH, bezelW + 0.06, 0.03, 1.1, shade(glowCol, 0.2), camera);
      if (F.front) {
        box(ctx, bx0 - 0.005, gy + 0.60, frameZ, 0.02, 0.045, bezelH, glowCol, camera);            // left edge RGB
        box(ctx, bx0 + bezelW - 0.005, gy + 0.60, frameZ, 0.02, 0.045, bezelH, glowCol, camera);   // right edge RGB
      }
    }
  };

  // CHAIR (V16 Package P4). Was on the old box() path, 3 tiers sharing one
  // seat/backrest shape with only the color swapped. Now each tier owns its
  // own silhouette: plain wooden stool -> gaming chair w/ armrests and a
  // taller backrest -> pro esports chair w/ headrest wing, lumbar bar and a
  // 5-star base instead of a single leg post.
  // V16 §2.2 — CHAIRS. Every tier gets its own variation, and all three now
  // share the same construction vocabulary: cushions are built from THREE
  // stacked slabs (narrow / wide / narrow) so the silhouette steps in at the
  // corners instead of being a hard 90° cube — that stepped chamfer is how
  // you draw a plush rounded cushion on a pixel grid. Backrests carry a grid
  // of 1px dark tufting dots, and the two wheeled tiers stand on a real
  // 5-point metallic caster base with 2x2px wheel sprites.
  var CASTER = { top: '#B8C0D2', left: '#8A93A8', right: '#5E6678', accent: '#E6EBF5' };
  var WHEEL_DARK = '#1B1F2E';

  // plushSlab — a cushion drawn as a stepped 3-layer stack. Reads rounded at
  // 1:1 without a single antialiased pixel.
  function plushSlab(box, ctx, x, y, z, w, d, h, mat, camera) {
    var s = 0.035;
    box(ctx, x + s, y + s, z, w - s * 2, d - s * 2, h * 0.22, mat, camera);
    box(ctx, x, y, z + h * 0.22, w, d, h * 0.56, mat, camera);
    box(ctx, x + s, y + s, z + h * 0.78, w - s * 2, d - s * 2, h * 0.22, mat, camera);
  }

  // tufting — the grid of 1px shadow dots that makes upholstery read as
  // stitched rather than painted. Drawn in a darker tint of the fabric.
  function tufting(ctx, P, x0, y, z0, w, h, cols, rows, col) {
    for (var c = 0; c < cols; c++) {
      for (var r = 0; r < rows; r++) {
        var p = P(x0 + w * (0.22 + 0.56 * (cols === 1 ? 0.5 : c / (cols - 1))),
                  y, z0 + h * (0.22 + 0.56 * (rows === 1 ? 0.5 : r / (rows - 1))));
        pixRect(ctx, p, 0, 0, 1, 1, col);
        pixRect(ctx, p, 1, 1, 1, 1, 'rgba(255,255,255,0.22)');
      }
    }
  }

  // casterBase — 5 spokes at 72° apart, each faked as three stepped cuboids
  // (an axis-aligned box drawer cannot draw a diagonal arm, but three boxes
  // marching 2-across-1-down can), each ending in a 2x2px wheel sprite.
  function casterBase(box, ctx, P, cx, cy, radius, camera) {
    for (var k = 0; k < 5; k++) {
      var a = -Math.PI / 2 + k * (Math.PI * 2 / 5);
      var dx = Math.cos(a), dy = Math.sin(a);
      for (var s = 1; s <= 3; s++) {
        var t = (s / 3) * radius;
        box(ctx, cx + dx * t - 0.045, cy + dy * t - 0.045, 1.6, 0.09, 0.09, 1.6, CASTER, camera);
      }
      var wp = P(cx + dx * radius, cy + dy * radius, 1.4);
      pixRect(ctx, wp, -1, -1, 2, 2, WHEEL_DARK);
      pixRect(ctx, wp, -1, -1, 1, 1, '#6E7688');
    }
    box(ctx, cx - 0.07, cy - 0.07, 1.6, 0.14, 0.14, 2.4, CASTER, camera);
  }

  var CHAIR_TIERS = [
    { // 0 — WOODEN STOOL
      seat: { top: '#8A6C48', left: '#6B5233', right: '#463621', accent: '#C0A075' },
      leg: { top: '#3E301F', left: '#2A2016', right: '#1B140E' }
    },
    { // 1 — GAMING CHAIR: red plush, yellow brand stripe
      seat: { top: '#D6455F', left: '#B0304A', right: '#722336', accent: '#FF93A6' },
      trim: { top: '#3A3F55', left: '#2B2F42', right: '#1B1E2C' },
      tuft: '#6E1A2C'
    },
    { // 2 — PRO ESPORTS: near-black leather, gold piping, headrest wing
      seat: { top: '#33343F', left: '#1C1C26', right: '#111219', accent: '#7C7F92' },
      trim: { top: '#4A4C5E', left: '#33343F', right: '#1E1F2A' },
      tuft: '#5A5D72'
    }
  ];

  props.chair = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var P = detailer(gx, gy, rot, camera);
    var F = faces(rot); // SPEC-V17 §4 — see faceVisible() above
    // clamp rather than fall back to tier 0: an out-of-range tier used to
    // land on the STOOL's palette, which has no .trim/.tuft, and the wheeled
    // branch below then threw on undefined.
    tier = (typeof tier === 'number' && tier > 0) ? Math.min(tier, CHAIR_TIERS.length - 1) : 0;
    var t = CHAIR_TIERS[tier];
    var i;

    if (tier === 0) {
      // WOODEN STOOL — broader footprint, chunkier legs, a chamfered seat
      // slab and 1px wood-grain lines in a darker tint of the wood.
      var legMat = t.leg, seatZ0 = 7;
      box(ctx, gx + 0.22, gy + 0.22, 0, 0.09, 0.09, seatZ0, legMat, camera);
      box(ctx, gx + 0.69, gy + 0.22, 0, 0.09, 0.09, seatZ0, legMat, camera);
      box(ctx, gx + 0.22, gy + 0.69, 0, 0.09, 0.09, seatZ0, legMat, camera);
      box(ctx, gx + 0.69, gy + 0.69, 0, 0.09, 0.09, seatZ0, legMat, camera);
      // cross brace, so the legs read as joined furniture not four sticks
      box(ctx, gx + 0.22, gy + 0.44, 3, 0.56, 0.05, 1.5, legMat, camera);
      plushSlab(box, ctx, gx + 0.16, gy + 0.16, seatZ0, 0.62, 0.62, 4.5, t.seat, camera);
      for (i = 0; i < 3; i++) {
        crispStroke(ctx, [P(gx + 0.20, gy + 0.26 + i * 0.16, seatZ0 + 4.5), P(gx + 0.74, gy + 0.26 + i * 0.16, seatZ0 + 4.5)], '#5A4327', false);
      }
      return;
    }

    var backH = tier === 1 ? 19 : 23;
    var seatZ = 8.5;
    // gas lift + 5-point caster base (both wheeled tiers now, not just pro —
    // a gaming chair with a single peg foot read as a bar stool)
    casterBase(box, ctx, P, gx + 0.50, gy + 0.50, 0.25, camera);
    box(ctx, gx + 0.43, gy + 0.43, 4, 0.14, 0.14, seatZ - 4, CASTER, camera);

    // ---- V19 §2 — THE SEE-THROUGH CHAIR ---------------------------------
    // Owner defect: "the racer chair's armrests are visible through the back
    // of the chair, which is simply impossible." This is the SPEC-V17 §4
    // face-culling bug class, but it needed the OTHER half of that mechanism
    // too: the armrests are real geometry that must be OCCLUDED, not culled.
    // The backrest lives at local y 0.62..0.76, the armrests at 0.26..0.62 —
    // so at the rotations where the backrest is the nearer of the two
    // (exactly the rotations faceVisible('y+') is true for, rot 0/3, which is
    // where you are looking at the chair's back), the backrest MUST be
    // painted after the armrests. It was unconditionally painted before them,
    // so at rot 0/3 both armrests drew straight over the cushion. Nothing
    // else in the family had ordering either.
    var backNear = F.front;   // rot 0/3: backrest between camera and armrests

    function drawSeat() {
      plushSlab(box, ctx, gx + 0.17, gy + 0.22, seatZ, 0.60, 0.52, 5, t.seat, camera);
    }
    function drawArms() {
      box(ctx, gx + 0.12, gy + 0.26, seatZ + 4, 0.08, 0.36, 5.5, t.trim, camera);
      box(ctx, gx + 0.71, gy + 0.26, seatZ + 4, 0.08, 0.36, 5.5, t.trim, camera);
      box(ctx, gx + 0.11, gy + 0.25, seatZ + 9.5, 0.10, 0.38, 1.4, t.seat, camera);
      box(ctx, gx + 0.70, gy + 0.25, seatZ + 9.5, 0.10, 0.38, 1.4, t.seat, camera);
    }
    function drawBack() {
      plushSlab(box, ctx, gx + 0.17, gy + 0.62, seatZ, 0.60, 0.14, backH, t.seat, camera);
      // Tufting goes on the backrest's LARGER-y face — in a 2:1 iso view that
      // is the only face of the backrest the camera can actually see.
      // SPEC-V17 §4: that face is only camera-facing at rot 0/3.
      if (F.front) tufting(ctx, P, gx + 0.17, gy + 0.765, seatZ, 0.60, backH, 3, tier === 1 ? 3 : 4, t.tuft);
      if (tier === 1) {
        // brand stripe across the top of the backrest's visible face
        if (F.front) box(ctx, gx + 0.17, gy + 0.71, seatZ + backH - 3.5, 0.60, 0.06, 2.5,
          { top: '#FFE58A', left: '#FFD54A', right: '#B08F2C' }, camera);
      } else {
        // PRO ESPORTS: headrest wing on its own posts + gold lumbar bar
        box(ctx, gx + 0.26, gy + 0.63, seatZ + backH, 0.06, 0.10, 3, t.trim, camera);
        box(ctx, gx + 0.63, gy + 0.63, seatZ + backH, 0.06, 0.10, 3, t.trim, camera);
        plushSlab(box, ctx, gx + 0.21, gy + 0.60, seatZ + backH + 3, 0.52, 0.16, 5.5, t.seat, camera);
        // lumbar bar + piping sit ON the visible face, not behind the
        // backrest where they used to paint over the whole cushion.
        if (F.front) {
          crispStroke(ctx, [P(gx + 0.19, gy + 0.766, seatZ + backH * 0.42), P(gx + 0.75, gy + 0.766, seatZ + backH * 0.42)], '#E0BE64', false);
          crispStroke(ctx, [P(gx + 0.19, gy + 0.766, seatZ + backH * 0.42 - 1), P(gx + 0.75, gy + 0.766, seatZ + backH * 0.42 - 1)], '#95793A', false);
          crispStroke(ctx, [P(gx + 0.185, gy + 0.766, seatZ + backH * 0.34), P(gx + 0.185, gy + 0.766, seatZ + backH - 1)], '#E0BE64', false);
          crispStroke(ctx, [P(gx + 0.755, gy + 0.766, seatZ + backH * 0.34), P(gx + 0.755, gy + 0.766, seatZ + backH - 1)], '#E0BE64', false);
        }
      }
    }

    if (backNear) {
      // looking at the chair's back: seat, then armrests, then the backrest
      // last so it hides the inner two-thirds of both armrests. Only the
      // slivers that genuinely stick out past the cushion's x-extent survive.
      drawSeat(); drawArms(); drawBack();
    } else {
      // looking at the chair's seat: the backrest is the far part.
      drawBack(); drawSeat(); drawArms();
    }
  };

  // Beds (SPEC-V3 §3) — 5 tiers, floor mattress -> cryo sleep pod. A
  // singleton prop like desk/pc/chair (State.buyItem's autoPlaceSingleton
  // swaps it), now placed for real in state.placed (see Data.defaultPlaced),
  // so it's driven through the normal propMap/drawFamily path below rather
  // than a hardcoded draw. `ox`/`oy` reproduce the original hand-placed
  // visual offset from the anchor tile (the room's reserved bottom-right
  // corner) so the bed still sits the same way it always has.
  // h differs a lot between tier 0 and 1 on purpose (1.5 vs 11) — a real
  // floor mattress sits nearly flush with the floor, a single bed stands on
  // a proper frame, and that height gap alone reads as an upgrade before any
  // colour registers (V16 Package P4 — tiers must differ by silhouette, not
  // just palette, ART-DIRECTION §2.2).
  // V16 §2.2 — BED. Warm wood frame (#C47B49) with dark grain lines on every
  // non-pod tier, a blanket with 2-tone diagonal crease lines and rounded
  // fold-over corners, and a pillow that is a rounded squishy shape casting
  // its own shadow onto the mattress. Frames stay per-tier tinted, but they
  // are all the SAME warm wood family now instead of four unrelated darks.
  var BED_WOOD = { top: '#DFA070', left: '#C47B49', right: '#8A5330', accent: '#F3C79E' };
  var BED_GRAIN = '#8A5330';
  var BED_TIERS = [
    { frame: BED_WOOD, mattress: '#dfe3f5', blanket: '#8a6a45', h: 2.5 },  // 0 floor mattress
    { frame: BED_WOOD, mattress: '#eef1fb', blanket: '#3ddc84', h: 10 },   // 1 single bed
    { frame: { top: '#C08E64', left: '#A66940', right: '#70452A', accent: '#E4B78C' },
      mattress: '#f5f0ff', blanket: '#8847ff', h: 11, plush: true },       // 2 memory foam
    { frame: { top: '#E5AE7C', left: '#C47B49', right: '#8A5330', accent: '#FBD6AE' },
      mattress: '#fff8ea', blanket: '#ffd54a', h: 12, wide: true },        // 3 king size
    { frame: '#1a2440', mattress: '#bfe9ff', blanket: '#34d3ff', h: 15, pod: true } // 4 cryo pod
  ];

  // bedding — the shared blanket + pillow treatment for every non-pod tier.
  // The blanket is three stepped slabs (so its fold-over corners are rounded
  // rather than a hard cube), scored with 2-tone diagonal crease lines; the
  // pillow is a stepped squish that drops a 1px shadow onto the mattress.
  function bedding(box, ctx, P, mx, my, mz, mw, md, blanketHex, camera) {
    var bl = { top: mulColor(blanketHex, 1.28), left: blanketHex, right: mulColor(blanketHex, 0.66),
      accent: lerpColor(blanketHex, '#ffffff', 0.45) };
    var creaseA = mulColor(blanketHex, 0.62), creaseB = lerpColor(blanketHex, '#ffffff', 0.28);
    var s = 0.045;
    // rounded fold-over: narrower lip, full body, narrower crown
    box(ctx, mx + s, my + s, mz, mw - s * 2, md - s * 2, 0.8, bl, camera);
    box(ctx, mx, my, mz + 0.8, mw, md, 2.0, bl, camera);
    box(ctx, mx + s, my + s, mz + 2.8, mw - s * 2, md - s * 2, 0.8, bl, camera);
    // 2-tone diagonal creases across the blanket's top surface
    for (var i = 0; i < 4; i++) {
      var u = 0.16 + i * 0.22;
      crispStroke(ctx, [P(mx + mw * u, my + md * 0.06, mz + 3.6), P(mx + mw * (u + 0.12), my + md * 0.94, mz + 3.6)], creaseA, false);
      crispStroke(ctx, [P(mx + mw * (u + 0.02), my + md * 0.06, mz + 3.6), P(mx + mw * (u + 0.14), my + md * 0.94, mz + 3.6)], creaseB, false);
    }
  }
  function pillow(box, ctx, P, px, py, pz, pw, pd, camera) {
    var mat = { top: '#FFFDF6', left: '#F4F1E6', right: '#C4BFAE', accent: '#FFFFFF' };
    // shadow the pillow casts onto the mattress, offset down-right (light
    // comes from the top-left, so the shadow must fall the other way)
    crispStroke(ctx, [P(px + 0.03, py + pd + 0.03, pz), P(px + pw + 0.03, py + pd + 0.03, pz), P(px + pw + 0.03, py + 0.03, pz)], '#B9B7AC', false);
    var s = 0.05;
    box(ctx, px + s, py + s, pz, pw - s * 2, pd - s * 2, 1.0, mat, camera);
    box(ctx, px, py, pz + 1.0, pw, pd, 2.0, mat, camera);
    box(ctx, px + s, py + s, pz + 3.0, pw - s * 2, pd - s * 2, 1.0, mat, camera);
    // the dent where a head goes
    crispStroke(ctx, [P(px + pw * 0.30, py + pd * 0.42, pz + 4.1), P(px + pw * 0.70, py + pd * 0.42, pz + 4.1)], '#D9D5C6', false);
  }
  // §23 fix: the pillow used to be hardcoded '#34d3ff' (a bright accent cyan,
  // not a fabric colour) and — on the king tier especially — sat at a z/x
  // that the blanket (drawn AFTER it, same painter's-algorithm layer) then
  // partially painted over, chopping it into a stray sliver that read as
  // "floating" beside the bed rather than resting on it. Fix: a believable
  // off-white pillow colour, drawn flush with the true mattress-top height on
  // every tier (was hardcoded off-by-one on the plush tier), and — on the
  // king tier — a blanket footprint that starts strictly after both pillows
  // end in x so the two volumes never share screen space.
  var PILLOW_COLOR = '#f4f1e6';
  props.bed = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var t = BED_TIERS[tier] || BED_TIERS[0];
    // Anchor-normalized art (footprint/art alignment fix): State.footprintTiles()
    // always extends the bed's 2-tile span in +x (rot 0/2) or +y (rot 1/3)
    // from the anchor (gx,gy) — see state.js. rotatedBox() rotates every
    // local box() call about the ANCHOR TILE's own center (gx+0.5,gy+0.5),
    // which is exactly right for a 1x1 prop but NOT for this 2-tile-wide
    // one: rotating a 2-wide shape 180 about a pivot only 0.5 into it
    // necessarily translates the whole shape by a tile. Flush-anchoring at
    // ox=gx (no offset) lands correctly for rot 0/1; rot 2/3 need the SAME
    // shape pulled back by (frame width - 1) so it re-lands on the
    // identical anchor tiles instead of drifting one tile short — same two
    // tiles, mirrored art, which is what a real 180 rotation of a 2x1
    // object in place looks like. Verified against rotatedBox's rotateRect
    // transform for all four rot values — see verification notes in the
    // fix commit.
    var frameW = t.wide ? 2.0 : 1.8;
    var flipped = rot === 2 || rot === 3;
    var ox = gx + (flipped ? -(frameW - 1) : 0), oy = gy - 0.1;
    if (t.pod) {
      // Cryo sleep pod: sealed capsule shell with a pulsing frost-blue glow
      // core and a pale glass rim — reads as unmistakably sci-fi (no pillow —
      // you sleep suspended, not resting your head).
      box(ctx, ox, oy, 0, 1.8, 0.9, 6, '#141a30', camera);
      box(ctx, ox + 0.08, oy + 0.08, 6, 1.64, 0.74, 20, '#232c4a', camera);
      var pulse = 0.55 + 0.45 * Math.sin((time || 0) / 480);
      box(ctx, ox + 0.16, oy + 0.14, 8, 1.48, 0.62, 15, shade(t.mattress, -0.35 + 0.3 * pulse), camera);
      box(ctx, ox + 0.10, oy + 0.10, 26, 1.60, 0.70, 2, t.mattress, camera);
      var glp = rotatedLocalPoint(gx, gy, ox + 0.9, oy + 0.45, rot);
      var gp = project(glp.x, glp.y, 14, camera);
      glow(ctx, gp.x, gp.y, 22 * Math.sqrt(camera.scale || 1) * 1.4, t.blanket, 0.16);
      return;
    }
    var P = detailer(gx, gy, rot, camera);
    // grain — 1px darker-tint lines along the frame's front rail, the detail
    // that turns a brown cuboid into a piece of wooden furniture. SPEC-V17 §4:
    // the front rail is the frame's max-local-y face, which is only camera-
    // facing at rot 0/3; drawing it at rot 1/2 scored the grain straight
    // across the wrong side of the bed.
    function grain(fx, fy, fw, fh) {
      if (!faceVisible('y+', rot)) return;
      for (var g = 0; g < 3; g++) {
        var gz = fh * (0.25 + g * 0.25);
        crispStroke(ctx, [P(fx + fw * 0.05, fy, gz), P(fx + fw * 0.45, fy, gz)], BED_GRAIN, false);
        crispStroke(ctx, [P(fx + fw * 0.55, fy, gz - 0.6), P(fx + fw * 0.92, fy, gz - 0.6)], BED_GRAIN, false);
      }
    }
    if (t.wide) {
      // King size: wider frame + a plumped double-pillow row at the head end.
      var matHW = 5.5;
      box(ctx, ox - 0.1, oy, 0, 2.0, 0.95, t.h, t.frame, camera);
      grain(ox - 0.1, oy + 0.95, 2.0, t.h);
      box(ctx, ox - 0.05, oy + 0.05, t.h, 1.9, 0.85, matHW, t.mattress, camera);
      pillow(box, ctx, P, ox + 0.02, oy + 0.10, t.h + matHW, 0.26, 0.32, camera);
      pillow(box, ctx, P, ox + 0.32, oy + 0.10, t.h + matHW, 0.26, 0.32, camera);
      bedding(box, ctx, P, ox + 0.66, oy + 0.10, t.h + matHW - 1.5, 1.18, 0.72, t.blanket, camera);
      return;
    }
    var matH = t.plush ? 6.5 : 5.5;
    box(ctx, ox, oy, 0, 1.8, 0.9, t.h, t.frame, camera);
    if (t.h > 4) grain(ox, oy + 0.9, 1.8, t.h);
    box(ctx, ox + 0.05, oy + 0.06, t.h, 1.7, 0.78, matH, t.mattress, camera);
    pillow(box, ctx, P, ox + 0.11, oy + 0.16, t.h + matH, 0.34, 0.46, camera);
    bedding(box, ctx, P, ox + 0.58, oy + 0.10, t.h + matH - 1.5, 1.12, 0.70, t.blanket, camera);
  };

  // CACTUS (was SUCCULENT / plant_succulent, SPEC-V15-BATCH-A §9). V15 ramp
  // + outline via rotatedBoxRamp — terracotta pot, one thick trunk, two
  // side arms and a flower cap read as "cactus" at a glance.
  // V16 §2.2 — CACTUS. The old version was three plain cubes on a stick. Now
  // the stems are SEGMENTED: each is a short stack of slabs whose footprint
  // steps in and out by ~1px per segment, which is how you draw an organic
  // curve on a pixel grid. Terracotta pot uses the spec's literal #D97706
  // highlight / #B45309 base with a thick extruded rim that casts a real 1px
  // shadow line down onto the pot body, and pale spine dots run the stem
  // edges.
  var POT_MAT = { top: '#D97706', left: '#B45309', right: '#8A3F07', accent: '#F0A64A' };
  var POT_RIM = { top: '#E8901A', left: '#C2610B', right: '#96460A', accent: '#FBC177' };
  var CACTUS_MAT = { top: '#4FBE7E', left: '#3AA168', right: '#256B4E', accent: '#9BE8B4' };
  var SPINE = '#D8F5D0';
  props.plant = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var P = detailer(gx, gy, rot, camera);
    var F = faces(rot); // SPEC-V17 §4 — see faceVisible() above
    var i, p;

    // ---- terracotta pot: tapered body (steps outward as it rises) --------
    box(ctx, gx + 0.32, gy + 0.32, 0, 0.30, 0.30, 3, POT_MAT, camera);
    box(ctx, gx + 0.30, gy + 0.30, 3, 0.34, 0.34, 3, POT_MAT, camera);
    box(ctx, gx + 0.28, gy + 0.28, 6, 0.38, 0.38, 2, POT_MAT, camera);
    // thick extruded rim, visibly proud of the body on every side
    box(ctx, gx + 0.24, gy + 0.24, 8, 0.46, 0.46, 3, POT_RIM, camera);
    // ...and the shadow that rim throws onto the pot beneath it
    crispStroke(ctx, [P(gx + 0.28, gy + 0.66, 8), P(gx + 0.66, gy + 0.66, 8), P(gx + 0.66, gy + 0.28, 8)], '#6B2F05', false);
    // soil, sunk inside the rim
    box(ctx, gx + 0.28, gy + 0.28, 10, 0.38, 0.38, 0.6, { top: '#4A3527', left: '#3B2A1F', right: '#2C1F17' }, camera);

    // ---- main stem: 5 segments, footprint stepping in/out per segment ----
    var segs = [
      { x: 0.40, y: 0.40, w: 0.20, h: 4 },
      { x: 0.385, y: 0.395, w: 0.23, h: 4 },
      { x: 0.395, y: 0.40, w: 0.21, h: 4 },
      { x: 0.41, y: 0.41, w: 0.18, h: 4 },
      { x: 0.425, y: 0.42, w: 0.15, h: 3 }
    ];
    var z = 10.5;
    for (i = 0; i < segs.length; i++) {
      box(ctx, gx + segs[i].x, gy + segs[i].y, z, segs[i].w, segs[i].w, segs[i].h, CACTUS_MAT, camera);
      // segment seam — a darker tint of the cactus, never black
      if (i > 0 && F.front) crispStroke(ctx, [P(gx + segs[i].x, gy + segs[i].y + segs[i].w, z), P(gx + segs[i].x + segs[i].w, gy + segs[i].y + segs[i].w, z)], '#1D5540', false);
      z += segs[i].h;
    }

    // ---- two arms, each 3 stepped segments: out, out+up, up -------------
    box(ctx, gx + 0.26, gy + 0.42, 15, 0.15, 0.15, 3, CACTUS_MAT, camera);
    box(ctx, gx + 0.24, gy + 0.42, 18, 0.13, 0.15, 3, CACTUS_MAT, camera);
    box(ctx, gx + 0.245, gy + 0.425, 21, 0.12, 0.14, 4, CACTUS_MAT, camera);
    box(ctx, gx + 0.58, gy + 0.42, 19, 0.14, 0.14, 3, CACTUS_MAT, camera);
    box(ctx, gx + 0.62, gy + 0.42, 22, 0.12, 0.14, 3, CACTUS_MAT, camera);
    box(ctx, gx + 0.615, gy + 0.425, 25, 0.11, 0.13, 3.5, CACTUS_MAT, camera);

    // ---- 1px pale spine dots down both stem edges ------------------------
    // Authored on the stems' front (max-local-y) faces — culled at rot 1/2,
    // where those faces are round the back of the stems (SPEC-V17 §4).
    if (F.front) {
      for (i = 0; i < 7; i++) {
        p = P(gx + 0.39, gy + 0.62, 12 + i * 2.6);
        pixRect(ctx, p, 0, 0, 1, 1, SPINE);
        p = P(gx + 0.61, gy + 0.62, 13.4 + i * 2.6);
        pixRect(ctx, p, -1, 0, 1, 1, SPINE);
      }
      for (i = 0; i < 3; i++) {
        pixRect(ctx, P(gx + 0.26, gy + 0.57, 16 + i * 3.4), 0, 0, 1, 1, SPINE);
        pixRect(ctx, P(gx + 0.70, gy + 0.56, 20 + i * 3.2), -1, 0, 1, 1, SPINE);
      }
    }

    // ---- flower cap, stepped so it reads as a bloom not a cube ----------
    box(ctx, gx + 0.435, gy + 0.435, z, 0.13, 0.13, 1.5, { top: '#FF9EE2', left: '#FF6BD6', right: '#C2439F' }, camera);
    box(ctx, gx + 0.455, gy + 0.455, z + 1.5, 0.09, 0.09, 1.5, { top: '#FFD1F0', left: '#FF9EE2', right: '#D064B0' }, camera);
  };

  // WALL MOUNTS (SPEC-V15-BATCH-B §1) — poster_team (tier 0) / window_blinds
  // (tier 1). Owner's report: these used to float mid-tile as ordinary floor
  // props (a thin box at z 15-39, offset 0.3 into the tile on both axes,
  // touching neither wall). Redrawn to hang FLAT against the wall plane
  // instead, through the V15 ramp (Iso.boxRamp/rampShade — ART-DIRECTION.md
  // §2.2, no second ramp per the batch contract).
  //
  // `rot` here is never a free choice — it's State.wallRotForTile()'s
  // derived value, the ONLY two values a wall item's def.mount==='wall'
  // placement/move path in state.js ever produces: 0 = anchored on the
  // y===0 (back) wall, 1 = anchored on the x===0 (side) wall. Because that's
  // a discrete "which wall" choice rather than a free 4-way spin, this does
  // NOT go through the generic rotatedBox()/rotateRect() 90°-about-center
  // trick every other family uses (that trick rotates a box to the tile's
  // OPPOSITE edge, not the adjacent wall's own edge) — instead each branch
  // is hand-positioned hugging the correct wall's plane, the same way
  // props.bed hand-positions its own asymmetric ox/oy per rot instead of
  // trusting the generic rotator.
  // SPEC-V21 §7 — the TEAM POSTER is one of the two FABRIC customisables. Its
  // tint lands on the printed sheet only: the frame/tape stays dark so the
  // banner keeps a silhouette against a pale dye (#ECF0F1 is in the palette).
  // Nothing else changes — boxRamp re-derives top/left/right from the new base,
  // so a dyed banner is modelled exactly like the factory one.
  props.poster = function (ctx, gx, gy, tier, camera, time, rot, extra) {
    var isBlinds = tier >= 1;
    var frameCol = '#20263e';
    var artCol = tintOf(extra, false) || (isBlinds ? '#ff8a1f' : '#8847ff');
    var onSideWall = rot === 1;
    var i;
    if (onSideWall) {
      // x === 0 side wall: thin along x (hugging x=gx), spans along y.
      boxRamp(ctx, gx + 0.02, gy + 0.24, 15, 0.05, 0.52, 24, frameCol, camera);
      boxRamp(ctx, gx + 0.045, gy + 0.28, 17, 0.02, 0.44, 20, artCol, camera);
      if (isBlinds) {
        for (i = 0; i < 4; i++) {
          boxRamp(ctx, gx + 0.045, gy + 0.29 + i * 0.105, 17 + i * 4.5, 0.02, 0.02, 3.5, frameCol, camera);
        }
      }
    } else {
      // y === 0 back wall (default — includes the (0,0) corner): thin along
      // y (hugging y=gy), spans along x.
      boxRamp(ctx, gx + 0.24, gy + 0.02, 15, 0.52, 0.05, 24, frameCol, camera);
      boxRamp(ctx, gx + 0.28, gy + 0.045, 17, 0.44, 0.02, 20, artCol, camera);
      if (isBlinds) {
        for (i = 0; i < 4; i++) {
          boxRamp(ctx, gx + 0.29 + i * 0.105, gy + 0.045, 17 + i * 4.5, 0.02, 0.02, 3.5, frameCol, camera);
        }
      }
    }
  };

  /* ---- WINDOWS & BLINDS (SPEC-V20 §1 / §3) --------------------------------
     Windows stopped being part of the room shell in V20 (drawWalls' two
     `roomTier.windows` loops and drawWindowAt are gone) and became four
     purchasable wall-mounted props. Blinds are a fifth. All five had NO
     propMap entry when the catalog landed, which means drawFamily() silently
     no-opped and every one of them rendered COMPLETELY INVISIBLE once placed
     — the exact V15 regen-item bug the note on regen_footrest in propMap
     records. They are wired up below.

     WALL GEOMETRY. These follow props.poster's precedent, not the generic
     rotatedBox()/rotateRect() 90°-about-centre rotator: `rot` for a
     mount:'wall' item is never a free spin, it is State.wallRotForTile()'s
     derived "which wall am I on" — 0 = the y===0 back wall (the item runs
     along x), 1 = the x===0 side wall (it runs along y). The generic rotator
     would swing a box to the tile's OPPOSITE edge instead of hugging the
     adjacent wall's own plane, so instead everything here is authored once in
     wall-local coordinates and mapped onto whichever wall it sits on:

        u — distance ALONG the wall from the anchor tile's origin, in tiles
        t — distance OUT from the wall plane, in tiles
        z — height, in the same world units every prop uses

     wallPt/wallQuad4/wallBox below are the only place that u,t -> x,y mapping
     exists, so a window, a blind and their line art can never disagree about
     which wall they are on. For the same reason faces(rot)/faceVisible() (the
     SPEC-V17 §4 detail-culling gate) does not apply here: that gate answers
     "has this authored face swung round the back", and a hand-positioned wall
     prop's single authored face is by construction the one pointing into the
     room at both of its two legal rotations.

     WIDTH is never guessed. A wide window covers two adjacent wall slots and
     `extra.span` carries how many — sourced by the caller from
     State.wallFootprintTiles(), the single source of truth for wall coverage
     (renderRoom passes the placed item's real span; renderPropIcon asks the
     same export for the catalog def's). A missing span falls back to 1.
  ------------------------------------------------------------------------- */
  function wallPt(gx, gy, rot, u, t, z, camera) {
    return rot === 1 ? project(gx + t, gy + u, z * VSCALE, camera)
      : project(gx + u, gy + t, z * VSCALE, camera);
  }
  function wallQuad4(gx, gy, rot, u0, u1, z0, z1, t, camera) {
    return [
      wallPt(gx, gy, rot, u0, t, z0, camera),
      wallPt(gx, gy, rot, u1, t, z0, camera),
      wallPt(gx, gy, rot, u1, t, z1, camera),
      wallPt(gx, gy, rot, u0, t, z1, camera)
    ];
  }
  function wallBox(ctx, gx, gy, rot, u0, uLen, t0, tLen, z, h, color, camera, opts) {
    if (rot === 1) boxRamp(ctx, gx + t0, gy + u0, z, tLen, uLen, h, color, camera, opts);
    else boxRamp(ctx, gx + u0, gy + t0, z, uLen, tLen, h, color, camera, opts);
  }

  // Window box: sill underside at z=14, head rail top at z=53. Deliberately
  // taller than a poster (15..39) — a window has to read as an opening in the
  // wall, not another rectangle hung on it.
  var WIN_Z_BOT = 14, WIN_Z_TOP = 53;
  var WIN_MARGIN = 0.07;   // inset from the tile edge, in tiles
  var WIN_JAMB = 0.085;    // side frame bar width, along the wall
  var WIN_BAR = 4.0;       // head/sill bar height, in z
  var WIN_T0 = 0.015;      // frame face offset out from the wall plane
  var WIN_TD = 0.075;      // frame depth
  var WIN_GT = 0.055;      // glass plane offset (inside the frame's depth)

  // FRAME MATERIALS. The black/wood split has to survive a ~26px-wide prop at
  // 420px, so it is a HUE **and** VALUE split, never a tint of one colour:
  // charcoal aluminium (luma ~48, cool) against honey oak (luma ~131, warm) —
  // a 2.7x value ratio. Each carries its own inner-rebate hairline, which is
  // the 1px that names the material even when the frame itself is 3px wide.
  var WIN_MAT = {
    black: { base: '#2A2F3D', rebate: '#7F8CAB', sill: '#222733', grain: null },
    wood: { base: '#B8763C', rebate: '#F6C994', sill: '#A2652F', grain: '#8A5426' }
  };

  // What is on the other side of the glass, as a day -> sunset -> night ramp.
  // Same stopColor() three-stop shape the backdrops use, so the view through a
  // window and the sky behind the room move together instead of drifting.
  var WIN_SKY_TOP = [{ u: 0, c: '#4FA8E8' }, { u: 0.5, c: '#E4643C' }, { u: 1, c: '#080C22' }];
  var WIN_SKY_BOT = [{ u: 0, c: '#CBEAFB' }, { u: 0.5, c: '#FFC069' }, { u: 1, c: '#151D46' }];
  var WIN_LAND = [{ u: 0, c: '#5B7A61' }, { u: 0.5, c: '#6B4A3C' }, { u: 1, c: '#0A102C' }];

  // tier: 0 = black rim, 1 = wood rim. span (extra.span) 1 or 2 tiles.
  props.window = function (ctx, gx, gy, tier, camera, time, rot, extra) {
    extra = extra || {};
    var span = extra.span > 1 ? 2 : 1;
    var dnT = clamp01(typeof extra.dayNightT === 'number' ? extra.dayNightT : 0);
    var mat = tier >= 1 ? WIN_MAT.wood : WIN_MAT.black;
    var u0 = WIN_MARGIN, u1 = span - WIN_MARGIN;
    var gu0 = u0 + WIN_JAMB, gu1 = u1 - WIN_JAMB;          // glass opening, along wall
    var gz0 = WIN_Z_BOT + WIN_BAR, gz1 = WIN_Z_TOP - WIN_BAR; // glass opening, in z
    var gzH = gz1 - gz0;
    var i;

    // ---- 1. THE GLASS ---------------------------------------------------
    // Drawn at <1 alpha (SPEC-V20 §1 "at least slightly transparent") so the
    // wall's own colour and texture ghost through the view — that faint
    // double-exposure is what makes it read as glass rather than a hole.
    var glassPoly = wallQuad4(gx, gy, rot, gu0, gu1, gz0, gz1, WIN_GT, camera);
    ctx.save();
    tracePath(ctx, glassPoly, true);
    ctx.clip();
    ctx.globalAlpha = 0.82;

    // ONE non-overlapping partition of the pane, land included, rather than a
    // sky gradient with a land band painted over it. Overlapping translucent
    // quads square their own alpha where they meet (0.82 twice is 0.97), which
    // shows up as an opaque seam through what is supposed to be uniform glass
    // — measured, not assumed: the pixel harness reads translucency per pixel.
    var topC = stopColor(WIN_SKY_TOP, dnT), botC = stopColor(WIN_SKY_BOT, dnT);
    var landC = stopColor(WIN_LAND, dnT);
    var BANDS = 8, HORIZON = 2; // bands 0..1 are the land beyond the sill
    for (i = 0; i < BANDS; i++) {
      var f0 = i / BANDS, f1 = (i + 1) / BANDS;
      var bandC;
      if (i < HORIZON) bandC = mulColor(landC, i === 0 ? 0.86 : 1.0);
      else {
        var su = (i - HORIZON + 0.5) / (BANDS - HORIZON);
        bandC = lerpColor(botC, topC, su);
      }
      drawPoly(ctx, wallQuad4(gx, gy, rot, gu0, gu1, gz0 + gzH * f0, gz0 + gzH * f1, WIN_GT, camera),
        bandC, null);
    }
    // the horizon itself — the line that stops the pane reading as a swatch.
    crispStroke(ctx, [wallPt(gx, gy, rot, gu0, WIN_GT, gz0 + gzH * (HORIZON / BANDS), camera),
      wallPt(gx, gy, rot, gu1, WIN_GT, gz0 + gzH * (HORIZON / BANDS), camera)],
      lerpColor(botC, '#ffffff', 0.35 * (1 - dnT)), false);

    // sun by day / moon + stars by night, tracking across the pane as the day
    // turns — the single clearest "the world outside moved" cue.
    var isNight = dnT > 0.55;
    var discU = gu0 + (gu1 - gu0) * (0.26 + dnT * 0.46);
    var discZ = gz0 + gzH * (0.58 + 0.24 * (1 - Math.abs(dnT - 0.5) * 2));
    var dp = wallPt(gx, gy, rot, discU, WIN_GT, discZ, camera);
    if (isNight) {
      var rnd = mulberry32(((gx | 0) * 73856093) ^ ((gy | 0) * 19349663) ^ 0x5f3a);
      ctx.fillStyle = '#DCE6FF';
      for (i = 0; i < 9 + span * 5; i++) {
        ctx.fillRect(
          Math.round(dp.x + (rnd() - 0.5) * 34 * span),
          Math.round(dp.y + (rnd() - 0.5) * 26), 1, 1);
      }
      pixelCircle(ctx, dp.x, dp.y, 3, null, '#E9EDFF');
      // bite a crescent out of it with the sky tone behind
      pixelCircle(ctx, dp.x + 2, dp.y - 1, 3, null, lerpColor(botC, topC, 0.75));
    } else {
      var sunCol = lerpColor('#FFF6C4', '#FF9038', clamp01(dnT * 1.9));
      glow(ctx, dp.x, dp.y, 13, sunCol, 0.55);
      pixelCircle(ctx, dp.x, dp.y, 3, null, sunCol);
    }

    // two 1px specular streaks — the "this surface is polished" tell every
    // other reflective prop in the set uses. Fades out after dark.
    var gminX = Math.min(glassPoly[0].x, glassPoly[3].x), gmaxX = Math.max(glassPoly[1].x, glassPoly[2].x);
    var gminY = Math.min(glassPoly[2].y, glassPoly[3].y), gmaxY = Math.max(glassPoly[0].y, glassPoly[1].y);
    var sp = (gmaxX - gminX) + (gmaxY - gminY);
    ctx.globalAlpha = 0.34 + 0.34 * (1 - dnT);
    for (i = 0; i < 2; i++) {
      var off = 0.26 + i * 0.26;
      crispStroke(ctx, [
        { x: Math.round(gminX - sp * 0.2), y: Math.round(gminY + sp * off) },
        { x: Math.round(gmaxX + sp * 0.2), y: Math.round(gminY + sp * off - (gmaxX - gminX) - sp * 0.4) }
      ], i === 0 ? '#ffffff' : '#cfe6ff', false);
    }
    ctx.restore();

    // ---- 2. THE FRAME ---------------------------------------------------
    // Glazing bar first (it sits in the same plane as the glass), then the
    // jambs, then the head, then the sill last — the sill protrudes furthest
    // out of the wall, so painting it last is what makes it read as a ledge
    // in front of the jambs rather than a bar flush with them.
    if (span > 1) {
      // a wide window is TWO panes: a full-depth centre mullion, which is
      // also the silhouette difference from a small one at a glance.
      wallBox(ctx, gx, gy, rot, span / 2 - WIN_JAMB / 2, WIN_JAMB, WIN_T0, WIN_TD,
        gz0 - 0.5, gzH + 1, mat.base, camera);
    } else {
      // a small window gets one thin glazing bar — the detail that stops a
      // lone dark rectangle reading as another poster.
      wallBox(ctx, gx, gy, rot, span / 2 - 0.016, 0.032, WIN_T0 + 0.012, WIN_TD - 0.024,
        gz0, gzH, mat.base, camera, { noAccent: true });
    }
    wallBox(ctx, gx, gy, rot, u0, WIN_JAMB, WIN_T0, WIN_TD, gz0 - 0.5, gzH + 1, mat.base, camera);
    wallBox(ctx, gx, gy, rot, u1 - WIN_JAMB, WIN_JAMB, WIN_T0, WIN_TD, gz0 - 0.5, gzH + 1, mat.base, camera);
    wallBox(ctx, gx, gy, rot, u0 - 0.008, (u1 - u0) + 0.016, WIN_T0, WIN_TD + 0.012,
      WIN_Z_TOP - WIN_BAR, WIN_BAR, mat.base, camera);
    wallBox(ctx, gx, gy, rot, u0 - 0.022, (u1 - u0) + 0.044, WIN_T0 - 0.008, WIN_TD + 0.055,
      WIN_Z_BOT, WIN_BAR + 0.8, mat.sill, camera);

    // wood grain: two 1px seams along the sill's top face, in the material's
    // own darker tint (never black — seam rule, ART-DIRECTION §2.2).
    if (mat.grain) {
      for (i = 0; i < 2; i++) {
        var gt = WIN_T0 + 0.012 + i * 0.030;
        crispStroke(ctx, [
          wallPt(gx, gy, rot, u0 + 0.01, gt, WIN_Z_BOT + WIN_BAR + 0.8, camera),
          wallPt(gx, gy, rot, u1 - 0.01, gt, WIN_Z_BOT + WIN_BAR + 0.8, camera)
        ], mat.grain, false);
      }
    }

    // ---- 3. THE REBATE HAIRLINE -----------------------------------------
    // 1px around the opening in the frame's own bright tone. On a 3px-wide
    // frame this line is doing most of the "black rim vs wood rim" work, so
    // it is drawn last where nothing can eat it.
    crispStroke(ctx, glassPoly, mat.rebate, true);

    // ---- 4. DAYLIGHT SPILL ----------------------------------------------
    // Additive warm light in front of the pane, scaled straight off dayNightT
    // so a room full of windows visibly brightens by day and goes flat dark at
    // night. This is the reactivity you feel from across the room, before you
    // can resolve the glass itself. `extra.spill === false` turns it off for
    // the 56px shop card, where a 40px halo would swallow the whole icon.
    if (dnT < 0.94 && extra.spill !== false) {
      var lp = wallPt(gx, gy, rot, span / 2, WIN_GT + 0.22, (gz0 + gz1) / 2, camera);
      glow(ctx, lp.x, lp.y, (18 + 14 * span) * Math.sqrt(camera.scale || 1),
        lerpColor('#FFF1C6', '#FF9C5E', dnT), 0.12 * (1 - dnT));
    }
  };

  // BLINDS (SPEC-V20 §3). Two states, and the whole feedback for the tap that
  // toggles them is the difference between the two — so it is a difference of
  // SILHOUETTE, not of tint: OPEN is a bunched stack of slats in the top fifth
  // with the window wide open underneath; CLOSED is a solid opaque slatted
  // panel over the entire opening. `extra.closed` comes from the placed
  // entry's own `closed` flag, which State.toggleBlind() owns.
  // A blind covers essentially its whole tile (u 0.015..0.985) rather than
  // just the glass opening: real blinds outside-mount over the frame, and it
  // also means the two blinds on a wide window meet with no seam of glass
  // showing between them.
  var BLIND_RAIL = { top: '#9AA0AE', left: '#767C8C', right: '#4E5364', accent: '#C3C9D6' };
  var BLIND_SLAT = '#D6CBB2';
  var BLIND_BACK = '#9E9581';
  var BLIND_T = 0.125;     // out from the wall — clear of the window's sill
  var BLIND_TD = 0.035;
  props.blind = function (ctx, gx, gy, tier, camera, time, rot, extra) {
    extra = extra || {};
    var closed = !!extra.closed;
    // SPEC-V21 §7 — the second FABRIC customisable. Only the cloth takes the
    // dye: the aluminium head rail and the pull cord are hardware and keep
    // their own material, which is what stops a dyed blind reading as one
    // solid coloured plank. The backing carries its value relationship with
    // the slats across (dyeRel), so the 9-slat modelling survives every hue.
    var slatCol = tintOf(extra, false) || BLIND_SLAT;
    var backCol = dyeRel(BLIND_BACK, BLIND_SLAT, tintOf(extra, false));
    var u0 = 0.015, u1 = 0.985, uLen = u1 - u0;
    var railZ = WIN_Z_TOP - 6;
    var i, z;

    if (closed) {
      // opaque backing first, so the 1px gaps between slats can never show
      // the window through a "closed" blind.
      wallBox(ctx, gx, gy, rot, u0 + 0.01, uLen - 0.02, BLIND_T + 0.006, BLIND_TD - 0.012,
        WIN_Z_BOT + 3, railZ - (WIN_Z_BOT + 3), backCol, camera, { noAccent: true });
      var SLATS = 9, top = railZ, bot = WIN_Z_BOT + 3;
      var step = (top - bot) / SLATS;
      for (i = 0; i < SLATS; i++) {
        z = bot + i * step;
        wallBox(ctx, gx, gy, rot, u0 + 0.02, uLen - 0.04, BLIND_T, BLIND_TD,
          z, step * 0.82, slatCol, camera, { noOutline: i !== 0 });
      }
      // ladder tapes — two 1px vertical runs down the face. Cheap, and it is
      // what makes a closed blind read as a blind rather than a plank.
      for (i = 0; i < 2; i++) {
        var tu = u0 + uLen * (0.30 + i * 0.40);
        crispStroke(ctx, [
          wallPt(gx, gy, rot, tu, BLIND_T - 0.004, bot, camera),
          wallPt(gx, gy, rot, tu, BLIND_T - 0.004, top, camera)
        ], seamOf(slatCol), false);
      }
    } else {
      // OPEN — the whole stack bunched tight under the head rail, everything
      // below it clear glass. Kept deliberately short (3 slats over 8 world
      // units against the closed state's 30) because this silhouette gap IS
      // the entire feedback for the toggle tap.
      for (i = 0; i < 3; i++) {
        z = railZ - 2.9 - i * 2.7;
        wallBox(ctx, gx, gy, rot, u0 + 0.03, uLen - 0.06, BLIND_T, BLIND_TD,
          z, 1.9, slatCol, camera);
      }
    }

    // head rail, always — the fixed part the slats hang from, and the only
    // piece that looks identical in both states.
    wallBox(ctx, gx, gy, rot, u0, uLen, BLIND_T - 0.012, BLIND_TD + 0.024,
      railZ, 6.5, BLIND_RAIL, camera);

    // pull cord + bead, hanging off the right end. Long when open (the slats
    // are up), short when closed.
    var cu = u1 - 0.075;
    var cordBot = closed ? WIN_Z_BOT + 9 : railZ - 13;
    crispStroke(ctx, [
      wallPt(gx, gy, rot, cu, BLIND_T - 0.006, railZ, camera),
      wallPt(gx, gy, rot, cu, BLIND_T - 0.006, cordBot, camera)
    ], '#4A4437', false);
    var bp = wallPt(gx, gy, rot, cu, BLIND_T - 0.006, cordBot, camera);
    ctx.fillStyle = '#6E6553';
    ctx.fillRect(bp.x - 1, bp.y - 1, 2, 3);
    ctx.fillStyle = '#A99C81';
    ctx.fillRect(bp.x - 1, bp.y - 1, 1, 1);
  };

  // rug: a centered square diamond (equal width/depth, symmetric offset
  // both axes) — genuinely rotationally symmetric art, so rotatedDiamond is
  // a geometric no-op here. Still wired up (rather than skipped) so this
  // stays true by construction instead of by a maintained claim, and so the
  // hit-anchor/ROTATING_FAMILIES story below stays uniform across every
  // family with no special case to forget.
  // RUG (V16 Package P4). Was on the old diamond()/box() path, 2 tiers
  // sharing one nested-diamond shape with only the colour swapped — the
  // pixel rug now carries a real checkerboard motif (small alternating
  // squares, "pixel art rug" read at a glance) while the lucky mousepad
  // stays a plain diamond but sprouts corner RGB glow dots + a raised bezel
  // edge, so the two tiers are distinguishable by shape, not just hue.
  props.rug = function (ctx, gx, gy, tier, camera, time, rot, extra) {
    var diamond = rotatedDiamondRamp(gx, gy, rot);
    if (tier >= 1) {
      // LUCKY MOUSEPAD / FLOOR LED SCREEN: raised bezel ring + a pulsing RGB
      // glow at each corner — an esports mousepad silhouette, not just a rug
      // recolour.
      // SPEC-V21 §7 — a LIGHT customisable. The tint replaces the hue cycle as
      // the panel's emitted colour, so it drives the lit surface AND all four
      // corner spills together; the dark bezel underneath is the chassis and
      // keeps its own colour, which is what gives the lit panel something to
      // read against. Untinted, the hue cycle below is untouched.
      var ledTint = tintOf(extra, true);
      var hue = ((time || 0) / 24) % 360;
      var glowCol = ledTint
        ? mulColor(ledTint, 0.92 + 0.16 * ledBreathe(time))
        : hslToHex(hue, 85, 60);
      diamond(ctx, gx + 0.06, gy + 0.06, 0, 0.88, 0.88, '#20263e', camera);
      diamond(ctx, gx + 0.12, gy + 0.12, 0.6, 0.76, 0.76, glowCol, camera);
      var corners = [[0.14, 0.14], [0.86, 0.14], [0.14, 0.86], [0.86, 0.86]];
      for (var i = 0; i < corners.length; i++) {
        var cp = rotatedLocalPoint(gx, gy, gx + corners[i][0], gy + corners[i][1], rot);
        var pp = project(cp.x, cp.y, 1.4, camera);
        glow(ctx, pp.x, pp.y, 9 * Math.sqrt(camera.scale || 1), glowCol, 0.5);
      }
      return;
    }
    /* PIXEL RUG (V22, owner item 12) — rebuilt as a real woven rug rather than
       a swatch with squares on it. Three things were wrong with the old one:
       it was a single flat diamond with no bound edge, so it read as a decal
       painted on the floor; its checker sat directly on the field with no
       border, so the motif ran off the edge; and it had no fringe, which is
       the one silhouette detail that says "rug" instantly at 16px.

       Built in strict house language (ART-DIRECTION §2.2) — every layer goes
       through the same rotatedDiamondRamp the other floor props use, so it
       inherits the ramp's top-face fill, near-black outline and top-left rim
       light for free. No new shading path, no literal outline colour.

       Stacked lowest to highest, each a hair above the last so the ramp
       outlines separate cleanly instead of z-fighting on the floor plane:
         binding  — the bound edge of the rug, darkest
         field    — the woven ground
         border   — an inset frame that CONTAINS the motif
         checker  — the pixel motif, inside the border
         fringe   — tufts along the two near edges

       COLOUR. Every tone is derived from `base` by a fixed multiplier rather
       than named, which is what lets the fabric tint work at any hue: pick a
       colour and the whole rug re-dyes with its light-to-dark relationships
       intact. Naming a second constant here is how a tinted prop ends up with
       one surface stuck on the factory colour. */
    var base = tintOf(extra, false) || '#eb4b4b';
    var binding = mulColor(base, 0.52);
    var border = mulColor(base, 0.68);
    var alt = mulColor(base, 0.80);
    var fringe = mulColor(base, 1.18);

    // 1. bound edge — the widest layer, so it shows as a rim on every side
    diamond(ctx, gx + 0.035, gy + 0.035, 0.30, 0.93, 0.93, binding, camera);
    // 2. the woven field
    diamond(ctx, gx + 0.075, gy + 0.075, 0.55, 0.85, 0.85, base, camera);
    // 3. inset frame the motif sits inside
    diamond(ctx, gx + 0.135, gy + 0.135, 0.80, 0.73, 0.73, border, camera);
    diamond(ctx, gx + 0.185, gy + 0.185, 1.05, 0.63, 0.63, base, camera);

    // 4. the pixel motif — 4x4 alternating cells, inset far enough that the
    //    border frames it on all four sides at every rotation.
    var cell = 0.1425, start = 0.2025, n = 4;
    for (var yi = 0; yi < n; yi++) {
      for (var xi = 0; xi < n; xi++) {
        if ((xi + yi) % 2 === 0) continue;
        diamond(ctx, gx + start + xi * cell, gy + start + yi * cell, 1.30,
          cell * 0.90, cell * 0.90, alt, camera);
      }
    }

    // 5. fringe — short tufts along the two edges nearest the camera. Drawn
    //    BELOW the binding's z so they read as threads escaping from under
    //    the rug rather than sitting on top of it.
    var TUFTS = 7;
    for (var f = 0; f < TUFTS; f++) {
      var t = 0.075 + (f + 0.5) * (0.85 / TUFTS);
      diamond(ctx, gx + t - 0.026, gy + 0.955, 0.16, 0.052, 0.055, fringe, camera);
      diamond(ctx, gx + 0.955, gy + t - 0.026, 0.16, 0.055, 0.052, fringe, camera);
    }
  };

  props.displayCase = function (ctx, gx, gy, count, camera) {
    box(ctx, gx + 0.10, gy + 0.15, 0, 0.80, 0.50, 15, '#20263e', camera);
    box(ctx, gx + 0.13, gy + 0.18, 15, 0.74, 0.44, 2, '#59b3d9', camera);
    var n = Math.min(count, 3);
    for (var i = 0; i < n; i++) {
      box(ctx, gx + 0.22 + i * 0.22, gy + 0.30, 17, 0.08, 0.08, 8 + i * 2, '#ffd700', camera);
    }
  };

  // RGB family (V16 Package P4). Was on the old box() path, 2 tiers sharing
  // one "strip on the floor" shape with only a second thin bar added for
  // tier 1 — geometrically almost the same object. Now the RGB STRIP stays
  // a true low floor-level light strip, while the NEON SIGN stands upright
  // on its own mount as an actual signboard silhouette — a completely
  // different shape, not a taller version of the same bar.
  // SPEC-V20 §2 — LED Z-ORDER. rgb_strip/neon_sign carry `noCollide: true` and
  // may now sit on a tile that already holds furniture, and the spec is
  // specific about how that has to read: the LED draws flat BEHIND the
  // furniture on its tile so its glow spills out from underneath. Two halves:
  //   (a) the geometry goes first — drawOrderFor() sorts any noCollide item
  //       behind everything else on its tile (see CATEGORY_ORDER).
  //   (b) the LIGHT goes last — when renderRoom hands us its deferred glow
  //       list (extra.glows) we push into it instead of painting here, so the
  //       additive spill composites over the desk/chair standing in front
  //       rather than being buried under them. A light you can see under the
  //       furniture is the whole point; a light drawn before the furniture is
  //       just an invisible one. Callers without a collector (hub.js's ghost)
  //       still get the glow painted inline, exactly as before.
  // SPEC-V21 §7 — both tiers here are LIGHT customisables (RGB LED STRIP,
  // NEON SIGN). A tint takes over from the hue cycle and then feeds BOTH ends
  // of the light: the emissive body AND every emit() below, so a #00CCFF strip
  // washes the floor cyan and a #FF2D6F one washes it pink. That is the whole
  // difference between a coloured object and a coloured light, and it is why
  // the tint is not simply swapped into the box() call and left there.
  //   col  — the hot tube/strip itself, breathing a few percent either side of
  //          the chosen colour so a fixed-hue LED still reads as powered.
  //   col2 — the neon sign's larger panel face. Factory art separates face
  //          from trim by a 40° hue offset, which a single chosen colour
  //          cannot use; the separation therefore moves onto VALUE (×0.78 vs
  //          ×1.05) so the tube still reads hotter than the panel it borders.
  props.rgb = function (ctx, gx, gy, tier, camera, time, rot, extra) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var ledTint = tintOf(extra, true);
    var breathe = ledBreathe(time);
    var hue = ((time || 0) / 20) % 360;
    var col = ledTint ? mulColor(ledTint, 1.05 + 0.10 * breathe) : hslToHex(hue, 90, 60);
    var sink = (extra && extra.glows) || null;
    function emit(sx, sy, radius, color, alpha) {
      // A tinted light's spill breathes on the SAME envelope as its body — a
      // real light dims its room and itself together, and two independent
      // cycles would read as a fault rather than as an idle animation.
      if (ledTint) alpha *= (0.88 + 0.24 * breathe);
      if (sink) sink.push({ x: sx, y: sy, r: radius, color: color, a: alpha, raw: true });
      else glow(ctx, sx, sy, radius, color, alpha);
    }
    if (tier < 1) {
      // RGB STRIP: thin hue-cycling strip lying flush on the floor. Its spill
      // is wide and low — it is meant to wash the floor around whatever is
      // standing on the tile, so it is the one glow in the room deliberately
      // bigger than the prop casting it.
      box(ctx, gx + 0.05, gy + 0.05, 1, 0.90, 0.10, 1.6, col, camera);
      var glp0 = rotatedLocalPoint(gx, gy, gx + 0.5, gy + 0.1, rot);
      var p0 = project(glp0.x, glp0.y, 3, camera);
      // the wide, soft half of a tinted spill is the CHOSEN colour undiluted,
      // while the tight core below keeps `col`'s hotter value — so the falloff
      // still runs bright-centre to saturated-edge instead of one flat wash.
      emit(p0.x, p0.y, 46 * Math.sqrt(camera.scale || 1), ledTint || col, 0.20);
      emit(p0.x, p0.y, 20 * Math.sqrt(camera.scale || 1), col, 0.16);
      return;
    }
    // NEON SIGN: a mounted upright signboard with a glowing tube border.
    var col2 = ledTint
      ? mulColor(ledTint, 0.78 + 0.08 * breathe)
      : hslToHex((hue + 40) % 360, 90, 55);
    box(ctx, gx + 0.42, gy + 0.55, 0, 0.16, 0.16, 4, '#20263e', camera);   // floor mount base
    box(ctx, gx + 0.20, gy + 0.55, 4, 0.60, 0.05, 22, '#151a2c', camera); // sign backboard
    // The lit face is skinned onto the board's front; from behind (rot 1/2)
    // you get the dark backboard, not the sign shining through it (§4).
    if (faceVisible('y+', rot)) {
      box(ctx, gx + 0.24, gy + 0.53, 6, 0.52, 0.02, 18, col2, camera);      // glowing panel face
      box(ctx, gx + 0.24, gy + 0.53, 22.5, 0.52, 0.02, 1.2, col, camera);   // top tube trim
    }
    var glp = rotatedLocalPoint(gx, gy, gx + 0.5, gy + 0.5, rot);
    var p = project(glp.x, glp.y, 14, camera);
    // the sign's wide spill: the chosen colour undiluted when tinted, and the
    // hue-cycled PANEL tone (col2, not the trim's col) when it is not.
    emit(p.x, p.y, 52 * Math.sqrt(camera.scale || 1), ledTint || col2, 0.18);
    emit(p.x, p.y, 24 * Math.sqrt(camera.scale || 1), col, 0.14);
  };

  // TROPHY RACK — V19 §3. Owner defect: "one of its legs always goes through
  // the table/flat part of it". Two causes, both fixed here:
  //   (a) the legs were drawn AFTER the shelf slab, so at every rotation the
  //       leg's top cap and silhouette painted straight over the shelf's side
  //       faces — a leg visibly punching through the tabletop.
  //   (b) there were only two legs, both pinned to the slab's min-y edge, so
  //       from the back the rack had no support under it at all.
  // Now: four legs, inset inside the slab footprint, drawn FAR-TO-NEAR (depth
  // sorted in rotated space) and BEFORE the slab, so the slab always occludes
  // the leg tops. Leg top z (20) is exactly the slab bottom z — flush, never
  // intersecting.
  var TROPHY_LEG = { top: '#2E3653', left: '#20263E', right: '#151A2C', accent: '#4A5578' };
  var TROPHY_RAIL = { top: '#262E47', left: '#1A2033', right: '#111524', accent: '#3C4664' };
  var TROPHY_SHELF = { top: '#5A4028', left: '#3D2B1A', right: '#291C11', accent: '#7E5C39' };
  var TROPHY_GOLD = { top: '#FFE38A', left: '#FFD54A', right: '#B8912A', accent: '#FFF6CF' };
  var TROPHY_SILVER = { top: '#E6ECF7', left: '#C3CCDD', right: '#8A93A6', accent: '#FFFFFF' };
  var TROPHY_BRONZE = { top: '#E2A164', left: '#C4813F', right: '#8A5626', accent: '#F6CDA1' };
  props.trophy = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var P = detailer(gx, gy, rot, camera);
    // slab footprint: x 0.05..0.95, y 0.28..0.58. Legs sit 0.05 inside it on
    // every side, so no leg edge can ever coincide with a slab edge.
    var LX = [0.10, 0.80], LY = [0.33, 0.48];
    var LW = 0.10, SHELF_Z = 20;
    var legs = [], li, lj;
    for (li = 0; li < 2; li++) {
      for (lj = 0; lj < 2; lj++) {
        var wp = rotatedLocalPoint(gx, gy, gx + LX[li] + LW / 2, gy + LY[lj] + LW / 2, rot);
        legs.push({ x: gx + LX[li], y: gy + LY[lj], d: wp.x + wp.y });
      }
    }
    legs.sort(function (a, b) { return a.d - b.d; }); // far first
    for (li = 0; li < legs.length; li++) {
      box(ctx, legs[li].x, legs[li].y, 0, LW, LW, SHELF_Z, TROPHY_LEG, camera);
    }
    // low stretcher rails tying the legs together, well clear of the shelf
    box(ctx, gx + 0.14, gy + LY[0] + 0.03, 3.5, 0.72, 0.04, 1.2, TROPHY_RAIL, camera);
    box(ctx, gx + 0.14, gy + LY[1] + 0.03, 3.5, 0.72, 0.04, 1.2, TROPHY_RAIL, camera);
    // the shelf slab, drawn last of the structure so it occludes every leg top
    box(ctx, gx + 0.05, gy + 0.28, SHELF_Z, 0.90, 0.30, 2.6, TROPHY_SHELF, camera);
    // a 1px lighter lip along the two front slab edges — reads as a moulded
    // shelf front rather than a plain plank
    var lz = SHELF_Z + 2.6;
    crispStroke(ctx, [P(gx + 0.05, gy + 0.58, lz), P(gx + 0.95, gy + 0.58, lz)], '#7E5C39', false);
    crispStroke(ctx, [P(gx + 0.95, gy + 0.28, lz), P(gx + 0.95, gy + 0.58, lz)], '#7E5C39', false);
    // three trophies of descending rank, each a plinth + stem + cup so they
    // read as trophies and not as yellow sticks
    var mats = [TROPHY_GOLD, TROPHY_SILVER, TROPHY_BRONZE];
    var hs = [9, 6.5, 5];
    var xs = [0.16, 0.44, 0.70];
    for (li = 0; li < 3; li++) {
      var tx = gx + xs[li], ty = gy + 0.38, m = mats[li], h = hs[li];
      box(ctx, tx, ty, lz, 0.15, 0.13, 1.4, TROPHY_SHELF, camera);       // dark plinth
      box(ctx, tx + 0.05, ty + 0.04, lz + 1.4, 0.05, 0.05, h, m, camera); // stem
      box(ctx, tx + 0.01, ty + 0.01, lz + 1.4 + h, 0.13, 0.11, 2.6, m, camera); // cup
      // 1px glare on the cup's top-left corner
      pixRect(ctx, P(tx + 0.02, ty + 0.02, lz + 1.4 + h + 2.6), 0, 1, 1, 1, '#FFFFFF');
    }
  };

  // PIZZA BOX TOWER (was ENERGY DRINK STACK / energy_drink_stack,
  // SPEC-V15-BATCH-A §9 — the game already has three energy-drink items,
  // this needed its own identity). Three flat cardboard boxes stacked with
  // a slightly uneven overhang (nobody stacks pizza boxes perfectly) and a
  // red stripe band on each, through the V15 ramp.
  // V16 §2.2 — PIZZA BOX TOWER. Literal spec palette (top #D09263 with an
  // #EAC2A0 top-left highlight, left #C47B49, right #96542B), 4-5px per box,
  // the MIDDLE box shoved 2 screen-px sideways so the stack reads lived-in
  // rather than machined, a 1px protruding lid lip on the two front edges,
  // a #633418 shadow line cast onto the lid below, a green/red striped lid
  // border, dark side tabs, vent dots and one irregular grease spot.
  var PIZZA_BODY = { top: '#D09263', left: '#C47B49', right: '#96542B', accent: '#EAC2A0' };
  var PIZZA_LIP = { top: '#EAC2A0', left: '#D09263', right: '#A9673A', accent: '#F7DFC6' };
  var PIZZA_SHADOW = '#633418';
  // 2 screen px of pure horizontal travel is dx=+1/16, dy=-1/16 in world
  // units: sx = (x-y)*16 gains 2, sy = (x+y)*8 gains 0. Exactly 2px, no
  // vertical drift, still on the pixel grid.
  var PX2 = 1 / 16;
  props.energy = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var P = detailer(gx, gy, rot, camera);
    var boxH = 5.0, gap = 0.6;
    var W = 0.70;
    var nudgeX = [0, PX2, 0], nudgeY = [0, -PX2, 0];
    for (var i = 0; i < 3; i++) {
      var bx = gx + 0.15 + nudgeX[i], by = gy + 0.15 + nudgeY[i];
      var bz = i * (boxH + gap);
      // the shadow this box casts onto the lid of the one below
      if (i > 0) {
        crispStroke(ctx, [
          P(bx, by + W, bz), P(bx + W, by + W, bz), P(bx + W, by, bz)
        ], PIZZA_SHADOW, false);
      }
      box(ctx, bx, by, bz, W, W, boxH - 1, PIZZA_BODY, camera);
      // 1px protruding lid lip: a marginally wider, very flat slab on top,
      // so the cardboard lid visibly overhangs the box's front-left and
      // front-right edges.
      box(ctx, bx - 0.03, by - 0.03, bz + boxH - 1, W + 0.06, W + 0.06, 1, PIZZA_LIP, camera);

      // ---- printed lid art, all on the pixel grid ---------------------
      // green/red striped border, inset one step from the lid edge
      var z = bz + boxH;
      var e = 0.10;
      var g0 = P(bx + e, by + e, z), g1 = P(bx + W - e, by + e, z);
      var g2 = P(bx + W - e, by + W - e, z), g3 = P(bx + e, by + W - e, z);
      crispStroke(ctx, [g0, g1], '#388E3C', false);
      crispStroke(ctx, [g1, g2], '#D32F2F', false);
      crispStroke(ctx, [g2, g3], '#388E3C', false);
      crispStroke(ctx, [g3, g0], '#D32F2F', false);
      // 6x6 pizza-slice logo dead centre of the lid
      var lp = P(bx + W / 2, by + W / 2, z);
      pixRect(ctx, lp, -3, -3, 6, 3, '#E8B15C');
      pixRect(ctx, lp, -2, 0, 4, 2, '#D9722F');
      pixRect(ctx, lp, -2, -2, 1, 1, '#C0392B');
      pixRect(ctx, lp, 1, -1, 1, 1, '#C0392B');
      // two 1x1 vent dots punched through the lid
      pixRect(ctx, lp, -6, 1, 1, 1, PIZZA_SHADOW);
      pixRect(ctx, lp, 6, -1, 1, 1, PIZZA_SHADOW);
      // one irregular 3x2 grease spot — only on the middle box, so it reads
      // as an accident rather than a repeating decal
      if (i === 1) {
        pixRect(ctx, lp, 2, 3, 3, 2, '#A06030');
        pixRect(ctx, lp, 4, 2, 1, 1, '#A06030');
      }
      // 2px dark side tab on the front-right (max-local-x) face — culled at
      // rot 2/3 where that face is behind the stack (SPEC-V17 §4)
      if (faceVisible('x+', rot)) {
        var tp = P(bx + W, by + W * 0.35, bz + boxH * 0.45);
        pixRect(ctx, tp, -2, 0, 2, 2, PIZZA_SHADOW);
      }
    }
  };

  // Max-energy upgrades (SPEC-V3 §10) — 4 tiers, each a visually distinct
  // standalone prop the player drops anywhere via EDIT ROOM (not singleton —
  // they stack): a can, a minifridge, a full-height fridge, an IV drip stand.
  // V16 §2.2 — FRIDGES (mini + full). Spec palette, literally: off-white body
  // #E2E8F0 top / #CBD5E1 left / #94A3B8 right. Both fridges get a 1px dark
  // door seam with a rubber-gasket accent beside it, a metallic handle with a
  // 1px white glare dot, and scattered 2x2 cyan/pink/yellow magnets. Deliber-
  // ately drawn on the same body material so mini and full read as the same
  // appliance family at two sizes.
  var FRIDGE_BODY = { top: '#E2E8F0', left: '#CBD5E1', right: '#94A3B8', accent: '#F7FAFF' };
  var FRIDGE_DOOR = { top: '#D8E0EC', left: '#C1CBDA', right: '#8A99AE', accent: '#F0F5FF' };
  var FRIDGE_SEAM = '#7C8798';
  var GASKET = '#5A6577';
  var CHROME = { top: '#F2F5FA', left: '#B9C2D0', right: '#7E8899', accent: '#FFFFFF' };
  var MAGNETS = ['#22D3EE', '#F472B6', '#FACC15', '#4ADE80'];

  // fridgeDoor — the shared door treatment both fridge tiers use: seam +
  // gasket + handle + glare dot + magnets, positioned in the door's own
  // local box so it scales between the two sizes without re-authoring.
  function fridgeDoor(ctx, P, x0, y, z0, w, h, seed, doorMat) {
    var splitZ = z0 + h * 0.62;
    // the door panel itself, inset 1 step from the body edge: a rectangle of
    // the slightly-darker door tone with a seam-tint border. Flat, so it
    // never introduces a second black silhouette across the appliance.
    if (doorMat) {
      var i0 = P(x0 + w * 0.06, y, z0 + h * 0.03), i1 = P(x0 + w * 0.94, y, z0 + h * 0.03);
      var i2 = P(x0 + w * 0.94, y, z0 + h * 0.97), i3 = P(x0 + w * 0.06, y, z0 + h * 0.97);
      drawPoly(ctx, [i0, i1, i2, i3], doorMat.left, null);
      crispStroke(ctx, [i0, i1, i2, i3], FRIDGE_SEAM, true);
    }
    // 1px door seam across the full front face, in the body's own tint
    crispStroke(ctx, [P(x0, y, splitZ), P(x0 + w, y, splitZ)], FRIDGE_SEAM, false);
    // rubber gasket: a second, softer line hugging the seam
    crispStroke(ctx, [P(x0, y, splitZ - 0.9), P(x0 + w, y, splitZ - 0.9)], GASKET, false);
    // metallic handle — a vertical bar just inside the right edge of each
    // door, with a 1px white glare dot near its top
    var hx = x0 + w * 0.80;
    var hb = P(hx, y, splitZ + h * 0.06);
    var ht = P(hx, y, splitZ + h * 0.30);
    crispStroke(ctx, [hb, ht], '#8E99AB', false);
    crispStroke(ctx, [{ x: hb.x - 1, y: hb.y }, { x: ht.x - 1, y: ht.y }], '#E7EDF6', false);
    pixRect(ctx, ht, -1, 0, 1, 1, '#FFFFFF');
    var lb = P(hx, y, z0 + h * 0.20), lt = P(hx, y, z0 + h * 0.46);
    crispStroke(ctx, [lb, lt], '#8E99AB', false);
    crispStroke(ctx, [{ x: lb.x - 1, y: lb.y }, { x: lt.x - 1, y: lt.y }], '#E7EDF6', false);
    pixRect(ctx, lt, -1, 0, 1, 1, '#FFFFFF');
    // scattered 2x2 magnets on the upper door
    var rnd = mulberry32(seed);
    for (var m = 0; m < 5; m++) {
      var mx = x0 + w * (0.12 + rnd() * 0.52);
      var mz = splitZ + h * (0.06 + rnd() * 0.30);
      pixRect(ctx, P(mx, y, mz), 0, 0, 2, 2, MAGNETS[m % MAGNETS.length]);
    }
  }

  props.energyUp = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var P = detailer(gx, gy, rot, camera);
    // SPEC-V17 §4 — THE reported bug: "rotate a fridge to the side and you
    // can see its door through its side and back walls." fridgeDoor() paints
    // the whole door treatment onto the body's max-local-y plane; at rot 1
    // that plane is the body's min-x face and at rot 2 its min-y face, both
    // of which the solid body is supposed to be hiding. Nothing depth-tests
    // here, so it painted over the body. Gate it on the face being visible.
    var F = faces(rot);
    if (tier === 0) { // ENERGY DRINK — a single can standing on the floor
      box(ctx, gx + 0.36, gy + 0.38, 0, 0.28, 0.26, 2, { top: '#FF7A6B', left: '#E03A3A', right: '#9E2A34' }, camera);
      box(ctx, gx + 0.35, gy + 0.37, 2, 0.30, 0.28, 9, { top: '#FF6B6B', left: '#FF4B4B', right: '#B03040' }, camera);
      box(ctx, gx + 0.36, gy + 0.38, 11, 0.28, 0.26, 2, { top: '#FFE9A8', left: '#FFD54A', right: '#B79235' }, camera);
      // pull-tab (top face — visible at every rotation) + a 1px glare stripe
      // down the can's lit front edge (front face only)
      pixRect(ctx, P(gx + 0.44, gy + 0.38, 13), 0, 0, 2, 1, '#8E99AB');
      if (F.front) crispStroke(ctx, [P(gx + 0.37, gy + 0.64, 3), P(gx + 0.37, gy + 0.64, 10)], '#FFB0A6', false);
    } else if (tier === 1) { // MINIFRIDGE — waist height, chunky toy proportions
      box(ctx, gx + 0.13, gy + 0.14, 0, 0.66, 0.62, 1.5, { top: '#8A94A8', left: '#6E7789', right: '#4E5666' }, camera); // plinth
      box(ctx, gx + 0.11, gy + 0.12, 1.5, 0.70, 0.66, 21, FRIDGE_BODY, camera);
      // The door is drawn FLUSH on the body's front face rather than as a
      // protruding slab: a proud slab gets its own pure-black silhouette,
      // which cut a hard line straight across the appliance at rot 1/2 and
      // read as a gap rather than a door.
      if (F.front) {
        fridgeDoor(ctx, P, gx + 0.11, gy + 0.78, 2.5, 0.70, 19, 4021, FRIDGE_DOOR);
        var flick1 = 0.7 + 0.3 * Math.sin((time || 0) / 300 + gx);
        crispStroke(ctx, [P(gx + 0.135, gy + 0.78, 3.5), P(gx + 0.135, gy + 0.78, 21)], mulColor('#34d3ff', 0.6 + 0.5 * flick1), false);
      }
    } else if (tier === 2) { // ENERGY DRINK FRIDGE — full height, two doors
      box(ctx, gx + 0.09, gy + 0.11, 0, 0.78, 0.70, 2, { top: '#8A94A8', left: '#6E7789', right: '#4E5666' }, camera);
      box(ctx, gx + 0.07, gy + 0.09, 2, 0.82, 0.74, 34, FRIDGE_BODY, camera);
      if (F.front) {
        fridgeDoor(ctx, P, gx + 0.07, gy + 0.83, 3.5, 0.82, 31, 917, FRIDGE_DOOR);
        var flick2 = 0.7 + 0.3 * Math.sin((time || 0) / 260 + gx * 2);
        crispStroke(ctx, [P(gx + 0.095, gy + 0.83, 4.5), P(gx + 0.095, gy + 0.83, 35)], mulColor('#34d3ff', 0.55 + 0.5 * flick2), false);
      }
      // two cans parked on top
      box(ctx, gx + 0.18, gy + 0.28, 36, 0.14, 0.14, 6, { top: '#FF7A6B', left: '#FF4B4B', right: '#B03040' }, camera);
      box(ctx, gx + 0.40, gy + 0.36, 36, 0.13, 0.13, 5, { top: '#FFE9A8', left: '#FFC93C', right: '#B08A2A' }, camera);
    } else { // ENERGY IV DRIP — a medical stand with a glowing energy bag
      box(ctx, gx + 0.28, gy + 0.50, 0, 0.36, 0.34, 2.5, { top: '#4C5268', left: '#3A3F52', right: '#262A38' }, camera);
      box(ctx, gx + 0.43, gy + 0.43, 2.5, 0.09, 0.09, 38, CHROME, camera);
      box(ctx, gx + 0.28, gy + 0.28, 40.5, 0.38, 0.38, 2.5, CHROME, camera);
      var pulse2 = 0.55 + 0.45 * Math.sin((time || 0) / 420 + gx * 3);
      var bag = mulColor('#ffc93c', 0.75 + 0.35 * pulse2);
      box(ctx, gx + 0.35, gy + 0.35, 28, 0.18, 0.18, 12, { top: mulColor(bag, 1.25), left: bag, right: mulColor(bag, 0.7) }, camera);
      crispStroke(ctx, [P(gx + 0.44, gy + 0.53, 28), P(gx + 0.44, gy + 0.60, 10)], '#C8D2E4', false);
    }
  };

  props.cat = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    box(ctx, gx + 0.12, gy + 0.30, 0, 0.72, 0.50, 2, '#ff4d9d', camera);
    var bob = 1 + Math.sin((time || 0) / 500 + gx) * 0.6;
    box(ctx, gx + 0.30, gy + 0.42, 2 + bob, 0.42, 0.26, 7, '#33343d', camera);
    box(ctx, gx + 0.66, gy + 0.46, 6 + bob, 0.16, 0.16, 9, '#33343d', camera);
    box(ctx, gx + 0.68, gy + 0.60, 13 + bob, 0.05, 0.05, 5, '#33343d', camera);
    box(ctx, gx + 0.78, gy + 0.61, 13 + bob, 0.05, 0.05, 5, '#33343d', camera);
  };

  // ---- V15 items (SPEC-V15-BATCH-A §9/§10) ---------------------------------
  // The batch's first taste of ART-DIRECTION.md: every family below draws
  // through rotatedBoxRamp() (the shared V15 ramp) instead of rotatedBox(),
  // so their outlines and face shading come from ONE place. `regen_footrest`
  // (CIRCULATION FAN) previously had NO propMap entry at all — drawFamily
  // silently no-op'd on it, which is the "renders invisible when placed"
  // bug. Same was quietly true of regen_purifier/regen_standdesk/
  // regen_hyperbaric; all four get real propMap entries below now.

  // CIRCULATION FAN (was ERGONOMIC FOOTREST / regen_footrest) — floor-
  // standing pedestal fan. THE BUG FIX: this id previously mapped to
  // nothing and rendered nothing. Weighted foot + pole + swaying head reads
  // unmistakably as "fan" at 420px, and the gentle sway (time-driven, not
  // rotation-dependent) sells that it's running.
  // V16 §2.2 — STANDING FAN. The head is now a genuinely CIRCULAR cage,
  // Bresenham-rasterised (pixelCircle) so the ring is made of whole pixels
  // rather than an antialiased canvas arc, with 1px dark diagonal grill lines
  // and an implied 3-blade silhouette inside. It does not animate the blades;
  // only the head sways, exactly as the brief allows.
  var FAN_BODY = { top: '#A6B0C8', left: '#8993AD', right: '#5E6784', accent: '#DCE3F2' };
  var FAN_FOOT = { top: '#3D435C', left: '#2C3145', right: '#1B1F2E', accent: '#6A7191' };
  // V19 §1 — the owner's complaint was "the head of the fan moves side to
  // side" and that it looked awful. The oscillation is GONE: no `time` term
  // remains anywhere in this family, so the fan is a completely static object
  // at every rotation. What replaced it is a properly built pedestal fan —
  // chamfered three-step base, a tapered pole with a chrome height collar, a
  // rear motor housing with cooling fins, and a head that is a real grille:
  // an outer chrome bezel, a recessed dark throat, radial spokes, TWO
  // concentric guard rings and a shaded 3-blade rotor behind them.
  var FAN_CHROME = { top: '#E9EEF8', left: '#C2CADC', right: '#8A93A8', accent: '#FFFFFF' };
  props.fan = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var P = detailer(gx, gy, rot, camera);
    var i;

    // ---- weighted base: three stacked slabs, each stepped in, so the
    // silhouette chamfers instead of reading as one dark brick.
    // The middle slab is the BRIGHT one: a fully dark pedestal disappears
    // into the floor at 1:1 and leaves the grille looking like it is hovering
    // unsupported, which is most of what made the old fan "look awful".
    box(ctx, gx + 0.14, gy + 0.26, 0, 0.72, 0.42, 1.1, FAN_FOOT, camera);
    box(ctx, gx + 0.19, gy + 0.29, 1.1, 0.62, 0.36, 1.2, FAN_CHROME, camera);
    box(ctx, gx + 0.25, gy + 0.33, 2.3, 0.50, 0.28, 1.1, FAN_BODY, camera);

    // ---- pole: two segments with a chrome collar between them, which is
    // what actually makes a pedestal fan read as height-adjustable.
    box(ctx, gx + 0.43, gy + 0.42, 3.4, 0.14, 0.14, 6.4, FAN_BODY, camera);
    box(ctx, gx + 0.41, gy + 0.40, 9.8, 0.18, 0.18, 1.4, FAN_CHROME, camera);
    box(ctx, gx + 0.44, gy + 0.43, 11.2, 0.12, 0.12, 5.0, FAN_BODY, camera);

    // ---- motor housing behind the grille, with three 1px cooling fins on
    // whichever side face is currently toward the camera.
    box(ctx, gx + 0.36, gy + 0.32, 15.5, 0.28, 0.20, 9.5, FAN_BODY, camera);
    for (i = 0; i < 3; i++) {
      crispStroke(ctx, [
        P(gx + 0.36, faceY(rot, gy + 0.52, gy + 0.32), 17.4 + i * 2),
        P(gx + 0.64, faceY(rot, gy + 0.52, gy + 0.32), 17.4 + i * 2)
      ], '#4A5270', false);
    }

    // ---- the grille. SPEC-V17 §4: the housing spans y 0.32..0.52, so the
    // grille must sit on whichever of those two faces is toward the camera —
    // a fan reads the same from either side, so hop it with faceY().
    var fanFaceY = faceY(rot, gy + 0.52, gy + 0.32);
    var c = P(gx + 0.50, fanFaceY, 21);

    /* Grille radius (owner report: "the round fan part gets smaller as you
       zoom in and bigger as you zoom out").

       The cause was `Math.sqrt(camera.scale)`. Every other piece of geometry
       in this file goes through project(), which scales LINEARLY with
       camera.scale — so a sqrt term grows slower than the fan's own body as
       you zoom in and faster as you zoom out. The grille was not a fixed size;
       it was a fixed size relative to nothing, drifting against the pole and
       housing it is supposed to be bolted to.

       Fixed by deriving the radius from PROJECTED GEOMETRY instead of from a
       raw scale number: measure the motor housing's own on-screen width (it
       spans gx+0.36..0.64, the same 0.28 the housing box above is drawn with)
       and size the grille from that. It is now a true world-space object —
       linear by construction, and tied to the part it sits on, so the two can
       never drift apart again no matter what the camera does. */
    var hL = P(gx + 0.36, fanFaceY, 21);
    var hR = P(gx + 0.64, fanFaceY, 21);
    var housingPx = Math.sqrt((hR.x - hL.x) * (hR.x - hL.x) + (hR.y - hL.y) * (hR.y - hL.y));
    // 1.10 is not arbitrary: it is the coefficient that reproduces the fan's
    // FAMILIAR size at the starting room's default zoom (the old formula gave
    // R=16 there, and 1.10 * the housing's projected width lands on the same
    // 16). The brief was that the grille drifted with zoom, not that it was
    // the wrong size — so the size players know is preserved and only the
    // drift is removed. A real pedestal cage does overhang its motor by about
    // this much. Floor of 5px keeps it a readable disc at the smallest zoom
    // rather than collapsing to a dot.
    var R = Math.max(5, Math.round(housingPx * 1.10));

    pixelCircle(ctx, c.x, c.y, R + 1, '#000000', '#000000');   // 1px silhouette
    pixelCircle(ctx, c.x, c.y, R, '#F2F6FF', '#20263C');       // chrome bezel + dark throat
    pixelCircle(ctx, c.x, c.y, R - 1, '#9AA4BC', null);        // bezel inner shade

    // rotor: three swept blades, light-on-dark, clipped inside the throat so
    // nothing can spill past the bezel.
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, R - 2, 0, Math.PI * 2);
    ctx.clip();
    var BLADE = ['#B6C0D8', '#98A2BC', '#77819C'];
    for (i = 0; i < 3; i++) {
      var a0 = (i / 3) * Math.PI * 2 - 0.9;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      for (var t = 0; t <= 1.001; t += 0.125) {
        var a = a0 + t * 1.55;
        ctx.lineTo(Math.round(c.x + Math.cos(a) * (R - 2)), Math.round(c.y + Math.sin(a) * (R - 2) * 0.94));
      }
      ctx.closePath();
      ctx.fillStyle = BLADE[i];
      ctx.fill();
    }
    ctx.restore();

    // guard: radial spokes from the hub out to the bezel, then two concentric
    // rings over the top — this is the part that turns a disc into a grille.
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, R - 1, 0, Math.PI * 2);
    ctx.clip();
    for (i = 0; i < 12; i++) {
      var sa = (i / 12) * Math.PI * 2;
      crispStroke(ctx, [
        { x: c.x, y: c.y },
        { x: Math.round(c.x + Math.cos(sa) * R), y: Math.round(c.y + Math.sin(sa) * R * 0.94) }
      ], '#39415F', false);
    }
    ctx.restore();
    pixelCircle(ctx, c.x, c.y, Math.max(3, R - 3), '#4A5474', null);
    pixelCircle(ctx, c.x, c.y, Math.max(5, R - 6), '#4A5474', null);

    // hub cap with a single specular pixel — the only bright point on the head
    pixelCircle(ctx, c.x, c.y, 2, '#000000', '#D6DDEC');
    pixRect(ctx, c, -1, -2, 1, 1, '#FFFFFF');

    // control panel on the base: three speed buttons plus a power light, all
    // on the camera-facing base face.
    var bf = faceY(rot, gy + 0.60, gy + 0.30);
    for (i = 0; i < 3; i++) {
      pixRect(ctx, P(gx + 0.30 + i * 0.10, bf, 1.9), 0, 0, 2, 2, '#8A93A8');
    }
    pixRect(ctx, P(gx + 0.68, bf, 1.9), -1, 0, 2, 2, '#34D3FF');
  };

  // WATER COOLER (was STANDING DESK CONVERTER / regen_standdesk) — cabinet
  // + bottle-on-top, chosen specifically for an instantly readable
  // silhouette (SPEC-V15-BATCH-A §9: "iconic").
  props.cooler = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var cabinet = '#e7ebf5';
    var bottleCap = '#2c3145';
    var bottle = '#8fd8f2';
    var tap = '#3a3f52';
    // cabinet
    box(ctx, gx + 0.20, gy + 0.20, 0, 0.56, 0.50, 16, cabinet, camera);
    // dispense tap — flush inside the cabinet's max-local-x face, so at
    // rot 2/3 (that face round the back) it was painting a floating dark
    // smudge over the cabinet body. Cull it: you are looking at the back of
    // the cooler, which has no tap. (SPEC-V17 §4)
    if (faceVisible('x+', rot)) box(ctx, gx + 0.66, gy + 0.30, 8, 0.10, 0.10, 3, tap, camera);
    // bottle collar the bottle sits in
    box(ctx, gx + 0.28, gy + 0.28, 16, 0.32, 0.26, 2, bottleCap, camera);
    // inverted-jug bottle body — the iconic part of the silhouette
    box(ctx, gx + 0.22, gy + 0.22, 18, 0.44, 0.38, 15, bottle, camera);
    // bottle neck/cap
    box(ctx, gx + 0.35, gy + 0.33, 33, 0.18, 0.16, 3, bottleCap, camera);
  };

  // RECOVERY POD (was HYPERBARIC RECOVERY POD / regen_hyperbaric) — now a
  // 2x1 footprint like a bed (js/data.js). Reuses props.bed's proven
  // anchor-correction trick (SPEC-V12 §2 / footprint/art-alignment fix):
  // rotating a 2-wide shape about a pivot only 0.5 into it translates the
  // whole shape by a tile, so `ox` is pulled back by (frameW-1) at rot
  // 2/3 to re-land on the same two footprint tiles instead of drifting.
  props.recoveryPod = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var shell = '#232c4a';
    var body = '#33406e';
    var glass = '#bfe9ff';
    var trim = '#34d3ff';
    var frameW = 1.9;
    var flipped = (rot === 2 || rot === 3);
    var ox = gx + (flipped ? -(frameW - 1) : 0), oy = gy - 0.05;
    var pulse = 0.5 + 0.5 * Math.sin((time || 0) / 480);
    box(ctx, ox, oy, 0, frameW, 0.9, 6, shell, camera);
    box(ctx, ox + 0.08, oy + 0.08, 6, frameW - 0.16, 0.74, 18, body, camera);
    box(ctx, ox + 0.16, oy + 0.14, 8, frameW - 0.32, 0.62, 14, mulColor(glass, 0.75 + 0.3 * pulse), camera);
    box(ctx, ox + 0.10, oy + 0.10, 24, frameW - 0.20, 0.70, 2, trim, camera);
  };

  // AIR PURIFIER (regen_purifier) — name unchanged, restyled to the V15
  // ramp/outline so all four regen items read as one set (SPEC-V15-BATCH-A
  // §9 bonus item). Tall tower with a pulsing top vent ring.
  props.purifier = function (ctx, gx, gy, tier, camera, time, rot) {
    var box = rotatedBoxRamp(gx, gy, rot);
    var body = '#e7ebf5';
    var grille = '#5c6a8c';
    var slat = '#333a54';
    var vent = '#3ddc84';
    var flick = 0.55 + 0.45 * Math.sin((time || 0) / 520 + gx);
    // Tower occupies y: gy+0.30 .. gy+0.70 (d=0.40) — the grille and its
    // slats sit flush on that front (larger-y) face, poking just past it.
    box(ctx, gx + 0.30, gy + 0.30, 0, 0.40, 0.40, 22, body, camera);
    // SPEC-V17 §4 — grille + slats are skinned onto that front face; at
    // rot 1/2 the face is behind the tower and they showed through it.
    if (faceVisible('y+', rot)) {
      box(ctx, gx + 0.36, gy + 0.665, 4, 0.28, 0.045, 15, grille, camera);
      box(ctx, gx + 0.36, gy + 0.665, 8, 0.28, 0.05, 1, slat, camera);
      box(ctx, gx + 0.36, gy + 0.665, 13, 0.28, 0.05, 1, slat, camera);
    }
    // pulsing green vent ring on top, the "it's actively cleaning" cue
    box(ctx, gx + 0.27, gy + 0.27, 22, 0.46, 0.46, 2, mulColor(vent, 0.8 + 0.4 * flick), camera);
  };

  // drawPackedBox — a placed prop that's been tapped during the moving
  // minigame's PACKING MODE (SPEC-V2 §7) renders as a cardboard crate instead
  // of its normal assembly. `packTime` (a rAF timestamp, same clock as
  // `time`) drives a short pop-in grow animation right after packing; older
  // packs (or a page reloaded mid-move, with no recorded packTime) just draw
  // the settled box.
  function drawPackedBox(ctx, gx, gy, camera, time, packTime) {
    var age = 1;
    if (typeof packTime === 'number') age = clamp01((time - packTime) / 380);
    var eased = 1 - Math.pow(1 - age, 2);
    var hgt = 13 * (0.35 + 0.65 * eased);
    var pop = 1 + (1 - eased) * 0.35;
    var wdt = 0.60 * Math.min(1.2, pop), dep = 0.60 * Math.min(1.2, pop);
    var cx = gx + 0.5 - wdt / 2, cy = gy + 0.5 - dep / 2;
    box(ctx, cx, cy, 0, wdt, dep, hgt, '#c79a5c', camera);
    box(ctx, cx, gy + 0.5 - 0.05, hgt * 0.42, wdt, 0.10, hgt * 0.18, '#8a6238', camera);
    box(ctx, gx + 0.5 - 0.05, cy, 0, 0.10, dep, hgt, '#8a6238', camera);
  }

  /* map every shop item id -> {family, tier} used to render it */
  var propMap = {
    desk_plywood: { family: 'desk', tier: 0 },
    desk_ikea: { family: 'desk', tier: 1 },
    desk_gaming: { family: 'desk', tier: 2 },
    desk_battlestation: { family: 'desk', tier: 3 },

    pc_budget: { family: 'pc', tier: 0 },
    pc_midrange: { family: 'pc', tier: 1 },
    pc_watercooled: { family: 'pc', tier: 2 },
    pc_elite_rig: { family: 'pc', tier: 3 },

    chair_wooden: { family: 'chair', tier: 0 },
    chair_gaming: { family: 'chair', tier: 1 },
    chair_pro_esports: { family: 'chair', tier: 2 },

    // Monitors (SPEC-V5 §5r/§5u) — singleton, own prop now (was baked into pc).
    monitor_basic:   { family: 'monitor', tier: 0 },
    monitor_144hz:   { family: 'monitor', tier: 1 },
    monitor_240oled: { family: 'monitor', tier: 2 },

    poster_team: { family: 'poster', tier: 0 },
    window_blinds: { family: 'poster', tier: 1 },
    plant_succulent: { family: 'plant', tier: 0 },
    rug_pixel: { family: 'rug', tier: 0 },
    lucky_mousepad: { family: 'rug', tier: 1 },
    energy_drink_stack: { family: 'energy', tier: 0 },
    rgb_strip: { family: 'rgb', tier: 0 },
    neon_sign: { family: 'rgb', tier: 1 },
    trophy_shelf: { family: 'trophy', tier: 0 },
    cat_bed: { family: 'cat', tier: 0 },

    // V15 regen items (SPEC-V15-BATCH-A §9/§10) — none of these four had a
    // propMap entry before this batch, which is the whole "regen_footrest
    // renders invisible when placed" bug: drawFamily() below silently
    // no-ops when propMap[id] is missing. All four now resolve to real art.
    regen_footrest:   { family: 'fan', tier: 0 },        // CIRCULATION FAN
    regen_purifier:   { family: 'purifier', tier: 0 },   // AIR PURIFIER
    regen_standdesk:  { family: 'cooler', tier: 0 },     // WATER COOLER
    regen_hyperbaric: { family: 'recoveryPod', tier: 0 }, // RECOVERY POD (2x1)

    // Beds (SPEC-V3 §3) — singleton, tier by bed quality.
    bed_mattress:   { family: 'bed', tier: 0 },
    bed_single:     { family: 'bed', tier: 1 },
    bed_memoryfoam: { family: 'bed', tier: 2 },
    bed_kingsize:   { family: 'bed', tier: 3 },
    bed_cryopod:    { family: 'bed', tier: 4 },

    // V20 windows + blind (SPEC-V20 §1/§3). Same failure mode as the V15
    // regen block above and the reason that note exists: js/data.js shipped
    // all five of these ids with no propMap entry, so drawFamily() no-opped
    // and a bought window or blind rendered as NOTHING in the room. tier
    // selects the rim material (0 = black, 1 = wood); how many wall slots a
    // window spans is NOT encoded here — it comes from
    // State.wallFootprintTiles() at draw time (see props.window's header).
    window_small_black: { family: 'window', tier: 0 },
    window_small_wood:  { family: 'window', tier: 1 },
    window_wide_black:  { family: 'window', tier: 0 },
    window_wide_wood:   { family: 'window', tier: 1 },
    blind_slat:         { family: 'blind',  tier: 0 },

    // Max-energy upgrades (SPEC-V3 §10) — stacking, tier by device.
    energy_can:        { family: 'energyUp', tier: 0 },
    energy_minifridge: { family: 'energyUp', tier: 1 },
    energy_fridge:     { family: 'energyUp', tier: 2 },
    energy_ivdrip:     { family: 'energyUp', tier: 3 }
  };

  // CATEGORY_ORDER — the within-tile draw order renderRoom() sorts by (and
  // hub.js's group ghost derives from). Higher draws later, i.e. in front.
  // SPEC-V20 §1/§3: `window` and `blind` are flat against the wall, so they
  // sort BEHIND every floor prop that shares their tile — a desk parked under
  // a window must occlude it, never the reverse. The blind sits just in front
  // of its own window and behind everything else.
  var CATEGORY_ORDER = {
    room: -1, window: -0.7, blind: -0.6,
    rug: 0, poster: 0, plant: 0, decor: 0, energy: 0,
    // V22 (owner item 4): `pc` sorts BEHIND desk/monitor, not in front of them.
    // The tower shares the desk's tile and stands in its back half; drawing it
    // last put it over the desk edge and the monitor stand at the rotations
    // where their screen boxes meet. Behind is the only order that can be
    // right, because the tower is physically further from the camera.
    desk: 1, chair: 1, bed: 1, pc: 0.5, monitor: 2.5
  };
  // drawOrderFor(def) — CATEGORY_ORDER plus the one rule that cannot be
  // expressed as a category, because LEDs share the `decor` category with
  // posters and trophies: SPEC-V20 §2 requires a `noCollide` LED (rgb_strip /
  // neon_sign) to render flat against the wall/floor BEHIND the furniture on
  // its tile, so its glow reads as spilling out from underneath. `noCollide`
  // on the item def (state.js's own occupancy flag) is the single source for
  // "this is an LED that shares a tile"; this derives from it rather than
  // keeping a second id list here.
  function drawOrderFor(def) {
    if (!def) return 0;
    // V22 (owner item 12): a floor underlay is the lowest thing in the room —
    // it is the surface other props stand ON, so it draws beneath even the
    // LEDs, which already sit behind furniture at -0.9.
    if (def.collideLayer === 'floor') return -1.2;
    if (def.noCollide) return -0.9;
    return CATEGORY_ORDER[def.category] || 0;
  }

  // HIT_ANCHORS (§8 fix): pickProp used to test every prop against the SAME
  // point (tile anchor + 0.45,0.45) regardless of family. That's harmless
  // for props alone on their own tile, but the starting desk+PC (and any
  // singleton pair sharing a tile — see Data.defaultPlaced) sit on the exact
  // same anchor, so their hit-test points were IDENTICAL. pickProp's
  // nearest-match loop only replaces `best` on a strictly-smaller distance,
  // so with two coincident points the earlier one in state.placed always
  // won and the later one could never be tapped — and autoPlaceSingleton
  // (buying an upgraded desk/pc/chair) re-pushes the bought item to the END
  // of `placed`, so which prop ends up "shadowed" flips depending on
  // purchase order. Give each family its own local offset, matching where
  // its geometry actually reads on screen, so overlapping singletons get
  // distinct, always-reachable hit points.
  // bed's hit anchor is an ARRAY, one {dx,dy} per rot (0-3), not a single
  // {dx,dy} run through the generic rotatePoint() below. Reason: bed is the
  // only 2-tile-wide family, and its art (props.bed, above) now pulls the
  // shape back by (frameW-1) at rot 2/3 to stay anchored on the same two
  // footprint tiles instead of drifting — a correction rotatePoint() has no
  // way to know about, since it only rotates a point about the anchor
  // tile's own center. These four points are that same correction baked in
  // — the visual center of the rendered bed at each rot — computed straight
  // from props.bed's geometry (frame center = ox_local + frameW/2,
  // oy_local + depth/2, run through the same rotateRect the art uses).
  var HIT_ANCHORS = {
    desk: { dx: 0.45, dy: 0.72, dz: 12 },
    pc: { dx: 0.88, dy: 0.62, dz: 10 },
    chair: { dx: 0.45, dy: 0.42, dz: 8 },
    bed: [
      { dx: 0.90, dy: 0.35, dz: 10 }, // rot 0
      { dx: 0.65, dy: 0.90, dz: 10 }, // rot 1 (90)
      { dx: 0.90, dy: 0.65, dz: 10 }, // rot 2 (180)
      { dx: 0.35, dy: 0.90, dz: 10 }  // rot 3 (270)
    ],
    monitor: { dx: 0.40, dy: 0.475, dz: 20 },
    // recoveryPod (2x1, SPEC-V15-BATCH-A §9): same per-rot-array approach as
    // bed above and for the same reason — a 2-tile-wide shape's rotated
    // visual center isn't the generic rotatePoint() of one anchor.
    recoveryPod: [
      { dx: 0.90, dy: 0.35, dz: 12 }, // rot 0
      { dx: 0.65, dy: 0.90, dz: 12 }, // rot 1 (90)
      { dx: 0.90, dy: 0.65, dz: 12 }, // rot 2 (180)
      { dx: 0.35, dy: 0.90, dz: 12 }  // rot 3 (270)
    ],
    // SPEC-V20 §1/§3 — wall mounts. Per-rot ARRAYS for the same reason bed
    // and recoveryPod use them: the art is hand-positioned against whichever
    // wall the tile is on rather than spun about the tile centre, so the
    // generic rotatePoint() would put the tap target on the wrong edge. Only
    // rot 0 (y===0 back wall) and rot 1 (x===0 side wall) are reachable —
    // State.wallRotForTile() produces nothing else — but 2/3 are filled in
    // defensively so a legacy save with a stale rot still hit-tests. dz is the
    // vertical mid-point of the frame, chub()-squashed to match the art.
    window: [
      { dx: 0.50, dy: 0.10, dz: 28 },
      { dx: 0.10, dy: 0.50, dz: 28 },
      { dx: 0.50, dy: 0.10, dz: 28 },
      { dx: 0.10, dy: 0.50, dz: 28 }
    ],
    blind: [
      { dx: 0.50, dy: 0.14, dz: 30 },
      { dx: 0.14, dy: 0.50, dz: 30 },
      { dx: 0.50, dy: 0.14, dz: 30 },
      { dx: 0.14, dy: 0.50, dz: 30 }
    ]
  };
  var DEFAULT_HIT_ANCHOR = { dx: 0.45, dy: 0.45, dz: 14 };
  // ROTATING_FAMILIES (SPEC-V11-FIXES §1): every family's art now rotates
  // with `rot` (see the rotatedBox/rotatedDiamond opt-in at the top of every
  // props.* function above — rug is the one geometrically-symmetric case,
  // and it opts in too, since rotating a symmetric shape is a no-op rather
  // than something that needs skipping). This list exists so pickProp()
  // below rotates each family's hit-anchor by the SAME rule its art uses —
  // keep this in lockstep with which props.* functions call
  // rotatedBox/rotatedDiamond. A family drawn un-rotated with its anchor
  // rotated (or vice versa) desyncs the tap target from where the prop
  // actually reads on screen — that exact bug is why this is a single
  // source of truth instead of two independent judgment calls.
  var ROTATING_FAMILIES = {
    desk: 1, chair: 1, pc: 1, monitor: 1, bed: 1,
    plant: 1, poster: 1, rug: 1, rgb: 1, trophy: 1, energy: 1, energyUp: 1, cat: 1,
    fan: 1, cooler: 1, recoveryPod: 1, purifier: 1
  };

  // drawFamily(..., extra) — `extra` (SPEC-V20) is an optional per-instance
  // bag for the handful of props whose art depends on something that is not
  // family+tier: a window's day/night value and wall span, a blind's
  // open/closed flag, and an LED's deferred glow collector. Every other
  // props.* function ignores it, and every existing caller that omits it
  // (hub.js's ghost preview) still gets the same art it always did.
  function drawFamily(ctx, familyId, gx, gy, tier, camera, time, rot, extra) {
    var fn = props[familyId];
    if (!fn) return;
    fn(ctx, gx, gy, tier, camera, time, rot, extra);
  }

  /* ---- room shell: floor + walls + windows ---------------------------------- */
  // jaggedRing — n points on a wobbling ring in tile/wall-local UV space.
  // Used for both damage families (floor cutouts + plaster patches) so the
  // two read as the same hand: irregular, but on a pixel grid once projected.
  function jaggedRing(rnd, n, rMin, rMax) {
    var pts = [], i;
    for (i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var r = rMin + rnd() * (rMax - rMin);
      pts.push({ u: Math.cos(a) * r, v: Math.sin(a) * r });
    }
    return pts;
  }
  function centroid(pts) {
    var cx = 0, cy = 0;
    for (var i = 0; i < pts.length; i++) { cx += pts[i].x; cy += pts[i].y; }
    return { x: cx / pts.length, y: cy / pts.length };
  }

  // edgePass — walk a closed projected polygon and stroke only the edges
  // whose midpoint falls on the requested side of the centroid. This is how
  // both damage textures get their DIRECTIONAL 1px border: the floor cutouts
  // are darkened on their top-left interior (so the hole reads as inset) and
  // the wall patches are cream-lined on their bottom and right (so the torn
  // wallpaper reads as having thickness). SPEC-V16 §2.3.
  function edgePass(ctx, pts, color, side) {
    var c = centroid(pts);
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var keep = side === 'topleft'
        ? (my <= c.y || mx <= c.x)
        : (my >= c.y || mx >= c.x);
      if (keep) crispStroke(ctx, [a, b], color, false);
    }
  }

  var FLOOR_HOLE = '#5A3B30';   // the wood exposed under a basement floor cutout
  var FLOOR_HOLE_DARK = '#3A241C';
  var HOLE_INSET = '#14100F';   // near-black lip on the top-left interior edge

  function drawFloor(ctx, roomTier, camera) {
    var seam = roomTier.floorSeam;
    for (var gx = 0; gx < roomTier.gridW; gx++) {
      for (var gy = 0; gy < roomTier.gridD; gy++) {
        var col = ((gx + gy) % 2 === 0) ? roomTier.floorA : roomTier.floorB;
        var p00 = project(gx, gy, 0, camera);
        var p10 = project(gx + 1, gy, 0, camera);
        var p11 = project(gx + 1, gy + 1, 0, camera);
        var p01 = project(gx, gy + 1, 0, camera);
        var r = rampShade(col);
        // Floors are lit flat, so they take the ramp's LEFT (base) tone, not
        // the top — otherwise every tile out-glows the props standing on it.
        drawPoly(ctx, [p00, p10, p11, p01], col, null);
        // grout / board seams in the tile's own darker tint — internal line
        // art, never black (V16 pass 3).
        var s = r.leftSeam;
        if (seam === 'tile') {
          crispStroke(ctx, [p00, p10], s, false);
          crispStroke(ctx, [p00, p01], s, false);
        } else {
          crispStroke(ctx, [project(gx, gy + 0.5, 0, camera), project(gx + 1, gy + 0.5, 0, camera)], s, false);
          crispStroke(ctx, [p10, p11], s, false);
        }

        if (!roomTier.damaged) continue;
        // ---- BASEMENT ONLY: jagged floor cutouts exposing bare planks ----
        var rnd = mulberry32(((gx * 73856093) ^ (gy * 19349663)) >>> 0);
        if (rnd() > 0.24) continue;
        var ring = jaggedRing(rnd, 7, 0.13, 0.30);
        var cu = 0.5 + (rnd() - 0.5) * 0.2, cv = 0.5 + (rnd() - 0.5) * 0.2;
        var hole = ring.map(function (pt) {
          return project(gx + cu + pt.u, gy + cv + pt.v * 1.0, 0.05, camera);
        });
        drawPoly(ctx, hole, FLOOR_HOLE, null);
        // planks inside the hole, split by 1px dark lines
        ctx.save();
        tracePath(ctx, hole, true); ctx.clip();
        for (var pl = -1; pl <= 1; pl++) {
          crispStroke(ctx, [
            project(gx + cu - 0.5, gy + cv + pl * 0.13, 0.05, camera),
            project(gx + cu + 0.5, gy + cv + pl * 0.13, 0.05, camera)
          ], FLOOR_HOLE_DARK, false);
        }
        ctx.restore();
        // inset depth: dark pixels on the TOP-LEFT interior edge only
        edgePass(ctx, hole, HOLE_INSET, 'topleft');
      }
    }
  }

  function wallQuad(ctx, pts, color) {
    drawPoly(ctx, pts, color, OUTLINE);
  }

  var PLASTER = '#8E7761';   // exposed plaster under peeled wallpaper
  var PLASTER_CREAM = '#E8E2D5'; // the torn wallpaper's own cut edge

  // bilinear point inside a screen-space wall quad
  // (pts: [bottomA, bottomB, topB, topA])
  function quadPoint(pts, u, v) {
    var bx = pts[0].x + (pts[1].x - pts[0].x) * u;
    var by = pts[0].y + (pts[1].y - pts[0].y) * u;
    var tx = pts[3].x + (pts[2].x - pts[3].x) * u;
    var ty = pts[3].y + (pts[2].y - pts[3].y) * u;
    return { x: Math.round(bx + (tx - bx) * v), y: Math.round(by + (ty - by) * v) };
  }

  // Subtle plaster speckle + vertical panel seams, clipped to the wall quad.
  // `pts` go bottom-left, bottom-right, top-right, top-left (screen space).
  function wallTexture(ctx, pts, wallColor, seed, roomTier) {
    ctx.save();
    tracePath(ctx, pts, true);
    ctx.clip();

    var minX = Math.min(pts[0].x, pts[3].x), maxX = Math.max(pts[1].x, pts[2].x);
    var minY = Math.min(pts[2].y, pts[3].y), maxY = Math.max(pts[0].y, pts[1].y);
    var rnd = mulberry32(seed || 7);
    var seamCol = seamOf(wallColor);
    var i, p;

    // panel seams — the wall's own darker tint, crisp 1px, no alpha fade
    // (a half-transparent line cannot land on the pixel grid).
    var panels = 4;
    for (p = 1; p < panels; p++) {
      var u = p / panels;
      crispStroke(ctx, [quadPoint(pts, u, 0), quadPoint(pts, u, 1)], seamCol, false);
    }

    if (roomTier && roomTier.damaged) {
      // ---- BASEMENT ONLY (V16 §2.3) ----------------------------------
      // Jagged peeling-plaster patches. Each is bordered on its BOTTOM and
      // RIGHT edges by a 1px cream line, which is what sells the wallpaper
      // as a physical layer with thickness rather than a paint stain.
      var patches = 5;
      for (i = 0; i < patches; i++) {
        var cu = 0.1 + rnd() * 0.8, cv = 0.15 + rnd() * 0.7;
        var scale = 9 + rnd() * 13;
        var ring = jaggedRing(rnd, 8, 0.55, 1.0);
        var poly = ring.map(function (pt) {
          var q = quadPoint(pts, cu, cv);
          return { x: Math.round(q.x + pt.u * scale), y: Math.round(q.y + pt.v * scale * 0.8) };
        });
        drawPoly(ctx, poly, PLASTER, null);
        // a couple of grime flecks inside so the patch isn't a flat blob
        ctx.fillStyle = mulColor(PLASTER, 0.78);
        for (p = 0; p < 5; p++) {
          var q2 = quadPoint(pts, cu, cv);
          ctx.fillRect(Math.round(q2.x + (rnd() - 0.5) * scale), Math.round(q2.y + (rnd() - 0.5) * scale), 1, 1);
        }
        edgePass(ctx, poly, PLASTER_CREAM, 'bottomright');
      }
      // grime speckle, on the pixel grid
      ctx.fillStyle = mulColor(wallColor, 0.72);
      var speckCount = Math.round(((maxX - minX) * (maxY - minY)) / 260);
      for (i = 0; i < speckCount; i++) {
        ctx.fillRect(Math.round(minX + rnd() * (maxX - minX)), Math.round(minY + rnd() * (maxY - minY)), 1, 1);
      }
    } else if (roomTier) {
      // Every other location is clean. Instead of damage it gets a single
      // 1px accent stripe near the top of the wall — a picture rail / inlay
      // in the location's own accent colour, which is what makes the tier
      // read as more prestigious rather than merely undamaged.
      crispStroke(ctx, [quadPoint(pts, 0, 0.80), quadPoint(pts, 1, 0.80)], roomTier.accent || seamCol, false);
      crispStroke(ctx, [quadPoint(pts, 0, 0.78), quadPoint(pts, 1, 0.78)], seamCol, false);
    }
    ctx.restore();
  }

  // SPEC-V20 §1 — drawWindowAt() and the two `roomTier.windows` loops that
  // called it USED to live here, baking N windows into every wall. Both are
  // deleted: the room shell is now bare wall, and a window is a purchasable
  // wall-mounted prop drawn by props.window (see the WINDOWS block above the
  // prop table). Nothing here draws glass any more.
  function drawWalls(ctx, roomTier, camera) {
    var gridW = roomTier.gridW, gridD = roomTier.gridD;
    var SKIRT_H = 5;
    var trim = roomTier.trimColor || shade(roomTier.wallColor, -0.45);
    var rightPts = [
      project(0, 0, 0, camera), project(gridW, 0, 0, camera),
      project(gridW, 0, WALL_H, camera), project(0, 0, WALL_H, camera)
    ];
    var leftPts = [
      project(0, 0, 0, camera), project(0, gridD, 0, camera),
      project(0, gridD, WALL_H, camera), project(0, 0, WALL_H, camera)
    ];
    var leftCol = shade(roomTier.wallColor, -0.05);
    var rightCol = shade(roomTier.wallColor, -0.30);
    wallQuad(ctx, leftPts, leftCol);
    wallQuad(ctx, rightPts, rightCol);
    wallTexture(ctx, leftPts, leftCol, 11, roomTier);
    wallTexture(ctx, rightPts, rightCol, 23, roomTier);

    // skirting board along the base of each wall, where it meets the floor
    var rightSkirt = [
      project(0, 0, 0, camera), project(gridW, 0, 0, camera),
      project(gridW, 0, SKIRT_H, camera), project(0, 0, SKIRT_H, camera)
    ];
    var leftSkirt = [
      project(0, 0, 0, camera), project(0, gridD, 0, camera),
      project(0, gridD, SKIRT_H, camera), project(0, 0, SKIRT_H, camera)
    ];
    drawPoly(ctx, leftSkirt, shade(trim, -0.05), shade(trim, -0.4));
    drawPoly(ctx, rightSkirt, shade(trim, -0.25), shade(trim, -0.4));
  }

  /* ---- main render entry ----------------------------------------------------- */
  function renderRoom(ctx, canvasW, canvasH, state, opts) {
    opts = opts || {};
    var time = opts.time || 0;
    // dayNightT (SPEC-V3 §2): 0 = day, ramps 0..1 across sunset, 1 = night.
    // Callers pass State.dayPhase().sunsetProgress (or tickEnergy()'s copy of
    // the same field) so the backdrop + room ambient interpolate per frame.
    var dayNightT = typeof opts.sunsetProgress === 'number' ? clamp01(opts.sunsetProgress) : 0;
    var State = window.Game.State;
    var roomVisual = getRoomVisual(state);
    // SPEC-V7 §4: opts.camera lets hub.js's zoom/pan controller override the
    // default fit camera with its own (zoomed/panned) one; every existing
    // caller that doesn't pass it keeps getting the plain fit camera.
    var camera = opts.camera || computeCamera(canvasW, canvasH, roomVisual);

    ctx.clearRect(0, 0, canvasW, canvasH);
    drawBackdrop(ctx, canvasW, canvasH, time, roomVisual.backdrop, dayNightT);

    drawFloor(ctx, roomVisual, camera);
    drawWalls(ctx, roomVisual, camera);

    // SPEC-V12 §2: opts.highlightTile may be a single {x,y} (legacy/1x1
    // callers) OR an array of {x,y} — a footprint prop (bed) passes every
    // tile it would occupy so the drag-hover preview highlights all of them,
    // not just the anchor, matching the ghost preview's footprint-aware
    // highlight in js/hub.js's renderGhost().
    if (opts.editMode && opts.highlightTile) {
      var hTiles = Array.isArray(opts.highlightTile) ? opts.highlightTile : [opts.highlightTile];
      ctx.save();
      ctx.globalAlpha = 0.35;
      for (var hi = 0; hi < hTiles.length; hi++) {
        var ht = hTiles[hi];
        var hp00 = project(ht.x, ht.y, 0.5, camera);
        var hp10 = project(ht.x + 1, ht.y, 0.5, camera);
        var hp11 = project(ht.x + 1, ht.y + 1, 0.5, camera);
        var hp01 = project(ht.x, ht.y + 1, 0.5, camera);
        drawPoly(ctx, [hp00, hp10, hp11, hp01], opts.highlightOk ? '#3ddc84' : '#ff4b4b', '#eaf0ff');
      }
      ctx.restore();
    }

    // Index preserved (not just filtered) — State.packPropAt(index) addresses
    // props by their position in state.placed, so the moving minigame (§7)
    // needs to know which original index each rendered prop corresponds to.
    // SPEC-V17 §2.2: opts.hideIdxs is a list of state.placed indices to skip
    // this frame. hub.js passes the prop (or workstation group) currently in
    // the Moving state, because that one is being drawn separately — lifted
    // off the floor with its own shadow, at its draft tile rather than its
    // settled one. Without this the room paints a second, un-lifted copy at
    // the old tile and the player cannot tell which one they are dragging.
    var hideIdxs = opts.hideIdxs || null;
    var placed = (state.placed || []).map(function (p, idx) {
      return { p: p, idx: idx, def: window.Game.State.findShopItem(p.id) };
    }).filter(function (e) {
      return !!e.def && !(hideIdxs && hideIdxs.indexOf(e.idx) !== -1);
    });

    /* V22b (owner report, with screenshots) — THE TOWER AND THE DESK LEGS.

       The within-tile tiebreak below used to be a CONSTANT per category
       (CATEGORY_ORDER), which cannot be correct for two props that share a
       tile but stand at different depths INSIDE it. props.pc sits in the
       tile's back half (local y ~0.28) and props.desk in the front half
       (~0.74); a workstation rotates as a group, so at rot 0/1 the tower is
       genuinely further from the camera and "behind" is right — but at the
       other two rotations that same local point swings TOWARD the camera and
       the tower is genuinely in front. Painting it behind there made it punch
       through the desk's legs, which is what the owner photographed.

       So the trio's tiebreak is DERIVED from each prop's rotated local centre
       instead of asserted. `subTileDepth` runs the centre through the same
       rotatedLocalPoint() the geometry uses, and x+y is the isometric depth
       axis — the identical rule the outer sort already applies across tiles,
       just resolved one level finer. Nothing hardcodes which rotations flip,
       so this stays correct if the tower or desk is ever moved within a tile.

       The monitor is deliberately NOT included: it sits ON the desk, always
       reads as part of it, and keeping its constant 2.5 stops a stand ever
       being occluded by the desk it rests on. */
    // Local centre-Y of the two props that can swap places within a tile —
    // matching where props.pc and props.desk actually stand (0.10+d/2 and
    // 0.90-d/2 respectively).
    var SHARED_TILE_CENTRE_Y = { pc: 0.28, desk: 0.74 };

    function rotatedDepth(entry, centreY) {
      var r = rotatedLocalPoint(0, 0, 0.5, centreY, entry.rot || 0);
      return r.x + r.y;   // x+y IS the isometric depth axis
    }

    // One pass: remember each tile's desk depth, then key every prop once.
    var deskDepthByTile = {};
    placed.forEach(function (e) {
      if (e.def.category !== 'desk') return;
      deskDepthByTile[e.p.x + ',' + e.p.y] = rotatedDepth(e.p, SHARED_TILE_CENTRE_Y.desk);
    });
    placed.forEach(function (e) {
      var cy = SHARED_TILE_CENTRE_Y[e.def.category];
      if (cy == null || e.def.category === 'desk') { e.order = drawOrderFor(e.def); return; }
      var deskDepth = deskDepthByTile[e.p.x + ',' + e.p.y];
      if (deskDepth == null) { e.order = drawOrderFor(e.def); return; } // lone tower
      // 1.5 = in front of the desk (CATEGORY_ORDER 1), 0.5 = behind it.
      e.order = (rotatedDepth(e.p, cy) > deskDepth) ? 1.5 : 0.5;
    });

    placed.sort(function (a, b) {
      var ka = a.p.x + a.p.y + a.order * 0.01;
      var kb = b.p.x + b.p.y + b.order * 0.01;
      return ka - kb;
    });

    var movingPacked = (state.moving && state.moving.packed) || null;
    var packAnimTimes = opts.packAnimTimes || {};

    var glows = [];
    placed.forEach(function (entry) {
      if (movingPacked && movingPacked.indexOf(entry.idx) !== -1) {
        drawPackedBox(ctx, entry.p.x, entry.p.y, camera, time, packAnimTimes[entry.idx]);
        return;
      }
      var map = propMap[entry.p.id];
      if (!map) return;
      var propRot = entry.p.rot || 0;
      // SPEC-V20 per-instance draw context. `span` is asked of
      // State.wallFootprintTiles() — THE single source of truth for which
      // wall slots a wall-mounted item covers (state.js) — rather than being
      // re-derived from the def's footprint here; `dayNightT` is renderRoom's
      // own already-computed value, not a second read of the clock; `closed`
      // is the placed entry's flag that State.toggleBlind() owns; `glows` is
      // the deferred additive-light list (see the LED note below).
      // SPEC-V21 §7 — the customisation tint. Read through State.itemTint(),
      // the same accessor js/customise.js writes through, so the room can
      // never hold a second opinion about a colour (HANDOFF §9.1). The direct
      // `entry.p.tint` read is a fallback for a State build without the V21
      // exports and touches the identical field, not a mirror of it.
      var tintVal = (State && State.itemTint) ? State.itemTint(entry.idx)
        : (entry.p.tint || null);
      var extra = {
        dayNightT: dayNightT,
        closed: !!entry.p.closed,
        glows: glows,
        span: 1,
        tint: null,
        tintEmissive: false
      };
      if (tintVal) {
        var tctx = tintFor(entry.p.id, tintVal);
        extra.tint = tctx.tint;
        extra.tintEmissive = tctx.tintEmissive;
      }
      if (entry.def.mount === 'wall' && State && State.wallFootprintTiles) {
        extra.span = State.wallFootprintTiles(entry.p.x, entry.p.y, entry.def).length;
      }
      drawFamily(ctx, map.family, entry.p.x, entry.p.y, map.tier, camera, time, propRot, extra);
      // Screen glow moved here from the old PC-drew-its-own-monitor days
      // (SPEC-V5 §5r/§5u split the monitor into its own prop) — the anchor
      // points rotate along with the prop itself via rotatePoint() so the
      // glow still lands right on the (now possibly turned) screen face.
      if (map.family === 'monitor') {
        // Anchors follow props.monitor's own geometry (§10 rewrite) — screen
        // center sits mid-bezel above DESK_TOP_Z now, not floating near the
        // floor the way the old fixed-z monitor did.
        var glowPal = ['#34d3ff', '#3ddc84', '#ff6bd6'];
        var mCol = glowPal[map.tier] || glowPal[0];
        var gpt = rotatePoint(0.50, 0.62, propRot);
        var gp = project(entry.p.x + gpt.lx, entry.p.y + gpt.ly, 25, camera);
        glows.push({ x: gp.x, y: gp.y, color: mCol, r: 22 });
        // warm rim-light kissing the desk surface right below the screen
        var rpt = rotatePoint(0.50, 0.70, propRot);
        var rp = project(entry.p.x + rpt.lx, entry.p.y + rpt.ly, 15, camera);
        glows.push({ x: rp.x, y: rp.y, color: '#ffb347', r: 13, a: 0.09 });
      }
    });

    // display case (unlocked via §5.6) is static room furniture, not a
    // shop-placed prop (not in state.placed) — stays put through the packing
    // minigame. The bed (SPEC-V3 §3) is now a REAL placed prop (see
    // Data.defaultPlaced / State.buyItem's autoPlaceSingleton) and is drawn
    // by the placed-props loop above via propMap, so there's no separate
    // hardcoded bed draw here any more.
    if (state.displayCase && state.displayCase.items && state.displayCase.items.length > 0) {
      props.displayCase(ctx, 0.2, roomVisual.gridD - 1.0, state.displayCase.items.length, camera);
    }

    // glow radius scales sub-linearly with camera zoom so bigger rooms/tiers
    // don't get flooded with additive light bleed.
    // `raw` entries (the LED spill pushed by props.rgb, SPEC-V20 §2) already
    // carry their own camera-scaled radius and opt out of this second scaling.
    var glowScale = Math.sqrt(camera.scale) * 1.55;
    glows.forEach(function (g) {
      glow(ctx, g.x, g.y, (g.r || 30) * (g.raw ? 1 : glowScale), g.color, g.a || 0.13);
    });

    // Whole-scene color grade tying the room's own lighting to the backdrop's
    // day/night state (§2) — applied last so it unifies backdrop + floor +
    // walls + props + glows into one consistent moment of the day.
    ambientOverlay(ctx, canvasW, canvasH, dayNightT);

    // SPEC-V20 §3 — CLOSED BLINDS DARKEN THE ROOM. The coverage rule ("every
    // wall tile of every placed window also holds a CLOSED blind, and owning
    // zero windows never counts") is state.js's, and State.blindsBonusActive()
    // is its single export — this calls it rather than re-deriving coverage
    // here, because a second copy of a rule is the pattern that has produced
    // a user-visible bug in this project four separate times (HANDOFF §9.1).
    // Deliberately AFTER ambientOverlay: this is the room being shaded from
    // the outside light, so it stacks on top of the time-of-day grade instead
    // of being washed back out by it. Cool and desaturating, not just dimmer,
    // and eased by daylight — blinds do most of their work at noon.
    if (State && State.blindsBonusActive && State.blindsBonusActive()) {
      ctx.save();
      ctx.globalAlpha = 0.34 - 0.14 * dayNightT;
      ctx.fillStyle = '#0d1230';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }

    return camera;
  }

  function pickProp(state, canvasW, canvasH, screenX, screenY, cameraOverride) {
    var roomVisual = getRoomVisual(state);
    // SPEC-V7 §4: cameraOverride lets hub.js hit-test against its current
    // zoomed/panned camera instead of always the default fit one.
    var camera = cameraOverride || computeCamera(canvasW, canvasH, roomVisual);
    var best = null, bestDist = Infinity, bestIdx = -1;
    var threshold = 36 * camera.scale;
    (state.placed || []).forEach(function (p, idx) {
      var map = propMap[p.id];
      var anchorRaw = (map && HIT_ANCHORS[map.family]) || DEFAULT_HIT_ANCHOR;
      // bed's entry is a pre-rotated array (one {dx,dy,dz} per rot) — see
      // the comment on HIT_ANCHORS above — so it's indexed directly instead
      // of going through the generic rotatePoint() below.
      var anchor = Array.isArray(anchorRaw) ? (anchorRaw[p.rot || 0] || anchorRaw[0]) : anchorRaw;
      // Rotate the hit-anchor along with the prop itself (SPEC-V5 §5u,
      // extended to every family by SPEC-V11-FIXES §1) — but ONLY for
      // families whose art actually rotates, per ROTATING_FAMILIES; a family
      // drawn un-rotated with its anchor rotated (or vice versa) would offset
      // the tap target from where it visually sits. Today that list is every
      // family, since every props.* function now opts into rotatedBox/
      // rotatedDiamond — but the guard stays generic rather than assuming
      // "always true", so a future non-rotating family (if one's ever added)
      // only has to skip ROTATING_FAMILIES, not this logic too. Array-valued
      // anchors (bed) are already per-rot, so they skip this rotation too.
      var rotates = map && ROTATING_FAMILIES[map.family] && !Array.isArray(anchorRaw);
      var rp = rotates ? rotatePoint(anchor.dx, anchor.dy, p.rot || 0) : { lx: anchor.dx, ly: anchor.dy };
      var pt = project(p.x + rp.lx, p.y + rp.ly, anchor.dz, camera);
      var dist = Math.hypot(pt.x - screenX, pt.y - screenY);
      // SPEC-V12 §2: a multi-tile prop (currently only bed) reads as wide as
      // its whole footprint on screen, so a tap landing on its SECOND (or
      // later) tile must still hit it — HIT_ANCHORS above is tuned only for
      // the anchor tile. window.Game.State.footprintTiles is the single
      // footprint source (state.js, SPEC-V12 §3); falls back to just the
      // anchor tile if State isn't available yet (defensive, partial load).
      var footprint = (window.Game.State && window.Game.State.footprintTiles && window.Game.State.findShopItem) ?
        window.Game.State.footprintTiles(window.Game.State.findShopItem(p.id), p.x, p.y, p.rot || 0) : [{ x: p.x, y: p.y }];
      for (var fi = 1; fi < footprint.length; fi++) {
        var ftile = footprint[fi];
        var fpt = project(ftile.x + 0.5, ftile.y + 0.5, anchor.dz, camera);
        var fdist = Math.hypot(fpt.x - screenX, fpt.y - screenY);
        if (fdist < dist) dist = fdist;
      }
      if (dist < threshold && dist < bestDist) { bestDist = dist; best = p; bestIdx = idx; }
    });
    if (!best) return null;
    return { x: best.x, y: best.y, id: best.id, rot: best.rot, idx: bestIdx };
  }

  // renderPropIcon(canvas, itemId, opts) — takes a CANVAS, not a ctx.
  // `opts` (optional): { tint } paints the icon in a customisation colour.
  // Omitted, an icon is always FACTORY finish, which is what the shop card
  // wants — the shop sells the undyed item. The parameter exists so a caller
  // that already knows a placed item's tint (a customise preview, a headless
  // pixel check) can render the same art the room renders, through the one
  // tintFor() path renderRoom uses, instead of re-deriving the family.
  function renderPropIcon(canvas, itemId, opts) {
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var map = propMap[itemId];
    var State = window.Game.State;
    var tctx = tintFor(itemId, opts && opts.tint);

    // SPEC-V20 §1/§3 — WALL MOUNTS NEED THEIR OWN FIT. Every floor prop lives
    // in the bottom of its tile and fits the shared camera below; a window is
    // 39 world-units tall hanging off the wall, so on the shared camera it
    // projects clean off the top of a 56px card. These two families (and only
    // these two — no existing icon changes by a pixel) get a camera fitted to
    // where their art actually sits: the frame's own visual centre, placed at
    // the middle of the card, scaled so a 2-tile window still fits.
    var isWall = map && (map.family === 'window' || map.family === 'blind');
    if (isWall) {
      // span through the same State.wallFootprintTiles() export renderRoom
      // uses, asked of a back-wall anchor — never a second reading of the
      // def's own footprint field.
      var def = State && State.findShopItem ? State.findShopItem(itemId) : null;
      var span = (def && State.wallFootprintTiles) ? State.wallFootprintTiles(0, 0, def).length : 1;
      var scale = span > 1 ? 0.95 : 1.15;
      // the art's centre in unscaled iso space, at tile origin (-0.5,-0.5):
      var cx = (span / 2 - 0.05) * HW;
      var cy = (span / 2 - 0.95) * HH - ((WIN_Z_BOT + WIN_Z_TOP) / 2) * VSCALE;
      var wcam = { ox: Math.round(w / 2 - cx * scale), oy: Math.round(h * 0.52 - cy * scale), scale: scale };
      // dayNightT 0.10 = late morning: the shop should sell the bright pane.
      // A blind previews CLOSED, which is the state that unmistakably reads
      // as a blind rather than as a bare head rail.
      drawFamily(ctx, map.family, -0.5, -0.5, map.tier, wcam, 0, 0, {
        dayNightT: 0.10, span: span, closed: true, spill: false,
        tint: tctx.tint, tintEmissive: tctx.tintEmissive
      });
      return;
    }

    var camera = { ox: w / 2, oy: h * 0.66 };
    diamond(ctx, -0.5, -0.5, 0, 1, 1, '#1b2140', camera);
    // `extra` is passed only to carry the tint; every field a floor prop reads
    // (glows, closed, span) is deliberately absent, so an untinted icon is
    // byte-identical to the pre-V21 two-argument call.
    if (map) {
      drawFamily(ctx, map.family, -0.5, -0.5, map.tier, camera, 0, 0,
        { tint: tctx.tint, tintEmissive: tctx.tintEmissive });
    }
  }

  window.Game = window.Game || {};
  window.Game.Iso = {
    TILE_W: TILE_W, TILE_H: TILE_H,
    iso: iso,
    shade: shade,
    hslToHex: hslToHex,
    box: box,
    // V15 shading ramp (ART-DIRECTION.md §2.2) — rampShade(hex) returns
    // {top,left,right,outline}; boxRamp(...) is box() drawn through it.
    // Later art passes adopt these instead of box()/shade() per prop.
    rampShade: rampShade,
    seamOf: seamOf,
    crispStroke: crispStroke,
    isoLine: isoLine,
    isoDot: isoDot,
    boxRamp: boxRamp,
    diamond: diamond,
    glow: glow,
    project: project,
    computeCamera: computeCamera,
    screenToGrid: screenToGrid,
    getRoomVisual: getRoomVisual,
    renderRoom: renderRoom,
    pickProp: pickProp,
    renderPropIcon: renderPropIcon,
    drawTravelTransition: drawTravelTransition,
    drawFamily: drawFamily,
    rotatePoint: rotatePoint,
    propMap: propMap,
    props: props,
    // CATEGORY_ORDER (SPEC-V13 §3B): exported so hub.js's group-draft ghost
    // preview can draw a moving workstation's members in the SAME desk ->
    // pc -> monitor order renderRoom() already draws a settled one, instead
    // of hardcoding a second copy of that order there.
    CATEGORY_ORDER: CATEGORY_ORDER
  };
})();
