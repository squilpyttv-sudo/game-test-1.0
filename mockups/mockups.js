/* ==========================================================================
   CS2 PRO SIMULATOR — mockup gallery engine
   Self-contained. Draws the isometric room art (SPEC.md §2) on <canvas>.
   Everything else in the gallery is plain HTML/CSS authored in index.html.
   ========================================================================== */

(function () {
  "use strict";

  /* ---- palette (mirrors css/tokens.css — keep values identical) -------- */
  var P = {
    bgSpace:  "#070a16",
    bgDeep:   "#0d1226",
    panel:    "#1b2140",
    panelHi:  "#2a3260",
    panelLo:  "#121734",
    border:   "#3d4a80",
    borderHi: "#6b7ac4",
    ink:      "#eaf0ff",
    inkDim:   "#97a3d0",
    cash:     "#3ddc84",
    views:    "#34d3ff",
    subs:     "#ff4d9d",
    energy:   "#ffc93c",
    elo:      "#ff8a1f",
    danger:   "#ff4b4b",
    gold:     "#ffd54a",
    rConsumer:   "#b0c3d9",
    rMilspec:    "#4b69ff",
    rRestricted: "#8847ff",
    rClassified: "#d32ce6",
    rCovert:     "#eb4b4b",
    rRare:       "#ffd700",
    wood:     "#8a6a4a",
    woodDk:   "#5c4632",
    skin:     "#e0a878",
    denim:    "#3a4f7a",
    jersey:   "#3355e6"
  };

  /* ---- iso projection (SPEC §2 — exact constants, do not change) ------- */
  function iso(x, y, z) {
    return { sx: (x - y) * 16, sy: (x + y) * 8 - z };
  }

  function hexToRgb(hex) {
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
    var num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
  function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }
  function toHex(r, g, b) {
    return "#" + [r, g, b].map(function (v) {
      return clamp255(v).toString(16).padStart(2, "0");
    }).join("");
  }
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
    return toHex(r, g, b);
  }

  /* ---- low-level poly / box drawing ------------------------------------ */
  function poly(ctx, pts, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // box(ctx, ox, oy, x, y, z, w, d, h, color) — one shaded cuboid.
  function box(ctx, ox, oy, x, y, z, w, d, h, color) {
    function pt(gx, gy, gz) {
      var p = iso(gx, gy, gz);
      return [p.sx + ox, p.sy + oy];
    }
    var T1 = pt(x, y, z + h), T2 = pt(x + w, y, z + h),
        T3 = pt(x + w, y + d, z + h), T4 = pt(x, y + d, z + h);
    var B1 = pt(x, y, z), B3 = pt(x + w, y + d, z), B4 = pt(x, y + d, z);

    var top = shade(color, 0.22);
    var left = color;
    var right = shade(color, -0.28);

    poly(ctx, [B4, B3, T3, T4], right, shade(right, -0.35));
    poly(ctx, [B1, B4, T4, T1], left, shade(left, -0.35));
    poly(ctx, [T1, T2, T3, T4], top, shade(top, -0.35));
  }

  /* ---- flat quad on a wall plane (posters, screens, shelves) ----------- */
  function quad(ctx, ox, oy, p1, p2, p3, p4, color, strokeColor) {
    function pt(p) { var i = iso(p[0], p[1], p[2]); return [i.sx + ox, i.sy + oy]; }
    poly(ctx, [pt(p1), pt(p2), pt(p3), pt(p4)], color, strokeColor || shade(color, -0.35));
  }

  /* ---- radial additive glow --------------------------------------------- */
  function glow(ctx, sx, sy, radius, color, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
    g.addColorStop(0, hexA(color, alpha));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  function hexA(hex, a) {
    var c = hexToRgb(hex);
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
  }

  /* ---- floor: diamond of tiles with a subtle checker -------------------- */
  function drawFloor(ctx, ox, oy, grid, tier) {
    var a = tier >= 2 ? "#171d3c" : tier === 1 ? "#141a38" : "#111631";
    var b = shade(a, tier >= 2 ? 0.10 : 0.07);
    for (var gx = 0; gx < grid; gx++) {
      for (var gy = 0; gy < grid; gy++) {
        var c = (gx + gy) % 2 === 0 ? a : b;
        function pt(x, y) { var i = iso(x, y, 0); return [i.sx + ox, i.sy + oy]; }
        poly(ctx, [pt(gx, gy), pt(gx + 1, gy), pt(gx + 1, gy + 1), pt(gx, gy + 1)], c, shade(c, -0.25));
      }
    }
  }

  /* ---- two back walls ---------------------------------------------------- */
  function drawWalls(ctx, ox, oy, grid, wallH, tier) {
    function pt(x, y, z) { var i = iso(x, y, z); return [i.sx + ox, i.sy + oy]; }
    var baseL = tier >= 2 ? "#242c58" : tier === 1 ? "#1f2650" : "#1a2044";
    var baseR = shade(baseL, -0.16);

    // left wall: plane y = 0
    poly(ctx, [pt(0, 0, 0), pt(grid, 0, 0), pt(grid, 0, wallH), pt(0, 0, wallH)], baseL, shade(baseL, -0.3));
    // right wall: plane x = 0
    poly(ctx, [pt(0, 0, 0), pt(0, grid, 0), pt(0, grid, wallH), pt(0, 0, wallH)], baseR, shade(baseR, -0.3));

    // skirting / floor trim
    var trim = shade(baseL, -0.35);
    poly(ctx, [pt(0, 0, 0), pt(grid, 0, 0), pt(grid, 0, 6), pt(0, 0, 6)], trim);
    poly(ctx, [pt(0, 0, 0), pt(0, grid, 0), pt(0, grid, 6), pt(0, 0, 6)], shade(trim, -0.1));

    // ceiling strip light (tier 2 only) — thin glowing bar along the back corner
    if (tier >= 2) {
      var lp = [pt(0.4, 0.4, wallH - 4), pt(grid - 0.4, 0.4, wallH - 4),
                pt(grid - 0.4, 0.4, wallH - 1), pt(0.4, 0.4, wallH - 1)];
      poly(ctx, lp, P.views, shade(P.views, -0.2));
    }
  }

  /* ---- stars backdrop ----------------------------------------------------- */
  function drawStars(ctx, w, h, seed) {
    ctx.fillStyle = P.bgSpace;
    ctx.fillRect(0, 0, w, h);
    var rnd = mulberry32(seed || 7);
    ctx.fillStyle = "#ffffff";
    for (var i = 0; i < 70; i++) {
      var x = rnd() * w, y = rnd() * h * 0.55, r = rnd() < 0.15 ? 1.6 : 0.8;
      ctx.globalAlpha = 0.25 + rnd() * 0.55;
      ctx.fillRect(x, y, r, r);
    }
    ctx.globalAlpha = 1;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ======================================================================
     PROP FACTORIES — each returns an array of {x,y,z,w,d,h,color} boxes,
     in a *local* coordinate frame. Use place() to offset into the room.
     ====================================================================== */

  function place(boxes, px, py, pz) {
    return boxes.map(function (b) {
      return { x: b.x + px, y: b.y + py, z: b.z + (pz || 0), w: b.w, d: b.d, h: b.h, color: b.color };
    });
  }
  // rotate a prop's footprint 90° (swap x/y, w/d) so it can sit flush
  // against the other back wall — every factory below is authored with
  // its "length" along local x (i.e. built to sit against the y=0 wall).
  function rot90(boxes) {
    return boxes.map(function (b) {
      return { x: b.y, y: b.x, z: b.z, w: b.d, d: b.w, h: b.h, color: b.color };
    });
  }

  function deskProp(tier) {
    var top = tier >= 2 ? "#2a3260" : tier === 1 ? "#3a4370" : P.wood;
    var leg = shade(top, -0.45);
    return [
      { x: 0.05, y: 0.1, z: 0, w: 0.22, d: 0.22, h: 12, color: leg },
      { x: 2.58, y: 0.1, z: 0, w: 0.22, d: 0.22, h: 12, color: leg },
      { x: 0.05, y: 1.0, z: 0, w: 0.22, d: 0.22, h: 12, color: leg },
      { x: 2.58, y: 1.0, z: 0, w: 0.22, d: 0.22, h: 12, color: leg },
      { x: -0.2, y: -0.15, z: 12, w: 3.2, d: 1.5, h: 3.4, color: top }
    ];
  }

  function monitorProp(color) {
    var stand = shade(P.panelLo, 0);
    return [
      { x: 0.18, y: 0.32, z: 0, w: 0.18, d: 0.18, h: 4, color: stand },
      { x: -0.02, y: 0.1, z: 4, w: 0.6, d: 0.15, h: 9, color: "#0c0f1e" },
      { x: -0.06, y: 0.02, z: 4.3, w: 0.68, d: 0.06, h: 8.4, color: color }
    ];
  }

  function pcTowerProp(rgb) {
    return [
      { x: 0, y: 0, z: 0, w: 0.85, d: 0.75, h: 3.6, color: "#12162c" },
      { x: -0.05, y: -0.08, z: 0.35, w: 0.12, d: 0.12, h: 2.6, color: rgb },
      { x: 0.78, y: -0.08, z: 0.35, w: 0.12, d: 0.12, h: 2.6, color: rgb },
      { x: 0.08, y: -0.09, z: 1.4, w: 0.65, d: 0.1, h: 0.7, color: shade(rgb, 0.25) },
      { x: 0.08, y: -0.09, z: 2.5, w: 0.65, d: 0.1, h: 0.45, color: shade(rgb, 0.25) }
    ];
  }

  function chairProp(tier) {
    var fab = tier >= 2 ? P.danger : tier === 1 ? P.elo : "#565f8f";
    var frame = "#14182c";
    return [
      { x: 0.05, y: 0.05, z: 0, w: 0.08, d: 0.08, h: 5, color: frame },
      { x: 0.62, y: 0.05, z: 0, w: 0.08, d: 0.08, h: 5, color: frame },
      { x: 0.05, y: 0.62, z: 0, w: 0.08, d: 0.08, h: 5, color: frame },
      { x: 0.62, y: 0.62, z: 0, w: 0.08, d: 0.08, h: 5, color: frame },
      { x: -0.05, y: -0.05, z: 5, w: 0.85, d: 0.85, h: 1.4, color: fab },
      { x: -0.05, y: 0.55, z: 6.2, w: 0.85, d: 0.25, h: 7.5, color: fab },
      { x: -0.05, y: 0.55, z: 13, w: 0.85, d: 0.25, h: 1.6, color: shade(fab, 0.3) }
    ];
  }

  function bedProp(tier) {
    var frame = tier >= 2 ? "#242c54" : "#3a3428";
    var mattress = tier >= 2 ? "#4a5490" : "#7a7460";
    var pillow = tier >= 2 ? P.ink : "#c9c2a8";
    return [
      { x: 0, y: 0, z: 0, w: 3.4, d: 1.8, h: 3, color: frame },
      { x: 0.06, y: 0.06, z: 3, w: 3.28, d: 1.68, h: 1.6, color: mattress },
      { x: 0.16, y: 0.16, z: 4.6, w: 0.7, d: 1.4, h: 0.9, color: pillow },
      { x: -0.12, y: -0.12, z: 0, w: 0.2, d: 0.2, h: 4.4, color: shade(frame, -0.3) },
      { x: 3.32, y: -0.12, z: 0, w: 0.2, d: 0.2, h: 4.4, color: shade(frame, -0.3) }
    ];
  }

  function plantProp() {
    return [
      { x: 0, y: 0, z: 0, w: 0.65, d: 0.65, h: 1.8, color: "#6b5138" },
      { x: 0.18, y: 0.18, z: 1.8, w: 0.3, d: 0.3, h: 2.6, color: "#3f6b3a" },
      { x: -0.15, y: 0.05, z: 3.4, w: 0.85, d: 0.6, h: 2.4, color: "#4f9946" },
      { x: 0.1, y: -0.15, z: 4.6, w: 0.6, d: 0.85, h: 2.0, color: "#66b858" },
      { x: 0.02, y: 0.28, z: 5.6, w: 0.55, d: 0.5, h: 1.6, color: "#7bcf68" }
    ];
  }

  function displayCaseProp(rare) {
    return [
      { x: 0, y: 0, z: 0, w: 1.1, d: 0.65, h: 6.5, color: "#242c58" },
      { x: 0.06, y: 0.06, z: 6.5, w: 0.98, d: 0.53, h: 0.6, color: shade("#242c58", 0.3) },
      { x: 0.14, y: 0.13, z: 7.1, w: 0.82, d: 0.4, h: 4.2, color: "#3a4a7a" },
      { x: 0.45, y: 0.24, z: 7.6, w: 0.22, d: 0.18, h: 3.2, color: rare || P.rRare }
    ];
  }

  function trophyShelfProp() {
    return [
      { x: 0, y: 0, z: 0, w: 3.6, d: 0.3, h: 0.4, color: "#3a3050" },
      { x: 0.2, y: 0.03, z: 0.4, w: 0.34, d: 0.2, h: 1.4, color: P.gold },
      { x: 0.9, y: 0.03, z: 0.4, w: 0.3, d: 0.2, h: 1.1, color: "#c8ccd8" },
      { x: 1.55, y: 0.03, z: 0.4, w: 0.3, d: 0.2, h: 1.6, color: P.gold },
      { x: 2.25, y: 0.03, z: 0.4, w: 0.3, d: 0.2, h: 1.0, color: "#d38a4a" },
      { x: 2.9, y: 0.03, z: 0.4, w: 0.34, d: 0.2, h: 1.3, color: P.gold }
    ];
  }

  // seated figure — placed with pz = chair-seat top height, so it drops
  // straight onto the chair prop below it.
  function characterSeatedProp() {
    return [
      { x: 0.03, y: 0.05, z: 0, w: 0.78, d: 0.6, h: 1.8, color: "#171b34" },   // lap / thighs
      { x: 0.1, y: 0.12, z: 1.7, w: 0.6, d: 0.4, h: 3.6, color: P.jersey },    // torso
      { x: -0.08, y: 0.14, z: 2.6, w: 0.2, d: 0.2, h: 2.0, color: P.jersey }, // left arm
      { x: 0.68, y: 0.14, z: 2.6, w: 0.2, d: 0.2, h: 2.0, color: P.jersey },  // right arm
      { x: 0.18, y: 0.16, z: 5.1, w: 0.44, d: 0.32, h: 1.5, color: P.skin }, // head
      { x: 0.14, y: 0.1, z: 6.5, w: 0.52, d: 0.42, h: 0.4, color: P.jersey } // cap
    ];
  }

  /* ---- poster (flat quad on right wall x=0) ----------------------------- */
  function drawPoster(ctx, ox, oy, y0, z0, w, h, color, accent) {
    quad(ctx, ox, oy, [0.02, y0, z0], [0.02, y0 + w, z0], [0.02, y0 + w, z0 + h], [0.02, y0, z0 + h], color);
    quad(ctx, ox, oy, [0.03, y0 + w * 0.15, z0 + h * 0.55], [0.03, y0 + w * 0.85, z0 + h * 0.55],
      [0.03, y0 + w * 0.85, z0 + h * 0.85], [0.03, y0 + w * 0.15, z0 + h * 0.85], accent);
  }
  function drawTeamCrest(ctx, ox, oy, x0, z0, w, h, color) {
    quad(ctx, ox, oy, [x0, 0.02, z0], [x0 + w, 0.02, z0], [x0 + w, 0.02, z0 + h], [x0, 0.02, z0 + h], color);
  }

  /* ======================================================================
     ROOM SCENE COMPOSER
     ====================================================================== */
  function drawRoom(canvas, opts) {
    var ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    var w = canvas.width, h = canvas.height;
    var tier = opts.tier, grid = opts.grid, wallH = opts.wallH, scale = opts.scale;
    var ox = opts.ox !== undefined ? opts.ox : w / 2;
    var oy = opts.oy !== undefined ? opts.oy : 60;

    drawStars(ctx, w, h, opts.seed || 3);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    var lox = 0, loy = 0;

    drawWalls(ctx, lox, loy, grid, wallH, tier);

    // wall decor
    if (tier >= 0) {
      drawPoster(ctx, lox, loy, grid - 3.4, wallH - 12, 2.4, 7, tier >= 2 ? "#1c2450" : "#2a2440", P.danger);
      drawTeamCrest(ctx, lox, loy, grid - 3.0, wallH - 11, 2, 6, tier >= 1 ? P.views : "#403a2c");
    }
    if (tier >= 1) {
      drawPoster(ctx, lox, loy, 0.6, wallH - 13, 2.2, 8, "#241a3a", P.gold);
    }
    if (tier >= 2) {
      drawTeamCrest(ctx, lox, loy, 0.5, wallH - 12, 1.8, 6.5, P.subs);
      // trophy shelf mounted high on the y=0 wall, past the desk cluster
      var shelf = trophyShelfProp();
      var sb = place(shelf, grid - 4.0, 0.05, wallH - 16);
      sb.forEach(function (b) { box(ctx, lox, loy, b.x, b.y, b.z, b.w, b.d, b.h, b.color); });
    }

    drawFloor(ctx, lox, loy, grid, tier);

    var boxes = [];

    // ---- desk cluster, flush against the y=0 wall, offset along it so it
    // clears the back corner (shared with the bed cluster on the other wall)
    var deskX = grid * 0.2, deskY = 0.35;
    var deskTopZ = 15.4;
    boxes = boxes.concat(place(deskProp(tier), deskX, deskY, 0));

    var monColor = tier >= 2 ? P.subs : tier === 1 ? P.views : "#4a90c8";
    boxes = boxes.concat(place(monitorProp(monColor), deskX + 0.15, deskY + 0.25, deskTopZ));
    boxes = boxes.concat(place(monitorProp(monColor), deskX + 1.35, deskY + 0.25, deskTopZ));

    // PC tower beyond the far end of the desk, clear of the chair — clamp
    // so it never falls off a small (tier-0, cramped) floor
    var pcX = Math.min(deskX + 3.7, grid - 0.95);
    boxes = boxes.concat(place(pcTowerProp(tier >= 1 ? P.subs : P.views), pcX, deskY + 0.2, 0));

    // chair centered in front of the monitors, character seated on top of it
    var chairX = deskX + 0.85, chairY = deskY + 2.15;
    boxes = boxes.concat(place(chairProp(tier), chairX, chairY, 0));
    if (opts.character) {
      boxes = boxes.concat(place(characterSeatedProp(), chairX + 0.03, chairY - 0.05, 6.4));
    }

    // low rug under the desk cluster for grounding
    (function () {
      function pt(x, y) { var i = iso(x, y, 0.05); return [i.sx + lox, i.sy + loy]; }
      var rc = tier >= 2 ? "#1b2450" : "#171c3c";
      poly(ctx, [pt(deskX - 0.5, deskY - 0.3), pt(deskX + 3.6, deskY - 0.3),
                 pt(deskX + 3.6, deskY + 2.4), pt(deskX - 0.5, deskY + 2.4)], rc);
    })();

    // ---- bed, flush against the x=0 wall (rotated), offset away from the
    // shared back corner so it doesn't crowd the desk cluster
    var bedX = 0.3, bedY = Math.min(grid * 0.34, grid - 3.7);
    boxes = boxes.concat(place(rot90(bedProp(tier)), bedX, bedY, 0));

    // plant in open floor, front-right, clear of both clusters
    boxes = boxes.concat(place(plantProp(), grid - 1.9, grid - 2.1, 0));

    // display case tucked on the x=0 wall, near the shared back corner —
    // clear of the desk (which owns the y=0 wall) and the bed (further
    // down this same wall)
    if (tier >= 1) {
      boxes = boxes.concat(place(rot90(displayCaseProp(tier >= 2 ? P.rRare : P.rCovert)), 0.3, 0.3, 0));
    }
    if (tier >= 2) {
      boxes = boxes.concat(place(plantProp(), 0.4, grid - 2.0, 0));
    }

    boxes.sort(function (a, b) { return (a.x + a.y + a.z * 0.05) - (b.x + b.y + b.z * 0.05); });
    boxes.forEach(function (b) { box(ctx, lox, loy, b.x, b.y, b.z, b.w, b.d, b.h, b.color); });

    // monitor glow
    var gp = iso(deskX + 0.8, deskY + 0.25, 20);
    glow(ctx, lox + gp.sx, loy + gp.sy, 62, monColor, 0.35);
    if (tier >= 2) {
      var gp2 = iso(grid * 0.5, grid * 0.5, 10);
      glow(ctx, lox + gp2.sx, loy + gp2.sy, 90, P.subs, 0.12);
    }

    ctx.restore();
  }

  /* ---- shop mini-icons: simple single-prop iso renders ------------------ */
  function drawIcon(canvas, type, tier) {
    var ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var ox = w / 2, oy = h * 0.72, scale = Math.min(w, h) / 60;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    var boxes = [];
    if (type === "desk") boxes = deskProp(tier);
    else if (type === "pc") boxes = pcTowerProp(tier >= 1 ? P.subs : P.views).concat(
      place(monitorProp(tier >= 1 ? P.views : "#4a90c8"), -1.1, 0, 0));
    else if (type === "chair") boxes = chairProp(tier);
    else if (type === "plant") boxes = plantProp();
    else if (type === "case") boxes = displayCaseProp(tier >= 2 ? P.rRare : P.rClassified);
    else if (type === "room") boxes = trophyShelfProp();
    else if (type === "bed") boxes = bedProp(tier);
    else if (type === "house") boxes = [
      { x: 0, y: 0, z: 0, w: 2.2, d: 2.2, h: 3.2, color: P.panelHi },
      { x: -0.15, y: -0.15, z: 3.2, w: 2.5, d: 1.2, h: 1.6, color: P.gold },
      { x: -0.15, y: 1.1, z: 3.2, w: 2.5, d: 1.2, h: 1.6, color: shade(P.gold, -0.15) },
      { x: 0.85, y: 0.85, z: 0, w: 0.5, d: 0.5, h: 1.4, color: "#4a90c8" }
    ];

    boxes = boxes.map(function (b) { return { x: b.x - 1.2, y: b.y - 0.6, z: b.z, w: b.w, d: b.d, h: b.h, color: b.color }; });
    boxes.sort(function (a, b) { return (a.x + a.y + a.z * 0.05) - (b.x + b.y + b.z * 0.05); });
    boxes.forEach(function (b) { box(ctx, 0, 0, b.x, b.y, b.z, b.w, b.d, b.h, b.color); });
    ctx.restore();
  }

  /* ---- boot -------------------------------------------------------------- */
  function boot() {
    var hub = document.getElementById("canvas-hub");
    if (hub) drawRoom(hub, { tier: 1, grid: 6, wallH: 100, scale: 2.0, ox: hub.width / 2, oy: 245, character: true, seed: 11 });

    var before = document.getElementById("canvas-before");
    if (before) drawRoom(before, { tier: 0, grid: 4, wallH: 56, scale: 2.0, ox: before.width / 2, oy: 128, character: false, seed: 4 });

    var after = document.getElementById("canvas-after");
    if (after) drawRoom(after, { tier: 2, grid: 10, wallH: 150, scale: 1.0, ox: after.width / 2, oy: 170, character: false, seed: 9 });

    [["icon-desk", "desk", 2], ["icon-pc", "pc", 2], ["icon-chair", "chair", 1],
     ["icon-plant", "plant", 1], ["icon-case", "case", 2], ["icon-room", "room", 2],
     ["icon-house", "house", 2], ["icon-desk0", "desk", 0]].forEach(function (t) {
      var c = document.getElementById(t[0]);
      if (c) drawIcon(c, t[1], t[2]);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.Mockups = { drawRoom: drawRoom, drawIcon: drawIcon, shade: shade, iso: iso, P: P };
})();
