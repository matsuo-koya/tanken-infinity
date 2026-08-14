/* 一人称視点（レイキャスティング）の描画。
   盤面の状態はそのままに、描画だけを差し替えるための描き手。
   本体とハーネスの両方から同じものを呼べるよう、refに依存せず引数で受け取る。 */

export const FOV = Math.PI / 3;
// 主自身が覗くときは全身像ではなく顔の絵文字を使う（下端から出るのは顔であってほしい）
const FACES = { "犬": "🐶", "猫": "🐱" };
const SWORD = "🗡️";
const SWING_MS = 480;   // 一振りにかける実時間
// 下端から覗かせてよい割合。これを超えると目が入り、こちらを向いた顔に見えてしまう。
// 見える高さ = 字の高さ × (0.16 + 0.28 × peek) なので、そこから上限のpeekを逆算する
const CROWN_MAX = 0.33;
const PEEK_MAX = (CROWN_MAX - 0.16) / 0.28;
const SWING_TOP = 0.19; // 切先が真上に来る位置（打撃音の直後に来るよう早めに取る）
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

/* 視点の主の身体。世界ではなく画面に貼るので、遠近には従わせない。
   画面の下端から一部だけを覗かせることで「そこに居る」感じを出す。 */
function drawBody(ctx, cw, chh, w, now, swingAt) {
  const t = now / 1000;
  const drift = Math.sin(t * 0.83);        // ゆっくりした左右の揺れ
  ctx.textAlign = "center"; ctx.textBaseline = "middle";

  // 斃れたら歩みの拍は止まる。上下を繰り返さず、一度だけ沈んでそれきり
  const dead = !!w.dead;
  const sink = dead ? Math.min(1, (w.deadTimer || 0) / 10) : 0;
  if (sink >= 1) return;                   // 沈み切ったら何も出さない
  const fall = sink * sink;                // 崩れ落ちる加速（初めは緩く、やがて一気に）
  const tilt = fall * 1.05;                // 傾きながら倒れる（約60度まで）
  // 打撃の合図からの経過。0〜1が一振り
  const sp = (!dead && swingAt) ? (now - swingAt) / SWING_MS : 2;
  const swinging = sp >= 0 && sp < 1;

  // 連れの相棒。全身は見せず、手前を横切る上半身だけ（主の最期には出さない）
  if (w.buddy && !dead) {
    const size = chh * 0.82;
    const x = cw * 0.5 + Math.sin(t * 0.62) * cw * 0.46;
    const y = chh + size * 0.30 - Math.abs(Math.sin(t * 3.1)) * size * 0.05;
    const toRight = Math.cos(t * 0.62) > 0;
    ctx.save();
    ctx.globalAlpha = 0.96;
    ctx.shadowColor = "#c8b78a"; ctx.shadowBlur = size * 0.14;
    ctx.font = `${size}px 'Hiragino Mincho ProN',serif`;
    ctx.translate(x, y);
    if (toRight) ctx.scale(-1, 1);         // 進む向きへ顔を向ける
    ctx.fillText(w.buddy.em, 0, 0);
    ctx.restore();
  }

  // 主自身。人なら両手が前に、獣なら鼻先が時折覗く
  if (w.dog.kj === "人") {
    // 手は左右交互に振り出す。引いた側は下端に沈めて、歩みの拍を作る
    const size = chh * 0.46;
    ctx.save();
    ctx.font = `${size}px serif`;
    // 左は素手、右は剣を握る。剣は少し大きく、切っ先が内へ向くよう寝かせる。
    // 戦闘に入ると空いた手は拳を握る
    const fighting = w.combat && !dead;
    const bare = fighting ? "✊" : "🤚";
    // 探索中の素手は指先を左上へ向ける。握った拳は立てたまま。
    // 左右反転してから描くので、左上へ向けるには負の角を与える
    const bareBase = fighting ? -0.11 : -0.42;
    // [横位置, 基準の傾き, 振り出しでの追加の傾き, 左右反転, 位相, 字, 倍率]
    // 剣は素の絵文字だと切先が左下を向くので、半回転させて右上へ構える
    // [横位置, 基準の傾き, 振り出しでの追加の傾き, 左右反転, 位相, 字, 倍率, 下げ幅]
    const hands = [
      [0.19, bareBase, -0.11, true, 0, bare, 1.0, 0.62],   // 低く構え、振りのたびに出入りする
      [0.88, Math.PI, 0.13, false, Math.PI, SWORD, 1.3, 0.44],   // 切先は画面外へ出てよい
    ];
    for (const [px, base, lean, mirror, phase, glyph, mag, off] of hands) {
      const swing = Math.sin(t * 3.4 + phase);      // 片方が前なら、もう片方は後ろ
      // 生きている間は交互に振り、斃れたら振らずに両手とも落ちていく
      let rise = dead ? 0.5 * (1 - fall) : (swing + 1) / 2;
      let ang = base + lean * rise + (mirror ? -tilt : tilt);   // 斃れると力が抜けて外へ開く
      let alpha = 0.6 + rise * 0.35;
      if (glyph === SWORD && swinging) {
        // 一撃：切先が真上へ立ち上がり、そのまま薙ぎ下ろして視界から消える
        if (sp < SWING_TOP) {
          // 溜めは緩急を逆にして、音と同時にぱっと立ち上がるようにする
          const u = sp / SWING_TOP, e = 1 - (1 - u) * (1 - u);
          ang = Math.PI - Math.PI * 0.25 * e;             // 右上 → 真上
          rise = 0.55 + 0.5 * e;
          alpha = 0.95;
        } else {
          const u = (sp - SWING_TOP) / (1 - SWING_TOP), e = u * u;   // 振り下ろし
          ang = Math.PI * 0.75 + Math.PI * 1.0 * e;       // 真上 → 右下へ薙ぐ
          rise = 1.05 - 1.7 * e;                          // 画面の下へ抜ける
          alpha = Math.max(0, 0.95 - u * 1.5);            // やがて見えなくなる
        }
        if (alpha <= 0.01) { continue; }
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cw * px + drift * cw * 0.015, chh + size * off - rise * size * 0.56);
      ctx.rotate(ang);
      if (mirror) ctx.scale(-1, 1);
      if (mag !== 1) ctx.font = `${size * mag}px serif`;
      ctx.fillText(glyph, 0, 0);
      if (mag !== 1) ctx.font = `${size}px serif`;
      ctx.restore();
    }
    ctx.restore();
  } else {
    // 獣：ゆっくりした周期で鼻面が下から せり上がっては沈む。
    // 斃れた後は周期を止め、うなだれるように一度だけ沈む
    let peek = dead ? 0.95 * (1 - fall) : Math.sin(((t * 0.14) % 1) * Math.PI * 2) * 0.62;
    let mag = 1, lean = 0;
    if (swinging) {
      // 一撃：剣の代わりに跳ね上がって噛みつく。頂点は剣が真上を向くのと同じ位置に
      // 取り、打撃音と噛みつきを合わせる。ただし見せるのは頭頂部から後頭部までで、
      // 目まで出すと敵ではなくこちらを向いていることになる。迫りは拡大で表す。
      const up = sp < SWING_TOP
        ? 1 - (1 - sp / SWING_TOP) ** 2                        // ぱっと跳ぶ
        : 1 - ((sp - SWING_TOP) / (1 - SWING_TOP)) ** 1.5;     // 落ちる
      peek = Math.max(peek, 0.1 + up * 0.55);                  // わずかに上へ
      mag = 1 + up * 1.15;                                     // 大きく迫る
      lean = up * 0.16;                                        // 食らいつく首の角度
    }
    peek = Math.min(peek, PEEK_MAX);                           // 目より下は見せない
    if (peek > 0) {
      const size = chh * 0.62 * mag;
      const y = chh + size * 0.34 - peek * size * 0.28;   // せり上がると顔の上半分まで見える
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.font = `${size}px serif`;
      ctx.translate(cw * (0.5 + drift * 0.1) + tilt * cw * 0.17, y);   // 傾いた側へ流れる
      ctx.rotate(tilt + lean);                            // 崩れる／食らいつく首の傾き
      ctx.fillText(FACES[w.dog.kj] || w.dog.em, 0, 0);
      ctx.restore();
    }
  }
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
    // 面によって、画面を左→右と走るときのwallXの増減が逆になる。
    // 減る側だけ反転して、字が常に正しく読める向きに揃える。
    // （定石の反転はこれと逆向きで、字だと全面が鏡文字になる）
    let texX = Math.floor(wallX * TILE);
    if ((side === 0 && rayX < 0) || (side === 1 && rayY > 0)) texX = TILE - texX - 1;
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
  if (seen(w.stairs.x, w.stairs.y)) sprites.push({ x: w.stairs.x + 0.5, y: w.stairs.y + 0.5, ch: "🕳️", color: "#8d7bb5", sc: 1.0 });
  for (const it of w.items) if (seen(it.x, it.y))
    sprites.push({ x: it.x + 0.5, y: it.y + 0.5, ch: ITEM_TYPES[it.type].e, color: "#c8963e", sc: 0.5 });

  let dread = 0;   // 警戒した敵がどれだけ間近にいるか
  for (const e of w.enemies) {
    const dist = Math.hypot(e.x - w.dog.x, e.y - w.dog.y);
    if (!(seen(e.x, e.y) && (e.alerted || dist <= 5.5))) continue;
    let ex = e.x + 0.5, ey = e.y + 0.5, sc = 1.25, lift = 0, flip = false;
    if (e.alerted) {
      // 気づかれたら、左右に振れながら跳ねて迫る（見せ方だけで、盤面の位置は動かさない）
      const t = now / 1000, ph = e.id * 1.7;
      const amp = Math.max(0, 0.44 - dist * 0.05);      // 近いほど大きく振れる
      const sway = Math.sin(t * 3.1 + ph) * amp;
      ex += -dirY * sway; ey += dirX * sway;            // 視線に直交する向きへ
      flip = Math.cos(t * 3.1 + ph) > 0;                // 流れる向きへ顔を向ける
      lift = Math.abs(Math.sin(t * 5.5 + ph)) * 0.09;    // 跳ねる
      sc += Math.sin(t * 6.2 + ph) * 0.05;              // 脈打つ
      dread = Math.max(dread, Math.max(0, 1 - dist / 4));
    }
    sprites.push({
      x: ex, y: ey, ch: e.alerted ? e.e : e.k,
      color: e.alerted ? "#d9553f" : "#b3a486", sc, lift, flip, glow: e.alerted,
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
    const gy = baseY - size * 0.5;                       // 足元を床に付ける
    if (p.s.flip) {
      ctx.save(); ctx.translate(screenX, gy); ctx.scale(-1, 1);
      ctx.fillText(p.s.ch, 0, 0); ctx.restore();
    } else ctx.fillText(p.s.ch, screenX, gy);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  drawBody(ctx, cw, chh, w, now, env.swingAt);

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
