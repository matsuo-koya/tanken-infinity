/* 一人称視点（レイキャスティング）の描画。
   盤面の状態はそのままに、描画だけを差し替えるための描き手。
   本体とハーネスの両方から同じものを呼べるよう、refに依存せず引数で受け取る。 */

export const FOV = Math.PI / 3;
const TILE = 96;
const WALL_H = 2.2;   // 壁の高さ（区画の一辺を1とする）。低いと這うような画になる
const EYE = 0.85;     // 視点の高さ。壁の半分より低くして、床と敵が正面に来るようにする

/* 一字をテクスチャに焼く（石の目地つき）。cacheは呼び手が持つ素の入れ物 */
export function glyphTile(cache, ch, fg) {
  if (cache[ch]) return cache[ch];
  const cv = document.createElement("canvas");
  cv.width = TILE; cv.height = TILE;
  const g = cv.getContext("2d");
  g.fillStyle = "#1b1712"; g.fillRect(0, 0, TILE, TILE);
  g.strokeStyle = "#3a3226"; g.lineWidth = 4;
  g.strokeRect(2, 2, TILE - 4, TILE - 4);
  g.fillStyle = fg;
  g.font = `700 ${Math.round(TILE * 0.6)}px 'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(ch, TILE / 2, TILE / 2 + TILE * 0.03);
  cache[ch] = cv;
  return cv;
}

/* 追従カメラ。格子の移動を滑らかに繋ぎ、向きは最短回りで追う。
   別の迷宮に移ったら（cam.of が変われば）瞬間移動させる。 */
export function stepCam(cam, world, dt) {
  if (!world) return;
  const tx = world.dog.x + 0.5, ty = world.dog.y + 0.5;
  if (cam.of !== world) { cam.of = world; cam.x = tx; cam.y = ty; cam.ang = world.dog.head || 0; return; }
  const k = 1 - Math.pow(0.0009, dt);       // 時間刻みに依らない追従
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  let d = (world.dog.head || 0) - cam.ang;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  cam.ang += d * k;
}

/* env: { world, cam, cache, W, H, ITEM_TYPES, now } */
export function drawFPS(ctx, cw, chh, env) {
  const { world: w, cam: c, cache, W, H, ITEM_TYPES } = env;
  if (!w) return;
  const now = env.now ?? Date.now();
  const horizon = chh * 0.5;
  const dirX = Math.cos(c.ang), dirY = Math.sin(c.ang);
  const halfPlane = Math.tan(FOV / 2);
  const planeX = -dirY * halfPlane, planeY = dirX * halfPlane;

  // 天井と床。奥ほど沈む
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#0d0b08"); sky.addColorStop(1, "#221d16");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, cw, horizon);
  const flo = ctx.createLinearGradient(0, horizon, 0, chh);
  flo.addColorStop(0, "#1d1913"); flo.addColorStop(1, "#0b0a07");
  ctx.fillStyle = flo; ctx.fillRect(0, horizon, cw, chh - horizon);

  // 床の格子。奥へ向かって収束する線が、区画の刻みを示す（ベクター的な地面）
  const rayLX = dirX - planeX, rayLY = dirY - planeY;   // 画面左端の光線
  const rayRX = dirX + planeX, rayRY = dirY + planeY;   // 右端
  ctx.fillStyle = "#4a4336";
  for (let y = Math.ceil(horizon) + 1; y < chh; y++) {
    const rowDist = (EYE * chh) / (y - horizon);
    if (rowDist > 13) continue;
    const a = Math.max(0, 0.42 - rowDist / 30);
    if (a < 0.02) continue;
    ctx.globalAlpha = a;
    const stepX = (rayRX - rayLX) * rowDist / cw, stepY = (rayRY - rayLY) * rowDist / cw;
    let fx = c.x + rayLX * rowDist, fy = c.y + rayLY * rowDist;
    for (let sx = 0; sx < cw; sx += 2) {
      const nx = fx - Math.floor(fx), ny = fy - Math.floor(fy);
      if (nx < 0.045 || ny < 0.045) ctx.fillRect(sx, y, 2, 1);
      fx += stepX * 2; fy += stepY * 2;
    }
  }
  ctx.globalAlpha = 1;

  const wallTex = glyphTile(cache, "壁", "#6c6350");
  const zbuf = new Float32Array(cw);
  for (let sx = 0; sx < cw; sx++) {
    const camX = (2 * sx) / cw - 1;
    const rayX = dirX + planeX * camX, rayY = dirY + planeY * camX;
    let mapX = Math.floor(c.x), mapY = Math.floor(c.y);
    const dX = Math.abs(1 / rayX), dY = Math.abs(1 / rayY);
    let stepX, stepY, sideX, sideY;
    if (rayX < 0) { stepX = -1; sideX = (c.x - mapX) * dX; } else { stepX = 1; sideX = (mapX + 1 - c.x) * dX; }
    if (rayY < 0) { stepY = -1; sideY = (c.y - mapY) * dY; } else { stepY = 1; sideY = (mapY + 1 - c.y) * dY; }
    let side = 0, hit = false;
    for (let g = 0; g < 96 && !hit; g++) {
      if (sideX < sideY) { sideX += dX; mapX += stepX; side = 0; }
      else { sideY += dY; mapY += stepY; side = 1; }
      if (mapX < 0 || mapY < 0 || mapX >= W || mapY >= H) break;
      if (w.map[mapY][mapX] === "wall") hit = true;
    }
    if (!hit) { zbuf[sx] = 1e9; continue; }
    const perp = Math.max(0.05, side === 0 ? sideX - dX : sideY - dY);
    zbuf[sx] = perp;
    const k = chh / perp;                       // 高さ1あたりの画面上の長さ
    const y0 = horizon - (WALL_H - EYE) * k;    // 壁の天
    const lh = WALL_H * k;                      // 壁の丈（床は horizon + EYE*k）
    let wallX = side === 0 ? c.y + perp * rayY : c.x + perp * rayX;
    wallX -= Math.floor(wallX);
    let texX = Math.floor(wallX * TILE);
    if ((side === 0 && rayX > 0) || (side === 1 && rayY < 0)) texX = TILE - texX - 1;
    ctx.drawImage(wallTex, texX, 0, 1, TILE, sx, y0, 1, lh);
    // 距離と面の向きで翳らせる
    const shade = Math.min(0.86, perp / 13 + (side === 1 ? 0.16 : 0));
    if (shade > 0.01) { ctx.fillStyle = `rgba(16,14,10,${shade})`; ctx.fillRect(sx, y0, 1, lh); }
  }

  // 板として立てるもの（探索済みの区画のみ）
  const seen = (x, y) => w.explored.has(y * W + x);
  const sprites = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (w.map[y][x] === "door" && seen(x, y)) sprites.push({ x: x + 0.5, y: y + 0.5, ch: "門", color: "#a08b56", sc: 1.7 });
  }
  if (seen(w.stairs.x, w.stairs.y)) sprites.push({ x: w.stairs.x + 0.5, y: w.stairs.y + 0.5, ch: "🪜", color: "#8d7bb5", sc: 1.0 });
  for (const it of w.items) if (seen(it.x, it.y))
    sprites.push({ x: it.x + 0.5, y: it.y + 0.5, ch: ITEM_TYPES[it.type].e, color: "#c8963e", sc: 0.5 });

  let dread = 0;   // 警戒した敵がどれだけ間近にいるか
  for (const e of w.enemies) {
    const dist = Math.hypot(e.x - w.dog.x, e.y - w.dog.y);
    if (!(seen(e.x, e.y) && (e.alerted || dist <= 5.5))) continue;
    let ex = e.x + 0.5, ey = e.y + 0.5, sc = 1.25, lift = 0;
    if (e.alerted) {
      // 気づかれたら、左右に振れながら跳ねて迫る（見せ方だけで、盤面の位置は動かさない）
      const t = now / 1000, ph = e.id * 1.7;
      const amp = Math.max(0, 0.44 - dist * 0.05);      // 近いほど大きく振れる
      const sway = Math.sin(t * 3.1 + ph) * amp;
      ex += -dirY * sway; ey += dirX * sway;            // 視線に直交する向きへ
      lift = Math.abs(Math.sin(t * 5.5 + ph)) * 0.09;    // 跳ねる
      sc += Math.sin(t * 6.2 + ph) * 0.05;              // 脈打つ
      dread = Math.max(dread, Math.max(0, 1 - dist / 4));
    }
    sprites.push({
      x: ex, y: ey, ch: e.alerted ? e.e : e.k,
      color: e.alerted ? "#d9553f" : "#b3a486", sc, lift, glow: e.alerted,
    });
  }

  // 相棒は目の前をうろちょろさせる（実座標では背後にいて映らないため）
  if (w.buddy) {
    const t = now / 1000;
    const fwd = 2.45 + Math.sin(t * 2.3) * 0.35;
    const lat = Math.sin(t * 1.31) * 0.75;
    sprites.push({
      x: c.x + dirX * fwd - dirY * lat,
      y: c.y + dirY * fwd + dirX * lat,
      ch: w.buddy.em, color: "#d8cdb2", sc: 0.95,
      lift: Math.abs(Math.sin(t * 4.2)) * 0.08, glow: true,
    });
  }

  const invDet = 1 / (planeX * dirY - dirX * planeY);
  const proj = sprites.map(s => {
    const rx = s.x - c.x, ry = s.y - c.y;
    return { s, tx: invDet * (dirY * rx - dirX * ry), ty: invDet * (-planeY * rx + planeX * ry) };
  }).filter(p => p.ty > 0.2).sort((a, b) => b.ty - a.ty);

  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const p of proj) {
    const screenX = (cw / 2) * (1 + p.tx / p.ty);
    const size = (chh / p.ty) * p.s.sc;
    const floorY = horizon + (chh * EYE) / p.ty;              // その距離での床の高さ
    const baseY = floorY - (chh * (p.s.lift ?? 0)) / p.ty;    // 跳ねている分だけ浮かせる
    if (size < 3 || screenX < -size || screenX > cw + size) continue;
    const col = Math.floor(screenX);
    if (col >= 0 && col < cw && p.ty > zbuf[col]) continue;   // 壁の裏は映さない
    ctx.globalAlpha = Math.max(0, Math.min(1, 1.25 - p.ty / 11));
    ctx.font = `${size}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
    if (p.s.glow) { ctx.shadowColor = p.s.color; ctx.shadowBlur = size * 0.28; }
    ctx.fillStyle = p.s.color;
    ctx.fillText(p.s.ch, screenX, baseY - size * 0.5);   // 足元を床に付ける
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  // 間近に迫られると視界の縁が血の色に翳る
  if (dread > 0.01) {
    const vig = ctx.createRadialGradient(cw / 2, horizon, chh * 0.22, cw / 2, horizon, chh * 0.95);
    vig.addColorStop(0, "rgba(217,85,63,0)");
    vig.addColorStop(1, `rgba(217,85,63,${(dread * 0.32).toFixed(3)})`);
    ctx.fillStyle = vig; ctx.fillRect(0, 0, cw, chh);
  }

  // 手前の縁取り（ベクター的な締め）
  ctx.strokeStyle = "#322d22"; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, cw - 2, chh - 2);
}
