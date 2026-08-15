import React, { useEffect, useRef, useState, useCallback } from "react";
import * as Tone from "tone";
import { drawFPS as drawFPSRaw, stepCam as stepCamRaw } from "./fpsView.js";

/* ============================================================
   探犬∞ TANKEN INFINITY
   音楽駆動・自動探査ローグライク（偏差機関搭載）
   - 表示は漢字・かな・絵文字のみ（タイル画像なし）
   - 偏差コア（慣れF／予測誤差E→覚醒度A）が
     音楽生成とエージェント行動の両方を駆動する
   ============================================================ */

const W = 23, H = 15;
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

const SCALES = {
  hirajoshi: { name: "平調子", steps: [0, 2, 3, 7, 8] },
  insen:     { name: "陰旋法", steps: [0, 1, 5, 7, 10] },
  phrygian:  { name: "フリギア", steps: [0, 1, 3, 5, 7, 8, 10] },
  minPent:   { name: "陰音五音", steps: [0, 3, 5, 7, 10] },
  major:     { name: "長調", steps: [0, 2, 4, 5, 7, 9, 11] },
  hminor:    { name: "和声短調", steps: [0, 2, 3, 5, 7, 8, 11] },
  nminor:    { name: "短調", steps: [0, 2, 3, 5, 7, 8, 10] },
};

const MUSIC_STYLES = {
  wa:    { label: "和",     bpm: 100, bpmCombat: 134, distWet: 0.35, verbWet: 0.3 },
  bach:  { label: "弦楽",   bpm: 92,  bpmCombat: 112, distWet: 0.1, verbWet: 0.42 },
  organ: { label: "オルガン", bpm: 88, bpmCombat: 108, distWet: 0.08, verbWet: 0.5 },
  edm:   { label: "EDM",   bpm: 124, bpmCombat: 138, distWet: 0.25, verbWet: 0.22 },
};
const MODE_POOLS = {
  wa: ["hirajoshi", "insen", "phrygian", "minPent"],
  bach: ["major", "hminor"],
  organ: ["hminor", "major"],
  edm: ["nminor", "major"],
};
// コード進行（スケール度数）：バッハ系=I-vi-IV-V、EDM=vi-IV-I-V型
const PROG = { bach: [0, 5, 3, 4], edm: [5, 3, 0, 4] };
const isBaroque = s => s === "bach" || s === "organ";

// ゲーム1ティックあたりの16分音符の数。戦闘中は実時間でおよそ2.2〜2.7倍に伸びる
const TICK_DIV_WALK = 2;
const TICK_DIV_FIGHT = 6;

const ENEMY_TYPES = [
  { key: "rat",  k: "鼠", e: "🐀", hp: 3,  atk: 1, minDepth: 1 },
  { key: "bat",  k: "蝠", e: "🦇", hp: 4,  atk: 1, minDepth: 1 },
  { key: "snake",k: "蛇", e: "🐍", hp: 6,  atk: 2, minDepth: 2 },
  { key: "wolf", k: "狼", e: "🐺", hp: 10, atk: 3, minDepth: 3 },
  { key: "oni",  k: "鬼", e: "👹", hp: 16, atk: 4, minDepth: 4 },
  { key: "ryu",  k: "竜", e: "🐉", hp: 30, atk: 6, minDepth: 6 },
];

const ITEM_TYPES = {
  meat:   { k: "肉", e: "🍖" },
  potion: { k: "薬", e: "🧪" },
  gold:   { k: "金", e: "💰" },
};

const OPERATORS = ["MEDIANT", "旋法交替", "転位", "跳躍", "間引き", "逆行"];

const KANJI_NUM = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const kanjiNum = n => (n >= 0 && n <= 10 ? KANJI_NUM[n] : String(n));

// 配列から一つ引く（genDungeon内のローカルなpickとは別物なので名前を分ける）
const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];

// 階層の深さで空気が変わる。同じ階でも降りるたびに言葉は変わる
const DEPTH_NOTES = {
  shallow: [
    "空気はまだ乾いている",
    "埃の匂いがする。まだ浅い",
    "壁はまだ、手で温められそうだ",
    "光の記憶が、かすかに残っている",
    "苔の匂いが薄い。地上はまだ近い",
  ],
  mid: [
    "冷気が肌を刺す",
    "石が汗をかいている",
    "足音の反響が、遠くなった",
    "空気が重い。息が白む",
    "水の匂いが混じりはじめた",
  ],
  deep: [
    "闇が濃い。竜の気配がする",
    "音が沈む。ここでは旋律さえ痩せる",
    "骨が多い。誰かの終点だったのだろう",
    "岩の奥で、何かが眠っている",
    "闇に厚みがある。手で押し返せそうだ",
  ],
};

const FLAVOR = {
  ambient: [
    "どこかで水の滴る音がする",
    "犬は湿った石の匂いを嗅いだ",
    "冷たい風が通路を抜けていく",
    "遠くで何かが動いた気がした",
    "足音だけが拍に合わせて響く",
    "天井から砂がこぼれ落ちた",
    "松明のない道を、耳だけで測っていく",
    "壁の彫りが、途中で絶えている",
    "自分の影が、拍のたびに伸び縮みする",
    "どこかの扉が、風で軋んだ",
    "埃が舞い、拍の隙間で光った",
    "通路の奥から、かすかな反響が返ってくる",
  ],
  hungry: [
    "腹の虫が鳴いた。肉の匂いを探している",
    "空腹が思考を単純にしていく",
    "犬は肉を思い出し、足を速めた",
    "胃が縮む。次の角に何かあればいい",
    "飢えが、注意力を削っていく",
    "匂いのしない道が続く。腹が鳴る",
  ],
  // 手負いは戦闘と地続きなので、こちらも短めに
  low: [
    "傷が疼く",
    "息が浅い",
    "血の匂い。自分のものだ",
    "痛みが拍を刻む",
    "視界の縁が暗い",
    "まだ倒れない",
  ],
  bored: [
    "旋律が逸れはじめる。この階に飽きたのだ",
    "慣れが限界に達し、犬は階段を思う",
    "同じ鼓動が続きすぎた。耳が新しさを欲している",
    "見飽きた壁。機関が別の調べを探しはじめる",
    "反復が飽和する。逸脱だけが出口だ",
    "この階の音を、もう覚えてしまった",
  ],
  // 戦闘中は展開が速い。語り終わる前に状況が変わらないよう、短く切る
  combatStart: [
    "牙が閃く",
    "毛が逆立つ",
    "間合いが消えた",
    "影が跳ねた",
    "鼓動が高まる",
    "低音が唸る",
    "来る",
  ],
  combatEnd: [
    "静寂が戻る",
    "息を整える",
    "鼓動が落ち着く",
    "気配が絶えた",
    "音が退く",
    "また歩き出す",
  ],
  depth: d => `地下${d}階——${pickOne(d < 3 ? DEPTH_NOTES.shallow : d < 5 ? DEPTH_NOTES.mid : DEPTH_NOTES.deep)}`,
};

// 行動記録に載る戦闘の出入り
const COMBAT_LOGS = {
  start: ["戦闘の気配", "敵影", "間合いが消えた", "鼓動が高まる"],
  end: ["静寂が戻った", "息が整った", "気配が絶えた", "鼓動が落ち着いた"],
};

/* 初期画面の導入文。戻るたびに別の言い回しが出る */
const TITLE_BLURBS = [
  [
    "選ばれし者が、音楽に導かれて迷宮を自動で探査します。",
    "偏差機関の「飽き」が旋律を変え、深部へと誘います。",
    "あなたはただ、見ていてください。",
  ],
  [
    "命はひとりでに歩きます。導くのはあなたではなく、音楽です。",
    "旋律に飽きたとき、偏差機関はより深い階を欲しがります。",
    "灯を持たず、その背を見送ってください。",
  ],
  [
    "この迷宮に地図はありません。あるのは拍と、慣れと、逸れていく旋律だけ。",
    "飽きが臨界に達するたび、歩みは下へ下へと逸れていきます。",
    "操作は要りません。ただ聴いて、見ていてください。",
  ],
  [
    "音が鳴りはじめると、命は勝手に潜っていきます。",
    "同じ調べに慣れるほど、偏差機関は深部への渇きを募らせます。",
    "見届けること以外に、あなたにできることはありません。",
  ],
  [
    "ここでは音楽が地図であり、飽きが羅針盤です。",
    "旋律が澱むたび、機関は次の階への逸脱を選びます。",
    "手を出さずに、その一生を見ていてください。",
  ],
];

/* 下部の偏差機関の解説。新しい迷宮／初期画面のたびに言い換わる（内容は同一） */
const CODA_TEXTS = [
  [
    "慣れFが閾値を超えると偏差機関がMEDIANT等のオペレータで旋律を逸脱させ、同時に探索衝動（未踏領域・階段への効用）が上昇します。",
    "敵は非警戒時は漢字、警戒すると絵文字で表示。主人公は歩行ごとに漢字⇄絵文字が切り替わり、移動方向で左右反転します。二人旅では相棒が後ろを追従し、戦闘にも参加。先頭が倒れると相棒が歩みを継ぎます。",
    "全滅すると「怒りの日」による鎮魂歌が流れ、光とともに新しい命が生まれ直します。",
  ],
  [
    "偏差機関は慣れFを絶えず測っています。閾値を越えるとMEDIANT等のオペレータが旋律を横へ滑らせ、同時に未踏領域と階段の効用が跳ね上がります——飽きが、そのまま下降の意志になります。",
    "盤面では、敵は警戒するまで漢字、気づくと絵文字。主人公は一歩ごとに漢字と絵文字を往復し、向いた方向へ反転します。二人旅なら相棒が背後を追い、戦列にも加わります。先頭が倒れても、歩みは相棒に引き継がれます。",
    "全滅の際は「怒りの日」が鎮魂に鳴り、やがて光とともに新しい命が生まれ直します。",
  ],
  [
    "旋律への慣れFが閾値に達した瞬間、偏差機関はMEDIANT等のオペレータで調べを逸らし、探索衝動——未踏の区画や階段へ向かう効用——を同時に押し上げます。",
    "表示の約束事：敵は非警戒なら漢字、警戒すると絵文字。主人公は歩くたびに漢字⇄絵文字が入れ替わり、進む向きに合わせて左右が反転します。二人旅では相棒が後ろをついてきて戦いにも加わり、先頭が斃れれば歩みを継ぎます。",
    "全滅すれば「怒りの日」の鎮魂歌。そして光が差し、新しい命が生まれ直します。",
  ],
  [
    "この迷宮を動かしているのは慣れFです。閾値を越えると偏差機関がMEDIANT等のオペレータを起動し、旋律を逸脱させると同時に、未踏領域や階段への効用＝探索衝動を高めます。",
    "敵は非警戒時が漢字、警戒すると絵文字に変わります。主人公は一歩ごとに漢字と絵文字を切り替え、移動方向で左右反転。二人旅では相棒が後ろを追従して戦闘にも参加し、先頭が倒れたときは歩みを継ぎます。",
    "全滅すると「怒りの日」による鎮魂歌が流れ、光とともに新しい命が生まれ直します。",
  ],
];

/* 直前と同じものを引かないように選ぶ */
const pickOther = (len, cur) => {
  if (len < 2) return 0;
  const i = Math.floor(Math.random() * (len - 1));
  return i >= cur ? i + 1 : i;
};

const CHARACTERS = {
  dog:   { k: "犬", e: "🐕", name: "犬", hp: 30, atk: 3, verb: "噛みついた" },
  cat:   { k: "猫", e: "🐈", name: "猫", hp: 26, atk: 3, verb: "引っ掻いた" },
  human: { k: "人", e: "🚶", name: "人", hp: 34, atk: 2, verb: "打ちすえた" },
};
const PARTY_OPTIONS = [
  { id: "dog", label: "犬", members: ["dog"] },
  { id: "cat", label: "猫", members: ["cat"] },
  { id: "human", label: "人", members: ["human"] },
  { id: "duo", label: "人と犬", members: ["human", "dog"] },
  { id: "random", label: "おまかせ", members: null },
];

// 読み上げ用の読み補正（表示は漢字のまま）
// 前から順に置換するので、長い語・活用形を先に置く（「光った」を「ヒカリった」にしないため）
const READINGS = [
  // ダーシは読み飛ばされて詰まって聞こえるので、句点に置き換えて間を取らせる
  ["\u2014\u2014", "。"],
  ["鼓動", "こどう"], ["静寂", "せいじゃく"], ["逸れ", "それ"], ["蝠", "コウモリ"], ["来る", "くる"],
  ["光った", "ひかった"], ["光", "ヒカリ"],
];

// 鎮魂歌：グレゴリオ聖歌「怒りの日」冒頭（主音からの半音オフセット）
const REQUIEM = [3, 2, 3, 0, 2, -2, 0, 0];

/* ---------------- ダンジョン生成 ---------------- */
function genDungeon(depth) {
  const map = Array.from({ length: H }, () => Array(W).fill("wall"));
  const rooms = [];
  for (let t = 0; t < 60 && rooms.length < 7; t++) {
    const rw = 3 + Math.floor(Math.random() * 4);
    const rh = 3 + Math.floor(Math.random() * 3);
    const rx = 1 + Math.floor(Math.random() * (W - rw - 2));
    const ry = 1 + Math.floor(Math.random() * (H - rh - 2));
    if (rooms.some(r => rx < r.x + r.w + 1 && rx + rw + 1 > r.x && ry < r.y + r.h + 1 && ry + rh + 1 > r.y)) continue;
    rooms.push({ x: rx, y: ry, w: rw, h: rh });
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) map[y][x] = "floor";
  }
  const cx = r => Math.floor(r.x + r.w / 2), cy = r => Math.floor(r.y + r.h / 2);
  for (let i = 1; i < rooms.length; i++) {
    let x = cx(rooms[i - 1]), y = cy(rooms[i - 1]);
    const tx = cx(rooms[i]), ty = cy(rooms[i]);
    while (x !== tx) { x += Math.sign(tx - x); if (map[y][x] === "wall") map[y][x] = "hall"; }
    while (y !== ty) { y += Math.sign(ty - y); if (map[y][x] === "wall") map[y][x] = "hall"; }
  }
  // 門：通路が部屋に接する箇所へ確率的に
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (map[y][x] === "hall") {
      const nearRoom = [[0,1],[0,-1],[1,0],[-1,0]].some(([dx,dy]) => map[y+dy]?.[x+dx] === "floor");
      if (nearRoom && Math.random() < 0.25) map[y][x] = "door";
    }
  }
  const floors = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map[y][x] === "floor") floors.push({ x, y });
  const pick = () => floors.splice(Math.floor(Math.random() * floors.length), 1)[0];
  const start = { x: cx(rooms[0]), y: cy(rooms[0]) };
  const last = rooms[rooms.length - 1];
  const stairs = { x: cx(last), y: cy(last) };
  const items = [];
  const addItems = (type, n) => { for (let i = 0; i < n; i++) { const p = pick(); if (p) items.push({ type, x: p.x, y: p.y }); } };
  addItems("meat", 2); addItems("potion", 1 + (depth > 2 ? 1 : 0)); addItems("gold", 2 + Math.floor(depth / 2));
  const pool = ENEMY_TYPES.filter(e => e.minDepth <= depth && e.minDepth >= Math.max(1, depth - 3));
  const enemies = [];
  for (let i = 0; i < 3 + depth; i++) {
    const p = pick(); if (!p) break;
    if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) < 4) continue;
    const t = pool[Math.floor(Math.random() * pool.length)] || ENEMY_TYPES[0];
    const hp0 = t.hp + Math.floor(depth / 3);
    enemies.push({ ...t, x: p.x, y: p.y, hp: hp0, maxHp: hp0, alerted: false, facing: -1, id: i });
  }
  return { map, start, stairs, items, enemies, rooms };
}

const passable = (map, x, y) => x >= 0 && y >= 0 && x < W && y < H && map[y][x] !== "wall";

function bfsStep(map, from, to, blocked) {
  const key = (x, y) => y * W + x;
  const prev = new Map(); const q = [[from.x, from.y]];
  prev.set(key(from.x, from.y), null);
  while (q.length) {
    const [x, y] = q.shift();
    if (x === to.x && y === to.y) {
      let cur = key(x, y), path = [];
      while (prev.get(cur) !== null) { path.push(cur); cur = prev.get(cur); }
      const first = path[path.length - 1];
      return first === undefined ? null : { x: first % W, y: Math.floor(first / W) };
    }
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (!passable(map, nx, ny) || prev.has(k)) continue;
      if (blocked && blocked.has(k) && !(nx === to.x && ny === to.y)) continue;
      prev.set(k, key(x, y)); q.push([nx, ny]);
    }
  }
  return null;
}

/* ---------------- メインコンポーネント ---------------- */
export default function TankenInfinity() {
  const [, setTick] = useState(0);
  const [started, setStarted] = useState(false);
  const [running, setRunning] = useState(false);
  const world = useRef(null);
  const core = useRef({ F: 0.1, E: 0.5, A: 0.5, lastOp: "—", opFlash: 0 });
  const audio = useRef(null);
  const logRef = useRef([]);
  const battle = useRef({ foe: null, dogAnim: 0, foeAnim: 0, dogHurt: 0, foeHurt: 0, foeKO: 0, floats: [], cooldown: 0 });
  const narr = useRef({ text: "", at: 0 });
  const [partySel, setPartySel] = useState("dog");
  const partySelRef = useRef("dog");
  const partyRef = useRef(["dog"]);
  const rebirth = useRef(0);
  const fanfIdx = useRef(0);      // 復活ファンファーレの上行位置
  const ascends = useRef([]);     // 昇天エフェクト {x,y,em,t,id}
  const bigAscend = useRef(null); // 戦闘用の大画面昇天 {em,name,t}
  const combatLvl = useRef(0);  // 戦闘強度0..1（なめらかに追従）
  const lastStepAt = useRef(0);   // Transport監視（iOSウォッチドッグ）
  const pumpRef = useRef(null);
  const startedRef = useRef(false);
  const runningRef = useRef(false);
  const reqIdx = useRef(0);
  const reqMel = useRef(72);   // 生成レクイエムの上声（掛留連鎖）
  const reqBass = useRef(38);  // 生成レクイエムのラメント低音

  function resolvePartyNow() {
    const opt = PARTY_OPTIONS.find(o => o.id === partySelRef.current) || PARTY_OPTIONS[0];
    if (opt.members) partyRef.current = opt.members;
    else {
      const pool = PARTY_OPTIONS.filter(o => o.members);
      partyRef.current = pool[Math.floor(Math.random() * pool.length)].members;
    }
  }
  const [voiceOn, setVoiceOn] = useState(true);
  const [speechRate, setSpeechRate] = useState(1.2);
  const speechRateRef = useRef(1.2);
  const SPEECH_RATES = [1.0, 1.2, 1.5, 2.0];
  const cycleRate = () => {
    const i = SPEECH_RATES.indexOf(speechRateRef.current);
    const next = SPEECH_RATES[(i + 1) % SPEECH_RATES.length];
    speechRateRef.current = next; setSpeechRate(next);
  };
  const voiceOnRef = useRef(true);
  const jaVoice = useRef(null);
  const ttsUnlocked = useRef(false);
  const speakSeq = useRef(0);
  const prioHold = useRef(0);   // この時刻までは格下の語りを差し込まない
  // 解説文の言い回し。毎フレーム再描画されるので、選んだ結果はrefに寝かせておく
  const variant = useRef({
    blurb: Math.floor(Math.random() * TITLE_BLURBS.length),
    coda: Math.floor(Math.random() * CODA_TEXTS.length),
  });

  function loadVoices() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const vs = window.speechSynthesis.getVoices();
    jaVoice.current = vs.find(v => v.lang && v.lang.startsWith("ja")) || null;
  }

  /* iOS解錠：最初のspeak()はタップ直下（await前）で呼ばないと以後すべて無視される。
     無音の一言を先に流し込んで発話権を得ておく。 */
  function unlockSpeech() {
    if (ttsUnlocked.current) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      loadVoices();
      const u = new SpeechSynthesisUtterance("　");
      u.lang = "ja-JP"; u.volume = 0; u.rate = 2;
      window.speechSynthesis.speak(u);
      ttsUnlocked.current = true;
    } catch (e) { /* 非対応環境では黙って続行 */ }
  }

  function speak(text) {
    if (!voiceOnRef.current) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!audio.current) return; // 解錠前は発話しない（iOSでTTSがオーディオセッションを先取りするのを防ぐ）
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      let spoken = text;
      for (const [kj, yomi] of READINGS) spoken = spoken.split(kj).join(yomi);
      const u = new SpeechSynthesisUtterance(spoken);
      u.lang = "ja-JP";
      if (jaVoice.current) u.voice = jaVoice.current;
      u.rate = speechRateRef.current; u.pitch = 0.9; u.volume = 0.9;
      // 発話中は音楽を軽くダッキング
      const g = audio.current?.out?.gain;
      if (g) g.rampTo(0.5, 0.25);
      const restore = () => {
        if (g) g.rampTo(0.85, 0.6);
        // iOS対策：TTS終了後にWebAudioのセッションを取り戻す
        try { Tone.getContext().rawContext.resume(); } catch (e) {}
      };
      u.onend = restore; u.onerror = restore;
      // iOS対策：cancel()直後のspeak()は取りこぼされることがあるため一拍おく。
      // また、勝手にpaused状態へ落ちることがあるのでresume()で起こしてから流す。
      const seq = ++speakSeq.current;
      setTimeout(() => {
        if (seq !== speakSeq.current) return; // 次の語りに追い越されたら黙る
        try { synth.resume(); synth.speak(u); } catch (e) {}
      }, 60);
    } catch (e) { /* 読み上げ非対応環境では無音で継続 */ }
  }

  /* 語り。prio>0は「落命」など言い切らせたいもの。
     読み終わるまでの間、格下の語り（情景・戦闘の出入り）は差し込ませない。 */
  function narrate(text, prio = 0) {
    if (prio === 0 && Date.now() < prioHold.current) return;
    const nm = world.current?.dog?.name;
    const t = nm && nm !== "犬" ? text.split("犬").join(nm) : text;
    narr.current = { text: t, at: Date.now() };
    if (prio > 0) {
      // 読み上げ所要の見積り（日本語はおよそ毎秒6字、速度倍率で割る）＋余白
      const sec = [...t].length / (6 * speechRateRef.current);
      prioHold.current = Date.now() + Math.min(8000, 500 + sec * 1000);
    }
    speak(t);
  }
  const beatFlip = useRef(false);
  const stepIdx = useRef(0);
  const tickAcc = useRef(0);   // ゲーム進行の間引き用（音楽の刻みとは別に数える）
  const bars = useRef(0);
  const render = useCallback(() => setTick(t => t + 1), []);

  const pushLog = (text, kind = "sys") => {
    logRef.current = [{ text, kind, id: Math.random() }, ...logRef.current].slice(0, 9);
  };

  const newWorld = useCallback((depth, keepStats) => {
    const d = genDungeon(depth);
    const prev = world.current;
    const defs = partyRef.current.map(key => CHARACTERS[key]);
    const mk = def => ({
      x: d.start.x, y: d.start.y, frame: 0, facing: -1, head: 0,
      kj: def.k, em: def.e, name: def.name, verb: def.verb,
      hp: def.hp, maxHp: def.hp, atk: def.atk,
    });
    let dog, buddy;
    if (keepStats && prev) {
      dog = { ...prev.dog, x: d.start.x, y: d.start.y, frame: 0, hp: Math.min(prev.dog.maxHp, prev.dog.hp + 4) };
      buddy = prev.buddy ? { ...prev.buddy, x: d.start.x, y: d.start.y, frame: 0, hp: Math.min(prev.buddy.maxHp, prev.buddy.hp + 4) } : null;
    } else {
      dog = { ...mk(defs[0]), hunger: 20, gold: 0 };
      buddy = defs[1] ? mk(defs[1]) : null;
    }
    world.current = { depth, ...d, dog, buddy, explored: new Set(), combat: false, dead: false, deadTimer: 0 };
    exploreAround(world.current);
    pushLog(`地下${depth}階に降り立った`, "sys");
    narrate(FLAVOR.depth(depth));
  }, []);

  function exploreAround(w) {
    const { dog } = w;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const x = dog.x + dx, y = dog.y + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && Math.hypot(dx, dy) <= 5.2) w.explored.add(y * W + x);
    }
  }

  /* ---------------- 偏差機関（音楽側） ---------------- */
  const music = useRef({
    root: 62, scaleKey: "hirajoshi", style: "wa", chordIdx: 0, melody: [], prevMelody: [],
    leadOct: 0, thin: false, bassPat: [0, null, null, 0, null, 0, null, null, 0, null, null, 0, null, null, 0, null],
  });

  function regenMelody(variation) {
    const m = music.current;
    const st = SCALES[m.scaleKey].steps;
    const next = [];
    if (isBaroque(m.style)) {
      // 常動曲：休符なしの分散和音音型（値=和音内インデックス0..5）
      let idx = Math.floor(Math.random() * 4);
      for (let i = 0; i < 16; i++) {
        if (m.prevMelody.length === 16 && Math.random() > variation) { next.push(m.prevMelody[i]); idx = m.prevMelody[i] ?? idx; continue; }
        idx = Math.max(0, Math.min(5, idx + [-1, 1, 1, -1, 2, -2][Math.floor(Math.random() * 6)]));
        next.push(idx);
      }
    } else if (m.style === "edm") {
      // アンセム：偶数拍のみ、反復多め
      let deg = Math.floor(Math.random() * st.length);
      for (let i = 0; i < 16; i++) {
        if (i % 2 === 1) { next.push(null); continue; }
        if (m.prevMelody.length === 16 && Math.random() > variation) { next.push(m.prevMelody[i]); continue; }
        if (Math.random() < 0.35 && next.length > 1) { next.push(next[i - 2]); continue; } // フック反復
        deg = Math.max(0, Math.min(st.length + 2, deg + (Math.floor(Math.random() * 5) - 2)));
        next.push(deg);
      }
    } else {
      let deg = Math.floor(Math.random() * st.length);
      for (let i = 0; i < 16; i++) {
        if (m.prevMelody.length === 16 && Math.random() > variation) { next.push(m.prevMelody[i]); continue; }
        if (Math.random() < 0.4) { next.push(null); continue; }
        deg = Math.max(0, Math.min(st.length * 2 - 1, deg + (Math.floor(Math.random() * 5) - 2)));
        next.push(deg);
      }
    }
    let changed = 0;
    for (let i = 0; i < 16; i++) if (next[i] !== m.prevMelody[i]) changed++;
    m.prevMelody = m.melody = next;
    return changed / 16;
  }

  function applyOperator() {
    const m = music.current, c = core.current;
    const op = OPERATORS[Math.floor(Math.random() * OPERATORS.length)];
    if (op === "MEDIANT") {
      const shift = [3, 4, -3, -4][Math.floor(Math.random() * 4)];
      const from = NOTE_NAMES[((m.root % 12) + 12) % 12];
      m.root += shift;
      const to = NOTE_NAMES[((m.root % 12) + 12) % 12];
      pushLog(`偏差機関：MEDIANT発動（${from}→${to}）`, "dev");
    } else if (op === "旋法交替") {
      const keys = MODE_POOLS[m.style].filter(k => k !== m.scaleKey);
      m.scaleKey = keys[Math.floor(Math.random() * keys.length)] || m.scaleKey;
      pushLog(`偏差機関：旋法交替（${SCALES[m.scaleKey].name}）`, "dev");
    } else if (op === "転位") {
      m.melody = m.melody.slice(3).concat(m.melody.slice(0, 3)); m.prevMelody = m.melody;
      pushLog("偏差機関：転位（位相+3）", "dev");
    } else if (op === "跳躍") {
      m.leadOct = m.leadOct === 0 ? 12 : 0;
      pushLog(`偏差機関：跳躍（${m.leadOct ? "+1oct" : "±0"}）`, "dev");
    } else if (op === "間引き") {
      m.thin = !m.thin;
      pushLog(`偏差機関：間引き（${m.thin ? "疎" : "密"}）`, "dev");
    } else {
      m.melody = [...m.melody].reverse(); m.prevMelody = m.melody;
      pushLog("偏差機関：逆行", "dev");
    }
    c.lastOp = op; c.opFlash = 4; c.E = 0.85; c.F *= 0.35;
  }

  function barUpdate() {
    const c = core.current;
    const m = music.current;
    bars.current++;
    if (isBaroque(m.style) || m.style === "edm") m.chordIdx = (m.chordIdx + 1) % 4;
    // 覚醒度：予測誤差が上げ、慣れが下げる（Wundt制御）
    c.A = 0.6 * c.E + 0.4 * (1 - c.F);
    if (c.A < 0.35) applyOperator();                    // 飽き→偏差
    else if (c.A > 0.8) { c.E *= 0.8; c.F += 0.04; }    // 過負荷→反復で沈静
    else if (isBaroque(m.style) || bars.current % 2 === 0) { const ch = regenMelody(0.25 + c.A * 0.3); c.E = c.E * 0.5 + ch * 0.9; }
    c.F = Math.min(1, c.F + (1 - c.E) * 0.055);
    c.E *= 0.93;
    if (c.opFlash > 0) c.opFlash--;
    // 物語ナレーション（控えめに、状況依存で）
    const wv = world.current;
    // 戦闘中は長い情景描写を挟まない（戦闘の出入りの短い語りに任せる）
    if (wv && !wv.dead && !wv.combat && Date.now() - narr.current.at > 7000 && bars.current % 6 === 0) {
      const pool = wv.dog.hp < 10 ? FLAVOR.low
        : wv.dog.hunger > 70 ? FLAVOR.hungry
        : c.F > 0.7 ? FLAVOR.bored
        : FLAVOR.ambient;
      narrate(pickOne(pool));
    }
  }

  const [musicSel, setMusicSel] = useState("wa");
  const musicSelRef = useRef("wa");

  function applyStyle(id) {
    const m = music.current;
    m.style = id; m.chordIdx = 0; m.prevMelody = [];
    const pool = MODE_POOLS[id];
    if (!pool.includes(m.scaleKey)) m.scaleKey = pool[0];
    const a = audio.current;
    if (a) {
      if (id === "bach") {
        // バッハ：ディレイを切り、深めの残響のみ。走句はストリングス側で鳴る
        a.delay.wet.rampTo(0, 0.5);
        a.verb.wet.rampTo(0.42, 0.5);
        a.bass.set({ volume: -14, oscillator: { type: "sawtooth" } });
      } else if (id === "organ") {
        // オルガン：大聖堂の残響。ディレイなし、コーラスなし
        a.delay.wet.rampTo(0, 0.5);
        a.verb.wet.rampTo(0.5, 0.5);
      } else if (id === "edm") {
        a.delay.wet.rampTo(0.15, 0.5);
        a.verb.wet.rampTo(0.22, 0.5);
        a.lead.set({ oscillator: { type: "fatsawtooth", count: 3, spread: 22 }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2 }, volume: -11 });
        a.bass.set({ volume: -6, oscillator: { type: "sawtooth" } });
      } else {
        a.delay.wet.rampTo(0.2, 0.5);
        a.verb.wet.rampTo(0.3, 0.5);
        a.lead.set({ oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.15, sustain: 0.15, release: 0.2 }, volume: -10 });
        a.bass.set({ volume: -8, oscillator: { type: "sawtooth" } });
      }
      const sd = MUSIC_STYLES[id];
      Tone.Transport.bpm.rampTo(world.current?.combat ? sd.bpmCombat : sd.bpm, 1);
      pushLog(`楽風：${sd.label}`, "dev");
    }
    regenMelody(1);
  }
  const selectStyle = (id) => { setMusicSel(id); musicSelRef.current = id; if (started) applyStyle(id); };

  /* おまかせのときは、生まれ変わるたびに楽風も引き直す（直前と同じものは引かない）。
     Transportのコールバックから呼ばれ、そこでは`started`が初回描画のまま古いので、
     selectStyleは使わずrefとapplyStyleを直に叩く。 */
  function reshuffleStyle() {
    const ids = Object.keys(MUSIC_STYLES);
    const cur = ids.indexOf(musicSelRef.current);
    const next = ids[pickOther(ids.length, cur < 0 ? 0 : cur)];
    musicSelRef.current = next;
    setMusicSel(next);
    applyStyle(next);
  }

  /* ---------------- オーディオ初期化 ---------------- */
  async function initAudio() {
    await Tone.start();
    // iOS対策：明示的なresume＋無音バッファ再生でオーディオセッションを確実に解錠
    const raw = Tone.getContext().rawContext;
    try { await raw.resume(); } catch (e) {}
    try {
      const buf = raw.createBuffer(1, 1, raw.sampleRate);
      const src = raw.createBufferSource();
      src.buffer = buf; src.connect(raw.destination); src.start(0);
    } catch (e) {}
    // 初期画面から再始動した場合：音響機関は既に組み上がっているので作り直さない
    if (audio.current) { Tone.Transport.start(); return; }
    const out = new Tone.Gain(0.85).toDestination();
    const filt = new Tone.Filter(9000, "lowpass").connect(out);
    const dist = new Tone.Distortion(0.5).connect(filt); dist.wet.value = 0;
    // 残響：ディレイ（山彦）ではなくリバーブ（部屋鳴り）を基本に
    const verb = new Tone.Reverb({ decay: 3.0, wet: 0.32 }).connect(filt);
    const delay = new Tone.FeedbackDelay("8n.", 0.25).connect(verb); delay.wet.value = 0.2;
    // ストリングス系：コーラスで弦アンサンブルの揺らぎを作る
    const chorus = new Tone.Chorus({ frequency: 1.6, delayTime: 3.5, depth: 0.2, wet: 0.7 }).connect(verb);
    chorus.start();
    const strings = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 28 },
      envelope: { attack: 0.06, decay: 0.25, sustain: 0.7, release: 0.5 },
      volume: -16,
    }).connect(chorus);
    strings.maxPolyphony = 16;
    // パイプオルガン：倍音加算（8'+4'+2 2/3'+2'相当のプリンシパル）。コーラスなしで直接残響へ
    const organ = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "custom", partials: [1, 0.7, 0.35, 0.5, 0.15, 0.25, 0.1, 0.2] },
      envelope: { attack: 0.03, decay: 0.1, sustain: 0.95, release: 0.2 },
      volume: -15,
    }).connect(verb);
    organ.maxPolyphony = 16;
    const kick = new Tone.MembraneSynth({ octaves: 6, pitchDecay: 0.04 }).connect(dist);
    const hat = new Tone.NoiseSynth({ volume: -18, envelope: { attack: 0.001, decay: 0.04, sustain: 0 } }).connect(filt);
    const bass = new Tone.MonoSynth({
      oscillator: { type: "sawtooth" }, volume: -8,
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.1 },
      filterEnvelope: { attack: 0.005, decay: 0.12, sustain: 0.4, baseFrequency: 90, octaves: 2.6 },
    }).connect(dist);
    const lead = new Tone.Synth({ oscillator: { type: "triangle" }, volume: -10,
      envelope: { attack: 0.005, decay: 0.15, sustain: 0.15, release: 0.2 } }).connect(delay);
    const fx = new Tone.Synth({ oscillator: { type: "square" }, volume: -14,
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 } }).connect(filt);
    // 打撃系は専用の声を立てる。旋律用のフィルタを通すとHP低下時にこもって
    // 聞こえなくなるので、出力へ直に挿す（語りのダッキングは効いたまま）
    // 打撃はスネア的な短い擦過音より、クラッシュシンバルのほうが状況が伝わる
    const crashHP = new Tone.Filter({ type: "highpass", frequency: 3800 }).connect(out);
    const crash = new Tone.MetalSynth({
      harmonicity: 5.1, modulationIndex: 32, resonance: 4200, octaves: 1.5,
      envelope: { attack: 0.001, decay: 1.1, release: 0.3 },
      volume: -22,
    }).connect(crashHP);
    const impact = new Tone.NoiseSynth({           // シンバルに厚みを添える白色雑音
      noise: { type: "white" }, volume: -16,
      envelope: { attack: 0.001, decay: 0.7, sustain: 0, release: 0.25 },
    }).connect(crashHP);
    const thud = new Tone.MembraneSynth({          // 体に響く芯
      octaves: 4, pitchDecay: 0.09, volume: -7,
      envelope: { attack: 0.001, decay: 0.24, sustain: 0, release: 0.05 },
    }).connect(out);
    audio.current = { out, filt, dist, kick, hat, bass, lead, fx, verb, delay, chorus, strings, organ, impact, thud, crash };
    // 残響生成はiOSで遅延しうるため、最大2.5秒で見切る（未完成時はドライで開始し後から効く）
    try { await Promise.race([verb.ready, new Promise(r => setTimeout(r, 2500))]); } catch (e) {}
    Tone.Transport.bpm.value = 100;
    regenMelody(1);
    Tone.Transport.scheduleRepeat(onStep, "16n");
    Tone.Transport.start();
  }

  function onStep(time) {
    lastStepAt.current = Date.now();
    const w = world.current; if (!w) return;
    const m = music.current, a = audio.current, c = core.current;
    const s = stepIdx.current;
    const combat = w.combat && !w.dead;
    const ci = w.dead ? 0 : combatLvl.current;  // 戦闘強度：レイヤーが徐々に湧き上がる
    // ドラム
    const st = SCALES[m.scaleKey].steps;
    const degAt = d => m.root + st[((d % st.length) + st.length) % st.length] + 12 * Math.floor(d / st.length);
    if (w.dead) {
      if (isBaroque(m.style)) {
        // バッハ様式・自動生成レクイエム（弦楽＝合奏／オルガン＝手鍵盤＋ペダル）：
        // クルツィフィクスス型の半音階下行ラメント低音＋掛留→解決の連鎖（毎回生成が変わる）
        const syn = m.style === "organ" ? a.organ : a.strings;
        const LAM = [0, -1, -2, -3, -4, -5, -7, -5];
        if (s % 8 === 0) {
          reqBass.current = m.root - 24 + LAM[reqIdx.current % LAM.length];
          reqIdx.current++;
          if (m.style === "organ") a.organ.triggerAttackRelease(Tone.Frequency(reqBass.current, "midi"), "2n", time, 0.4);
          else a.bass.triggerAttackRelease(Tone.Frequency(reqBass.current, "midi"), "2n", time, 0.42);
          // 掛留：前の上声を新しい低音の上で保続（不協和が生まれる）
          syn.triggerAttackRelease(Tone.Frequency(reqMel.current, "midi"), "4n", time, 0.4);
        }
        if (s % 8 === 4) {
          // 解決：直下の和声音へ下行（7-6/4-3型）
          const cands = [3, 7, 12, 15, 19].map(o => reqBass.current + 12 + o).filter(n => n < reqMel.current);
          reqMel.current = cands.length ? Math.max(...cands) : reqBass.current + 24;
          if (reqMel.current < m.root - 5) reqMel.current += 12;
          syn.triggerAttackRelease(
            [Tone.Frequency(reqMel.current, "midi"), Tone.Frequency(reqMel.current - 3, "midi")],
            "4n", time, 0.36);
        }
        if (s % 8 === 6 && Math.random() < 0.5) {
          // 予備：次の掛留への準備音（生成の揺らぎ）
          reqMel.current += [0, 2, 3, 5][Math.floor(Math.random() * 4)];
          syn.triggerAttackRelease(Tone.Frequency(reqMel.current, "midi"), "8n", time, 0.28);
        }
      } else {
        // 鎮魂歌：怒りの日（Dies irae）をゆっくりと
        if (s % 8 === 0) a.bass.triggerAttackRelease(Tone.Frequency(m.root - 24, "midi"), "2n", time, 0.5);
        if (s % 4 === 0) {
          const off = REQUIEM[reqIdx.current % REQUIEM.length]; reqIdx.current++;
          const syn = a.strings || a.lead;
          syn.triggerAttackRelease(Tone.Frequency(m.root - 12 + off, "midi"), "2n", time, 0.4);
        }
      }
    } else if (isBaroque(m.style)) {
      // ドラムなし。小節頭に和音、8分の通奏低音（オルガンはペダル鍵盤で）
      const inst = m.style === "organ" ? a.organ : a.strings;
      const cr = PROG.bach[m.chordIdx];
      if (s === 0) {
        const chord = [0, 2, 4].map(o => Tone.Frequency(degAt(cr + o), "midi"));
        inst.triggerAttackRelease(chord, "1m", time, m.style === "organ" ? 0.25 : 0.18);
      }
      if (s % 2 === 0) {
        const bd = s % 4 === 0 ? cr : cr + 4;
        if (m.style === "organ") a.organ.triggerAttackRelease(Tone.Frequency(degAt(bd) - 24, "midi"), "8n", time, 0.35 + 0.15 * ci);
        else a.bass.triggerAttackRelease(Tone.Frequency(degAt(bd) - 24, "midi"), "8n", time, 0.45 + 0.2 * ci);
      }
    } else if (m.style === "edm") {
      // 四つ打ちキック＋裏拍ハット。強度に応じてハットが16分化、ベースが刻みに移行
      if ([0, 4, 8, 12].includes(s)) a.kick.triggerAttackRelease("C1", "16n", time, 0.8 + 0.2 * ci);
      if ([2, 6, 10, 14].includes(s) || (ci > 0.4 && s % 2 === 1 && Math.random() < ci)) {
        a.hat.triggerAttackRelease("16n", time, 0.9 - 0.3 * ci);
      }
      if (ci > 0.55 ? s % 2 === 0 : [2, 6, 10, 14].includes(s)) {
        a.bass.triggerAttackRelease(Tone.Frequency(m.root - 24 + st[0], "midi"), "16n", time, 0.75 + 0.2 * ci);
      }
    } else {
      // 和：強度に応じてキック増打・ハット密度・ベース強度が層状に上がる
      const kicks = [0, 8];
      if (ci > 0.35) kicks.push(4, 12);
      if (ci > 0.7) kicks.push(10);
      if (kicks.includes(s)) a.kick.triggerAttackRelease("C1", "16n", time, 0.7 + 0.3 * ci);
      if (s % 4 === 2 || (ci > 0.3 && s % 2 === 0 && Math.random() < ci)) {
        a.hat.triggerAttackRelease("32n", time, 0.5 + 0.35 * ci);
      }
      if (m.bassPat[s] !== null) {
        a.bass.triggerAttackRelease(Tone.Frequency(m.root - 24 + st[0], "midi"), "16n", time, 0.6 + 0.3 * ci);
      }
    }
    // 緊迫ドローン：戦闘強度に応じて低音の完全五度が小節頭から湧き上がる
    if (!w.dead && ci > 0.2 && s === 0) {
      const droneInst = m.style === "organ" ? a.organ : a.strings;
      droneInst.triggerAttackRelease(
        [Tone.Frequency(m.root - 12, "midi"), Tone.Frequency(m.root - 5, "midi")],
        "1m", time, 0.1 + 0.18 * ci);
    }
    // 復活祭オラトリオ（BWV249）風・自動生成ファンファーレ：
    // 転生の間、長三和音の上行ラッパ音型を付点リズムで（毎回上行の折返しが変わる）
    if (!w.dead && rebirth.current > 0) {
      const FT = [0, 4, 7, 12, 16, 19, 24];
      if ([0, 3, 4, 7, 8, 11, 12].includes(s)) {
        const inst = m.style === "organ" ? a.organ : a.strings;
        const midi = m.root + FT[fanfIdx.current % FT.length];
        inst.triggerAttackRelease(Tone.Frequency(midi, "midi"), "16n", time, 0.45);
        fanfIdx.current += Math.random() < 0.8 ? 1 : -2; // 稀に折り返して音型が変わる
        if (fanfIdx.current < 0) fanfIdx.current = 0;
        if (fanfIdx.current % FT.length === 0) a.kick.triggerAttackRelease("C2", "8n", time, 0.55); // ティンパニ相当
      }
    }
    // リード（偏差旋律）
    const deg = m.melody[s];
    if (deg !== null && deg !== undefined && !w.dead && !(m.thin && s % 2 === 1)) {
      let midi;
      if (isBaroque(m.style)) {
        // 値=和音内インデックス：現在コードの三和音を分散
        const cr = PROG.bach[m.chordIdx];
        midi = degAt(cr + [0, 2, 4][deg % 3]) + 12 * Math.floor(deg / 3) + m.leadOct;
        if (m.style === "organ") a.organ.triggerAttackRelease(Tone.Frequency(midi, "midi"), "16n", time, 0.45);
        else a.strings.triggerAttackRelease(Tone.Frequency(midi, "midi"), "8n", time, 0.4);
      } else {
        midi = degAt(deg) + m.leadOct;
        a.lead.triggerAttackRelease(Tone.Frequency(midi, "midi"), m.style === "edm" ? "8n" : "16n", time, 0.5);
      }
    }
    // 拍で字が明滅（4分音符）
    if (s % 4 === 0) beatFlip.current = !beatFlip.current;
    // ゲームの歩みは音楽から切り離して間引く。戦闘中は大きく間引いて時間を
    // 引き伸ばし、語りや戦闘の見せ場が終わる前に決着しないようにする。
    // （戦闘では曲のBPM自体は上がるので、間引かないとかえって速くなる）
    if (++tickAcc.current >= (combat ? TICK_DIV_FIGHT : TICK_DIV_WALK)) {
      tickAcc.current = 0;
      gameTick(time);
    }
    stepIdx.current = (s + 1) % 16;
    if (stepIdx.current === 0) barUpdate();
    // HP低下でこもった音に
    a.filt.frequency.rampTo(w.dog.hp < 10 ? 1400 : 9000, 0.4);
    render();
  }

  /* ---------------- ゲームティック（行動シミュレーション） ---------------- */
  function sfx(kind, time) {
    const a = audio.current; if (!a) return;
    const t = time ?? undefined;
    try {
      if (kind === "hit") {
        // 打撃：クラッシュシンバルに厚みと芯を重ねる。芯は毎回わずかに音程を散らす
        const p = 38 + Math.floor(Math.random() * 5);        // 概ねD1〜F#1
        a.crash?.triggerAttackRelease("4n", t, 0.9);
        a.impact?.triggerAttackRelease("8n", t, 0.6);
        a.thud?.triggerAttackRelease(Tone.Frequency(p, "midi"), "16n", t, 0.9);
      }
      else if (kind === "hurt") {
        // 被弾：より低く、尾を引く。短二度をぶつけて痛みの色をつける
        const p = 26 + Math.floor(Math.random() * 4);
        a.thud?.triggerAttackRelease(Tone.Frequency(p, "midi"), "8n", t, 1);
        a.impact?.triggerAttackRelease("16n", t, 0.35);
        a.fx.triggerAttackRelease("C2", "16n", t, 0.7);
        try { a.fx.triggerAttackRelease("C#2", "32n", (t ?? Tone.now()) + 0.045, 0.5); } catch (e) {}
      }
      else if (kind === "kill") a.fx.triggerAttackRelease("C4", "16n", t, 0.6);
      else if (kind === "eat") a.fx.triggerAttackRelease("E5", "16n", t, 0.4);
      else if (kind === "gold") a.fx.triggerAttackRelease("A5", "32n", t, 0.5);
      else if (kind === "stairs") a.fx.triggerAttackRelease("C6", "8n", t, 0.5);
      else if (kind === "ascend") { a.fx.triggerAttackRelease("E6", "8n", t, 0.4); a.strings?.triggerAttackRelease(["A5", "E6"], "2n", t, 0.25); }
    } catch (e) { /* timing races are non-fatal */ }
  }

  function playDescent(time) {
    // 階段降下：現在の音階を2オクターブ駆け下りる下降旋律（転調前の調で始まり、次の階の調へ渡す）
    const a = audio.current; if (!a) return;
    const m = music.current;
    const st = SCALES[m.scaleKey].steps;
    const degAt = d => m.root + st[((d % st.length) + st.length) % st.length] + 12 * Math.floor(d / st.length);
    const inst = m.style === "organ" ? a.organ : m.style === "bach" ? a.strings : a.lead;
    const base = typeof time === "number" ? time : Tone.now();
    const top = st.length * 2;
    for (let i = 0; i <= top; i++) {
      try {
        inst.triggerAttackRelease(
          Tone.Frequency(degAt(top - i), "midi"), "16n",
          base + i * 0.085, Math.max(0.15, 0.45 - i * 0.015));
      } catch (e) { /* non-fatal */ }
    }
    // 最後に低音の着地
    try { a.bass.triggerAttackRelease(Tone.Frequency(m.root - 24, "midi"), "4n", base + (top + 1) * 0.085, 0.5); } catch (e) {}
  }

  function gameTick(time) {
    const w = world.current; if (!w) return;
    const { dog, map } = w;
    if (rebirth.current > 0) rebirth.current--;
    // 昇天エフェクトの経過
    if (ascends.current.length) {
      ascends.current.forEach(asc => asc.t++);
      ascends.current = ascends.current.filter(asc => asc.t < 14);
    }
    if (bigAscend.current && ++bigAscend.current.t > 18) bigAscend.current = null;
    if (w.dead) {
      w.deadTimer++;
      if (w.deadTimer > (isBaroque(music.current.style) ? 64 : 20)) {
        resolvePartyNow();
        // おまかせ：新しい命とともに楽風も変わる（requiemの長さは旧楽風で判定済み）
        if (partySelRef.current === "random") reshuffleStyle();
        newWorld(1, false);
        rebirth.current = 20;
        fanfIdx.current = 0;
        narrate("新しい命が生まれ、迷宮に降り立った", 1);   // 落命の保留に潰されないよう対で優先
        Tone.Transport.bpm.rampTo(MUSIC_STYLES[music.current.style].bpm, 1);
        audio.current?.filt.frequency.rampTo(9000, 1);
        audio.current?.verb.wet.rampTo(MUSIC_STYLES[music.current.style].verbWet, 1.5);
      }
      return;
    }
    // 空腹
    dog.hunger = Math.min(100, dog.hunger + 0.12);
    if (dog.hunger >= 100 && bars.current % 2 === 0) dog.hp -= 1;

    const allySnap = mm => ({ k: mm.kj, e: mm.em, name: mm.name, hp: Math.max(0, mm.hp), maxHp: mm.maxHp });
    // 隣接敵→攻撃
    const adj = w.enemies.find(e => Math.abs(e.x - dog.x) + Math.abs(e.y - dog.y) === 1);
    if (adj) {
      adj.alerted = true;
      // 殴りかかる相手へ向き直る。背後や横から絡まれたとき、一人称で
      // 誰もいない方へ剣を振ってしまうのを防ぐ
      dog.head = Math.atan2(adj.y - dog.y, adj.x - dog.x);
      if (adj.x !== dog.x) dog.facing = adj.x > dog.x ? 1 : -1;
      const dmg = dog.atk + Math.floor(w.depth / 3);
      adj.hp -= dmg;
      sfx("hit", time);
      dog.frame ^= 1;
      const b = battle.current;
      b.ally = allySnap(dog);
      b.foe = { k: adj.k, e: adj.e, hp: Math.max(0, adj.hp), maxHp: adj.maxHp };
      b.dogAnim = 2; b.foeHurt = 2; b.cooldown = 7;
      b.swingAt = Date.now();   // 一人称の剣を振る合図（描画は実時刻で進める）
      b.floats.push({ side: "foe", val: dmg, t: 0, id: Math.random() });
      if (adj.hp <= 0) {
        w.enemies = w.enemies.filter(e => e !== adj);
        b.foeKO = 4;
        pushLog(`${dog.name}は${adj.k}を倒した！`, "fight"); sfx("kill", time);
        narrate(`${adj.k}は動かなくなった`);
        core.current.E = Math.min(1, core.current.E + 0.15);
      } else pushLog(`${dog.name}は${adj.k}に${dog.verb}`, "fight");
    } else {
      // 目標選定（効用ベース）
      const target = chooseTarget(w);
      if (target) {
        const blocked = new Set(w.enemies.map(e => e.y * W + e.x));
        const nxt = bfsStep(map, dog, target, blocked);
        if (nxt) {
          const prevPos = { x: dog.x, y: dog.y };
          if (nxt.x !== dog.x) dog.facing = nxt.x > dog.x ? 1 : -1;
          // 一人称視点のための方位（画面下向きがy+なのでatan2の順はdy,dx）
          dog.head = Math.atan2(nxt.y - dog.y, nxt.x - dog.x);
          dog.x = nxt.x; dog.y = nxt.y; dog.frame ^= 1;
          // 相棒はリーダーの直前位置へ追従
          if (w.buddy && (w.buddy.x !== prevPos.x || w.buddy.y !== prevPos.y)) {
            if (prevPos.x !== w.buddy.x) w.buddy.facing = prevPos.x > w.buddy.x ? 1 : -1;
            w.buddy.x = prevPos.x; w.buddy.y = prevPos.y; w.buddy.frame ^= 1;
          }
          if (map[dog.y][dog.x] === "door") { map[dog.y][dog.x] = "hall"; pushLog("門が開いた", "sys"); }
          exploreAround(w);
          // 環境の新奇性→偏差コアへ（未踏を踏むとEが微増）
          core.current.E = Math.min(1, core.current.E + 0.008);
        }
      }
      // アイテム取得
      const it = w.items.find(i => i.x === dog.x && i.y === dog.y);
      if (it) {
        w.items = w.items.filter(i => i !== it);
        // 一人称で手元へ収める見せ場の合図（描画は実時刻で進める）
        battle.current.pickAt = Date.now();
        battle.current.pickEm = ITEM_TYPES[it.type].e;
        if (it.type === "meat") { dog.hunger = Math.max(0, dog.hunger - 55); dog.hp = Math.min(dog.maxHp, dog.hp + 2); pushLog("肉を食べた（満腹回復）", "item"); sfx("eat", time); }
        if (it.type === "potion") { dog.hp = Math.min(dog.maxHp, dog.hp + 10); pushLog("薬を舐めた（HP回復）", "item"); sfx("eat", time); }
        if (it.type === "gold") { dog.gold += 10 * w.depth; pushLog(`金貨を拾った（+${10 * w.depth}）`, "item"); sfx("gold", time); }
        core.current.E = Math.min(1, core.current.E + 0.1);
      }
      // 階段
      if (dog.x === w.stairs.x && dog.y === w.stairs.y) {
        playDescent(time);
        pushLog(`地下${w.depth + 1}階へ降りる…`, "sys");
        applyOperator(); // 階層移動は強制偏差＝転調
        newWorld(w.depth + 1, true);
        return;
      }
    }
    // 相棒の攻撃
    if (w.buddy) {
      const bu = w.buddy;
      const badj = w.enemies.find(e => Math.abs(e.x - bu.x) + Math.abs(e.y - bu.y) === 1);
      if (badj) {
        badj.alerted = true;
        const dmg = bu.atk + Math.floor(w.depth / 3);
        badj.hp -= dmg;
        sfx("hit", time);
        bu.frame ^= 1;
        if (badj.x !== bu.x) bu.facing = badj.x > bu.x ? 1 : -1;
        const b = battle.current;
        b.ally = { k: bu.kj, e: bu.em, name: bu.name, hp: Math.max(0, bu.hp), maxHp: bu.maxHp };
        b.foe = { k: badj.k, e: badj.e, hp: Math.max(0, badj.hp), maxHp: badj.maxHp };
        b.dogAnim = 2; b.foeHurt = 2; b.cooldown = 7;
        b.floats.push({ side: "foe", val: dmg, t: 0, id: Math.random() });
        if (badj.hp <= 0) {
          w.enemies = w.enemies.filter(e => e !== badj);
          b.foeKO = 4;
          pushLog(`${bu.name}は${badj.k}を倒した！`, "fight"); sfx("kill", time);
        } else pushLog(`${bu.name}は${badj.k}に${bu.verb}`, "fight");
      }
    }
    // 敵ターン
    enemyTurn(w, time);
    // 戦闘判定→音楽モード
    // 戦闘判定→音楽モード（強度はなめらかに追従）
    const inCombat = w.enemies.some(e => e.alerted && Math.abs(e.x - dog.x) + Math.abs(e.y - dog.y) <= 6);
    combatLvl.current += ((inCombat ? 1 : 0) - combatLvl.current) * 0.12;
    if (inCombat !== w.combat) {
      w.combat = inCombat;
      const sd = MUSIC_STYLES[music.current.style];
      Tone.Transport.bpm.rampTo(inCombat ? sd.bpmCombat : sd.bpm, 1.8);
      audio.current.dist.wet.rampTo(inCombat ? sd.distWet : 0, 1.2);
      if (inCombat) {
        // 警戒のスティング：短二度のぶつかりが一瞬走る
        const stInst = music.current.style === "organ" ? audio.current.organ : audio.current.strings;
        try {
          stInst?.triggerAttackRelease(
            [Tone.Frequency(music.current.root + 12, "midi"), Tone.Frequency(music.current.root + 13, "midi")],
            "8n", time, 0.35);
        } catch (e) { /* non-fatal */ }
      }
      pushLog(pickOne(inCombat ? COMBAT_LOGS.start : COMBAT_LOGS.end), "sys");
      narrate(pickOne(inCombat ? FLAVOR.combatStart : FLAVOR.combatEnd));
    }
    // 戦闘演出カウンタの減衰
    const bb = battle.current;
    bb.dogAnim = Math.max(0, bb.dogAnim - 1); bb.foeAnim = Math.max(0, bb.foeAnim - 1);
    bb.dogHurt = Math.max(0, bb.dogHurt - 1); bb.foeHurt = Math.max(0, bb.foeHurt - 1);
    bb.foeKO = Math.max(0, bb.foeKO - 1);
    bb.cooldown = Math.max(0, bb.cooldown - 1);
    bb.floats.forEach(f => f.t++);
    bb.floats = bb.floats.filter(f => f.t < 8);
    if (dog.hp <= 0 && !w.dead) {
      if (w.buddy) {
        // 相棒が歩みを継ぐ。倒れた先頭は天へ昇る
        const bu = w.buddy; w.buddy = null;
        ascends.current.push({ x: dog.x, y: dog.y, em: dog.em, t: 0, id: Math.random() });
        bigAscend.current = { em: dog.em, name: dog.name, t: 0 };
        sfx("ascend", time);
        pushLog(`${dog.name}は倒れた…${bu.name}が歩みを継ぐ`, "fight");
        w.dog = { ...bu, x: dog.x, y: dog.y, hunger: dog.hunger, gold: dog.gold };
        narrate(`${dog.name}は光に包まれ、昇っていった。${bu.name}が歩みを継ぐ`, 1);
      } else {
        w.dead = true; w.deadTimer = 0; reqIdx.current = 0;
        reqMel.current = music.current.root + 15;      // 上声は上方の三度圏から降りはじめる
        reqBass.current = music.current.root - 24;
        pushLog(`${dog.name}は倒れた…（記録：地下${w.depth}階・金${dog.gold}）`, "fight");
        narrate(`${dog.name}は倒れた——鎮魂の調べが流れる`, 1);
        Tone.Transport.bpm.rampTo(60, 2);
        audio.current.dist.wet.rampTo(0, 0.5);
        audio.current.filt.frequency.rampTo(3500, 2);
        audio.current.verb.wet.rampTo(0.78, 2.5); // 鎮魂歌は大伽藍の残響で
      }
    }
  }

  function chooseTarget(w) {
    const { dog, map } = w;
    const c = core.current;
    const seen = w.explored;
    const cands = [];
    // 逃走：瀕死かつ敵接近
    const threat = w.enemies.find(e => e.alerted && Math.abs(e.x - dog.x) + Math.abs(e.y - dog.y) <= 2);
    if (dog.hp < 9 && threat) {
      let best = null, bd = -1;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = dog.x + dx, ny = dog.y + dy;
        if (!passable(map, nx, ny)) continue;
        const d = Math.abs(nx - threat.x) + Math.abs(ny - threat.y);
        if (d > bd) { bd = d; best = { x: nx, y: ny }; }
      }
      if (best) return best;
    }
    // アイテム効用
    for (const it of w.items) {
      if (!seen.has(it.y * W + it.x)) continue;
      const d = Math.abs(it.x - dog.x) + Math.abs(it.y - dog.y);
      let u = 0;
      if (it.type === "meat") u = dog.hunger / 100 * 2.2;
      if (it.type === "potion") u = (1 - dog.hp / dog.maxHp) * 2.5;
      if (it.type === "gold") u = 0.9;
      cands.push({ x: it.x, y: it.y, u: u - d * 0.03 });
    }
    // 弱った敵への攻勢
    for (const e of w.enemies) {
      if (!seen.has(e.y * W + e.x)) continue;
      const d = Math.abs(e.x - dog.x) + Math.abs(e.y - dog.y);
      if (d <= 4 && dog.hp > dog.maxHp * 0.4) cands.push({ x: e.x, y: e.y, u: 1.1 - d * 0.05 });
    }
    // フロンティア（好奇心＝新奇性希求、慣れFで減衰）
    let frontier = null, fd = 1e9;
    for (const k of seen) {
      const x = k % W, y = Math.floor(k / W);
      if (!passable(map, x, y)) continue;
      const isFrontier = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < W && ny < H && !seen.has(ny * W + nx) && passable(map, nx, ny);
      });
      if (isFrontier) { const d = Math.abs(x - dog.x) + Math.abs(y - dog.y); if (d < fd) { fd = d; frontier = { x, y }; } }
    }
    if (frontier) cands.push({ ...frontier, u: (1 - c.F * 0.5) * 1.0 - fd * 0.015 });
    // 階段（慣れFが高いほど＝飽きるほど降りたくなる）
    if (seen.has(w.stairs.y * W + w.stairs.x)) {
      const d = Math.abs(w.stairs.x - dog.x) + Math.abs(w.stairs.y - dog.y);
      const exploredRatio = frontier ? 0 : 1;
      cands.push({ x: w.stairs.x, y: w.stairs.y, u: c.F * 1.4 + exploredRatio * 2 - d * 0.01 });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.u - a.u);
    return cands[0];
  }

  function enemyTurn(w, time) {
    const { dog, map } = w;
    for (const e of w.enemies) {
      // 最寄りのパーティメンバーを狙う
      let tgt = dog, td = Math.abs(e.x - dog.x) + Math.abs(e.y - dog.y);
      if (w.buddy) {
        const bd = Math.abs(e.x - w.buddy.x) + Math.abs(e.y - w.buddy.y);
        if (bd < td) { tgt = w.buddy; td = bd; }
      }
      if (e.alerted && tgt.x !== e.x) e.facing = tgt.x > e.x ? 1 : -1;
      if (!e.alerted && td <= 4 && Math.random() < 0.6) {
        e.alerted = true;
        if (w.explored.has(e.y * W + e.x)) pushLog(`${e.k}がこちらに気づいた！`, "fight");
      }
      if (td === 1) {
        tgt.hp -= e.atk; sfx("hurt", time);
        const b = battle.current;
        b.ally = { k: tgt.kj, e: tgt.em, name: tgt.name, hp: Math.max(0, tgt.hp), maxHp: tgt.maxHp };
        b.foe = { k: e.k, e: e.e, hp: Math.max(0, e.hp), maxHp: e.maxHp };
        b.foeAnim = 2; b.dogHurt = 2; b.cooldown = 7;
        b.floats.push({ side: "dog", val: e.atk, t: 0, id: Math.random() });
        pushLog(`${e.k}の攻撃！（${tgt.name}に-${e.atk}）`, "fight");
        if (tgt === w.buddy && tgt.hp <= 0) {
          w.buddy = null;
          ascends.current.push({ x: tgt.x, y: tgt.y, em: tgt.em, t: 0, id: Math.random() });
          bigAscend.current = { em: tgt.em, name: tgt.name, t: 0 };
          sfx("ascend", time);
          pushLog(`${tgt.name}は倒れた…`, "fight");
          narrate(`${tgt.name}は光に包まれ、昇っていった。${dog.name}はひとりで歩き出す`, 1);
        }
        continue;
      }
      const wantMove = e.alerted ? 0.95 : 0.3;
      if (Math.random() > wantMove) continue;
      let best = null;
      const memberCells = new Set([dog.y * W + dog.x, ...(w.buddy ? [w.buddy.y * W + w.buddy.x] : [])]);
      if (e.alerted) {
        const blocked = new Set(w.enemies.filter(o => o !== e).map(o => o.y * W + o.x));
        best = bfsStep(map, e, tgt, blocked);
        if (best && memberCells.has(best.y * W + best.x)) best = null;
      } else {
        const opts = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => ({ x: e.x + dx, y: e.y + dy }))
          .filter(p => passable(map, p.x, p.y) && !memberCells.has(p.y * W + p.x));
        best = opts[Math.floor(Math.random() * opts.length)] || null;
      }
      if (best && !w.enemies.some(o => o !== e && o.x === best.x && o.y === best.y)) {
        if (best.x !== e.x && !e.alerted) e.facing = best.x > e.x ? 1 : -1;
        e.x = best.x; e.y = best.y;
      }
    }
  }

  /* ---------------- 一人称視点（レイキャスティング） ----------------
     盤面の状態はそのまま。描画だけを差し替える。壁は「壁」の一字を
     テクスチャに焼いて貼り、敵・品物・門は距離で拡大する板として置く。 */
  const [viewMode, setViewMode] = useState("top");
  const viewModeRef = useRef("top");
  const fpsCanvas = useRef(null);
  const cam = useRef({ x: 0, y: 0, ang: 0, of: null });   // of=どの迷宮に対する位置か
  const tiles = useRef({});
  const setView = (next) => {
    if (viewModeRef.current === next) return;
    viewModeRef.current = next; setViewMode(next); render();
  };
  const toggleView = () => setView(viewModeRef.current === "top" ? "fps" : "top");

  // 描画本体はfpsView.jsに置いた（確認用ハーネスと同じものを呼ぶため）
  const drawFPS = (ctx, cw, chh) => drawFPSRaw(ctx, cw, chh, {
    world: world.current, cam: cam.current, cache: tiles.current, W, H, ITEM_TYPES,
    swingAt: battle.current.swingAt,
    pickAt: battle.current.pickAt, pickEm: battle.current.pickEm,
  });
  const stepCam = (dt) => stepCamRaw(cam.current, world.current, dt);

  useEffect(() => {
    if (!started || viewMode !== "fps") return;
    let raf = 0, last = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      stepCam(dt);
      const cv = fpsCanvas.current;
      if (cv) { const g = cv.getContext("2d"); if (g) drawFPS(g, cv.width, cv.height); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [started, viewMode]);

  /* ---------------- MP4録画 ---------------- */
  const recCanvas = useRef(null);
  const [recState, setRecState] = useState("idle");
  const [recArm, setRecArm] = useState(false);
  const recArmRef = useRef(false);
  const toggleRecArm = () => { const v = !recArmRef.current; recArmRef.current = v; setRecArm(v); };
  const recRef = useRef({ rec: null, chunks: [], timer: null, t0: 0, dest: null, ext: "mp4" });

  function drawFrame() {
    const cv = recCanvas.current, wv = world.current;
    if (!cv || !wv) return;
    const ctx = cv.getContext("2d");
    const CR = 28, ox = 12, oy = 44;
    ctx.fillStyle = "#14120e"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.textBaseline = "middle";
    // HUD
    ctx.textAlign = "left"; ctx.font = "600 15px serif"; ctx.fillStyle = "#b3a486";
    const hud = `探犬∞　B${wv.depth}F　${wv.dog.name}♥${Math.max(0, wv.dog.hp)}/${wv.dog.maxHp}` +
      (wv.buddy ? `　${wv.buddy.name}♥${Math.max(0, wv.buddy.hp)}` : "") +
      `　金${wv.dog.gold}　♪${MUSIC_STYLES[music.current.style].label}・${SCALES[music.current.scaleKey].name}`;
    ctx.fillText(hud, ox, 22);
    // 一人称のときは録画も一人称で
    if (viewModeRef.current === "fps") {
      ctx.save();
      ctx.beginPath(); ctx.rect(ox, oy, cv.width - ox * 2, cv.height - oy - 12); ctx.clip();
      ctx.translate(ox, oy);
      drawFPS(ctx, cv.width - ox * 2, cv.height - oy - 12);
      ctx.restore();
      return;
    }
    // グリッド
    ctx.textAlign = "center";
    const flipB = beatFlip.current;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = cellVisual(wv, x, y, flipB);
      if (v.ch === "　") continue;
      const cx0 = ox + x * CR + CR / 2, cy0 = oy + y * CR + CR / 2;
      ctx.font = `${v.weight >= 700 ? "700 " : ""}${Math.round(CR * 0.72)}px serif`;
      ctx.fillStyle = v.color;
      if (v.flipX) { ctx.save(); ctx.translate(cx0, cy0); ctx.scale(-1, 1); ctx.fillText(v.ch, 0, 0); ctx.restore(); }
      else ctx.fillText(v.ch, cx0, cy0);
    }
    // 昇天（録画にも映す）
    for (const asc of ascends.current) {
      const op = Math.max(0, 1 - asc.t / 13);
      const cx0 = ox + asc.x * CR + CR / 2, cy0 = oy + asc.y * CR + CR / 2 - asc.t * 5;
      ctx.globalAlpha = op;
      ctx.strokeStyle = "#c8963e"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx0, cy0 - CR * 0.6, 6, 2.5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.font = `${Math.round(CR * 0.72)}px serif`; ctx.fillStyle = "#efe6cf"; ctx.textAlign = "center";
      ctx.fillText(asc.em, cx0, cy0);
      ctx.globalAlpha = 1;
    }
    // ナレーション
    const age = Date.now() - narr.current.at;
    if (narr.current.text && age < 6500) {
      const alpha = Math.max(0, Math.min(0.95, (6500 - age) / 1600));
      ctx.font = "13px serif";
      const tw = ctx.measureText(narr.current.text).width;
      ctx.fillStyle = `rgba(16,14,10,${(0.65 * alpha).toFixed(3)})`;
      ctx.fillRect(cv.width / 2 - tw / 2 - 12, oy + 4, tw + 24, 22);
      ctx.fillStyle = `rgba(232,224,205,${alpha.toFixed(3)})`;
      ctx.fillText(narr.current.text, cv.width / 2, oy + 15);
    }
    // 戦闘窓
    const bt = battle.current;
    if (!wv.dead && bt.cooldown > 0 && bt.foe) {
      const pw = 260, ph = 112, px = cv.width / 2 - pw / 2, py = oy + (H * CR) / 2 - ph / 2;
      ctx.fillStyle = "rgba(16,14,10,0.92)"; ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = "#6b3a2e"; ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
      ctx.fillStyle = "#d9553f"; ctx.font = "10px serif"; ctx.fillText("戦　闘", cv.width / 2, py + 12);
      const al = bt.ally || { e: wv.dog.em, name: wv.dog.name, hp: wv.dog.hp, maxHp: wv.dog.maxHp };
      const ax = px + 65 + (bt.dogAnim ? 14 : 0) + (bt.dogHurt ? (bt.dogHurt % 2 ? -5 : 5) : 0);
      const fx2 = px + pw - 65 - (bt.foeAnim ? 14 : 0) + (bt.foeHurt ? (bt.foeHurt % 2 ? 5 : -5) : 0);
      ctx.font = "44px serif"; ctx.fillStyle = "#e8e0cd";
      ctx.save(); ctx.translate(ax, py + 48); ctx.scale(-1, 1); ctx.fillText(al.e, 0, 0); ctx.restore();
      ctx.globalAlpha = bt.foe.hp <= 0 ? 0.35 : 1;
      ctx.fillText(bt.foeKO ? "💥" : bt.foe.e, fx2, py + 48);
      ctx.globalAlpha = 1;
      ctx.font = "12px serif"; ctx.fillStyle = "#b3a486";
      ctx.fillText(al.name, px + 65, py + 78); ctx.fillText(bt.foe.k, px + pw - 65, py + 78);
      const bar = (bx2, val, max, col) => {
        ctx.fillStyle = "#26221a"; ctx.fillRect(bx2 - 35, py + 88, 70, 5);
        ctx.fillStyle = col; ctx.fillRect(bx2 - 35, py + 88, 70 * Math.max(0, val / max), 5);
      };
      bar(px + 65, al.hp, al.maxHp, "#5ea67a");
      bar(px + pw - 65, bt.foe.hp, bt.foe.maxHp, "#d9553f");
      ctx.font = "700 15px serif";
      for (const f of bt.floats) {
        ctx.fillStyle = `rgba(217,85,63,${Math.max(0, 1 - f.t / 7).toFixed(3)})`;
        ctx.fillText(`−${kanjiNum(f.val)}`, f.side === "dog" ? px + 65 : px + pw - 65, py + 28 - f.t * 3);
      }
    }
    // 大画面昇天（録画にも映す）
    if (bigAscend.current) {
      const ba2 = bigAscend.current;
      const op = Math.max(0, 1 - ba2.t / 16);
      const cx0 = cv.width / 2, cy0 = oy + (H * CR) / 2 - ba2.t * 7;
      ctx.globalAlpha = op;
      ctx.strokeStyle = "#c8963e"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(cx0, cy0 - 48, 17, 6, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.font = "58px serif"; ctx.fillStyle = "#efe6cf"; ctx.textAlign = "center";
      ctx.fillText(ba2.em, cx0, cy0);
      ctx.font = "12px serif"; ctx.fillStyle = "#c8963e";
      ctx.fillText(`${ba2.name}　昇天`, cx0, cy0 + 42);
      ctx.globalAlpha = 1;
    }
    // 死・転生
    if (wv.dead) {
      ctx.fillStyle = "rgba(10,8,6,0.6)"; ctx.fillRect(ox, oy, W * CR, H * CR);
      ctx.fillStyle = "#8f8672"; ctx.font = "56px serif";
      ctx.fillText("死", cv.width / 2, oy + (H * CR) / 2 - 10);
      ctx.font = "11px serif"; ctx.fillStyle = "#655d4c";
      ctx.fillText("——鎮魂歌——", cv.width / 2, oy + (H * CR) / 2 + 30);
    }
    if (rebirth.current > 0) {
      const g = ctx.createRadialGradient(cv.width / 2, oy + (H * CR) / 2, 10, cv.width / 2, oy + (H * CR) / 2, 220);
      g.addColorStop(0, `rgba(200,150,62,${(rebirth.current / 44).toFixed(3)})`);
      g.addColorStop(1, "rgba(20,18,14,0)");
      ctx.fillStyle = g; ctx.fillRect(ox, oy, W * CR, H * CR);
      ctx.fillStyle = `rgba(239,230,207,${Math.min(1, rebirth.current / 12).toFixed(3)})`;
      ctx.font = `${Math.round(64 * (1 + (20 - rebirth.current) * 0.06))}px serif`;
      ctx.fillText("生", cv.width / 2, oy + (H * CR) / 2);
    }
  }

  function pickMime() {
    if (typeof MediaRecorder === "undefined") return "";
    const cands = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm",
    ];
    for (const c of cands) if (MediaRecorder.isTypeSupported(c)) return c;
    return "";
  }

  function startRec() {
    const cv = recCanvas.current;
    if (!cv || !audio.current) return;
    const R = recRef.current;
    drawFrame();
    const vStream = cv.captureStream(30);
    if (!R.dest) {
      R.dest = Tone.getContext().rawContext.createMediaStreamDestination();
      audio.current.out.connect(R.dest);
    }
    const mixed = new MediaStream([...vStream.getVideoTracks(), ...R.dest.stream.getAudioTracks()]);
    const mime = pickMime();
    R.ext = mime.includes("mp4") ? "mp4" : "webm";
    R.chunks = [];
    try {
      R.rec = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
    } catch (e) { pushLog("この環境では録画できません", "sys"); return; }
    R.rec.ondataavailable = ev => { if (ev.data && ev.data.size) R.chunks.push(ev.data); };
    R.rec.onstop = () => {
      const blob = new Blob(R.chunks, { type: mime || "video/webm" });
      const url = URL.createObjectURL(blob);
      const aEl = document.createElement("a");
      aEl.href = url; aEl.download = `tanken-infinity-${Date.now()}.${R.ext}`;
      document.body.appendChild(aEl); aEl.click(); aEl.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      vStream.getTracks().forEach(t => t.stop());
    };
    R.rec.start(1000);
    R.t0 = Date.now();
    R.timer = setInterval(drawFrame, 33);
    setRecState("rec");
    pushLog(`録画開始（${R.ext.toUpperCase()}）`, "sys");
  }

  function stopRec() {
    const R = recRef.current;
    try { R.rec?.stop(); } catch (e) {}
    clearInterval(R.timer); R.timer = null;
    setRecState("idle");
    pushLog("録画を書き出した", "sys");
  }

  function ensurePump() {
    // iOSウォッチドッグ：Transportが刻めない間も、無音のままゲームは進める
    if (pumpRef.current) return;
    pumpRef.current = setInterval(() => {
      if (!startedRef.current || !runningRef.current) return;
      if (Date.now() - lastStepAt.current > 450) {
        try { Tone.getContext().rawContext.resume(); } catch (e) {}
        try { onStep(undefined); } catch (e) {}
      }
    }, 170);
  }

  /* ---------------- 起動・停止 ---------------- */
  const start = async () => {
    // --- iOS解錠：あらゆる発音（TTS含む）より先に、タップ直下で行う ---
    // awaitより前＝ユーザー操作の文脈が生きているうちに読み上げを解錠しておく
    unlockSpeech();
    try {
      await Tone.start();
      const raw = Tone.getContext().rawContext;
      await raw.resume();
      const buf = raw.createBuffer(1, 1, 22050);
      const src = raw.createBufferSource();
      src.buffer = buf; src.connect(raw.destination); src.start(0);
    } catch (e) { /* 解錠失敗時もアプリは継続 */ }
    if (!started) {
      await initAudio();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
      resolvePartyNow();
      newWorld(1, false); // ナレーション（TTS）は解錠・初期化の後
      applyStyle(musicSelRef.current);
      if (recArmRef.current) startRec(); // 予約録画：始動と同時に開始
      setStarted(true); startedRef.current = true;
      ensurePump();
      // 冒頭の口上：この探索がどういうものかを語る。
      // 情景や戦闘の語りに割り込まれず、最後まで言い切らせたいので優先で流す
      narrate("これは、音楽に導かれて迷宮を歩む、小さな命の記録である", 1);
      setTimeout(() => {
        if (world.current && !world.current.dead) narrate("旋律への飽きが偏差を生み、偏差が歩みを深部へと誘う", 1);
      }, 7000);
    } else {
      if (typeof window !== "undefined" && "speechSynthesis" in window) loadVoices();
      Tone.Transport.start();
      try { Tone.getContext().rawContext.resume(); } catch (e) {}
    }
    // ウォッチドッグの基準時刻を今に揃える（停止中に古びた値のまま再開すると、
    // Transportが先に予約した音より過去の時刻で発音してしまう）
    lastStepAt.current = Date.now();
    setRunning(true); runningRef.current = true;
  };
  const pause = () => { Tone.Transport.pause(); setRunning(false); runningRef.current = false; try { window.speechSynthesis?.cancel(); } catch (e) {} render(); };
  const toggleVoice = () => {
    const next = !voiceOnRef.current;
    voiceOnRef.current = next; setVoiceOn(next);
    if (next) unlockSpeech();   // このタップも解錠の好機（切→入で初めて語らせる場合）
    else { try { window.speechSynthesis?.cancel(); } catch (e) {} }
  };
  const reset = () => { prioHold.current = 0; resolvePartyNow(); newWorld(1, false); core.current = { F: 0.1, E: 0.5, A: 0.5, lastOp: "—", opFlash: 0 }; bars.current = 0; rebirth.current = 0; variant.current.coda = pickOther(CODA_TEXTS.length, variant.current.coda); render(); };

  /* 初期画面へ戻る：機関を止めて記録を白紙に返す（音響機関は解錠済みのまま温存） */
  const backToTitle = () => {
    if (recState === "rec") stopRec();          // 録画中なら書き出してから戻る
    try { Tone.Transport.pause(); } catch (e) {}
    try { window.speechSynthesis?.cancel(); } catch (e) {}
    setRunning(false); runningRef.current = false;
    setStarted(false); startedRef.current = false;
    world.current = null;
    core.current = { F: 0.1, E: 0.5, A: 0.5, lastOp: "—", opFlash: 0 };
    battle.current = { foe: null, dogAnim: 0, foeAnim: 0, dogHurt: 0, foeHurt: 0, foeKO: 0, floats: [], cooldown: 0 };
    logRef.current = [];
    narr.current = { text: "", at: 0 };
    ascends.current = []; bigAscend.current = null;
    bars.current = 0; rebirth.current = 0; combatLvl.current = 0; prioHold.current = 0;
    // 戻ってきた初期画面では別の言い回しで迎える
    variant.current = {
      blurb: pickOther(TITLE_BLURBS.length, variant.current.blurb),
      coda: pickOther(CODA_TEXTS.length, variant.current.coda),
    };
    render();
  };

  useEffect(() => {
    // Vキーで視点を切り替える（refとstateの更新なので、古い実体を掴んでいても問題ない）
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
      if (e.key === "v" || e.key === "V") { e.preventDefault(); toggleView(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    // iOS対策：バックグラウンド復帰時にAudioContextを再開する
    const onVis = () => {
      if (document.visibilityState === "visible") {
        try { Tone.getContext().rawContext.resume(); } catch (e) {}
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // iOS対策：どのタップでも解錠を再試行し、Transportを起こす
  useEffect(() => {
    const wake = () => {
      unlockSpeech();   // 保険：どのタップでも一度だけ読み上げを解錠する
      try {
        Tone.start();
        Tone.getContext().rawContext.resume();
        if (startedRef.current && runningRef.current && Tone.Transport.state !== "started") Tone.Transport.start();
      } catch (e) {}
    };
    document.addEventListener("touchend", wake, true);
    document.addEventListener("pointerup", wake, true);
    return () => {
      document.removeEventListener("touchend", wake, true);
      document.removeEventListener("pointerup", wake, true);
    };
  }, []);

  useEffect(() => () => {
    try { Tone.Transport.stop(); Tone.Transport.cancel(); } catch (e) {}
    try { window.speechSynthesis?.cancel(); } catch (e) {}
    try { recRef.current.rec?.stop(); clearInterval(recRef.current.timer); } catch (e) {}
    try { clearInterval(pumpRef.current); } catch (e) {}
  }, []);

  /* ---------------- 描画 ---------------- */
  const w = world.current;
  const c = core.current;
  const m = music.current;
  const flip = beatFlip.current;
  const cell = typeof window !== "undefined" ? Math.max(16, Math.min(26, Math.floor((Math.min(window.innerWidth, 720) - 28) / W))) : 24;
  // 一人称の画面は俯瞰と同じ幅にして、切り替えでレイアウトが跳ねないようにする
  const fpsW = W * cell + 12;
  const fpsH = Math.round(fpsW * 0.62);
  const fpsDpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;

  function cellVisual(wv, x, y, flipB) {
    const k = y * W + x;
    const seen = wv.explored.has(k);
    let ch = "　", color = "#3a352b", weight = 400, glow = false, flipX = false;
    if (seen) {
      const t = wv.map[y][x];
      if (t === "wall") { ch = "壁"; color = "#4a4336"; }
      else if (t === "door") { ch = "門"; color = "#a08b56"; }
      else { ch = "・"; color = "#3f3a30"; }
      if (x === wv.stairs.x && y === wv.stairs.y) { ch = flipB ? "階" : "🕳️"; color = "#8d7bb5"; }
      const it = wv.items.find(i => i.x === x && i.y === y);
      if (it) { const d = ITEM_TYPES[it.type]; ch = flipB ? d.k : d.e; color = it.type === "gold" ? "#c8963e" : "#5ea67a"; }
    }
    const en = wv.enemies.find(e => e.x === x && e.y === y);
    const enVisible = en && (wv.explored.has(k) && (en.alerted || Math.hypot(en.x - wv.dog.x, en.y - wv.dog.y) <= 5.5));
    if (enVisible) {
      ch = en.alerted ? en.e : en.k; color = en.alerted ? "#d9553f" : "#b3a486"; weight = 600; glow = en.alerted;
      if (en.alerted && en.facing === 1) flipX = true; // 絵文字形態のみ反転（漢字は鏡文字にしない）
    }
    if (wv.buddy && wv.buddy.x === x && wv.buddy.y === y) {
      ch = wv.buddy.frame ? wv.buddy.em : wv.buddy.kj;
      color = "#d8cdb2"; weight = 700; glow = true;
      flipX = wv.buddy.frame === 1 && wv.buddy.facing === 1;
    }
    if (wv.dog.x === x && wv.dog.y === y) {
      ch = wv.dead ? "骨" : (wv.dog.frame ? wv.dog.em : wv.dog.kj);
      color = wv.dead ? "#6b6455" : "#efe6cf"; weight = 700; glow = !wv.dead;
      flipX = !wv.dead && wv.dog.frame === 1 && wv.dog.facing === 1;
    }
    return { ch, color, weight, glow, flipX };
  }

  const cells = [];
  if (w) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x;
      const v = cellVisual(w, x, y, flip);
      cells.push(
        <div key={k} style={{
          width: cell, height: cell, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: cell * 0.72, lineHeight: 1, color: v.color, fontWeight: v.weight,
          textShadow: v.glow ? `0 0 ${cell / 3}px ${v.color}` : "none",
          transform: v.flipX ? "scaleX(-1)" : "none",
          transition: "color 120ms",
        }}>{v.ch}</div>
      );
    }
  }

  const Bar = ({ label, val, color, band }) => (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8f8672", marginBottom: 2 }}>
        <span>{label}</span><span style={{ fontFamily: "monospace" }}>{(val * 100).toFixed(0)}</span>
      </div>
      <div style={{ position: "relative", height: 6, background: "#26221a", borderRadius: 3, overflow: "hidden" }}>
        {band && <div style={{ position: "absolute", left: `${band[0] * 100}%`, width: `${(band[1] - band[0]) * 100}%`, top: 0, bottom: 0, background: "#3d3527" }} />}
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, val * 100)}%`, background: color, borderRadius: 3, transition: "width 300ms" }} />
      </div>
    </div>
  );

  const logColors = { sys: "#8f8672", fight: "#d9553f", item: "#c8963e", dev: "#8d7bb5" };
  const b = battle.current;
  const ba = b.ally || (w ? { k: w.dog.kj, e: w.dog.em, name: w.dog.name, hp: w.dog.hp, maxHp: w.dog.maxHp } : null);
  const inFight = started && w && !w.dead && b.cooldown > 0 && b.foe && ba;
  // 打ち合いの瞬間だけ強く光る（攻撃・被弾のカウンタが立っている間）
  // 拡大した戦闘画は俯瞰のときだけ。一人称では視界を塞ぐので閃光に任せる
  const showBattle = inFight && viewMode === "top";
  const hitPulse = inFight ? Math.max(b.dogAnim, b.foeAnim, b.dogHurt, b.foeHurt) : 0;
  const flashAlpha = inFight ? Math.min(0.5, hitPulse * 0.14) : 0;
  const narrAge = Date.now() - narr.current.at;
  const narrOpacity = Math.max(0, Math.min(0.95, (6500 - narrAge) / 1600));

  return (
    <div style={{
      minHeight: "100vh", background: "#14120e", color: "#e8e0cd",
      fontFamily: "'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif",
      display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 12px 40px",
    }}>
      <canvas ref={recCanvas} width={W * 28 + 24} height={H * 28 + 60}
        style={{ position: "fixed", left: -9999, top: 0, pointerEvents: "none" }} />
      <div style={{ width: "100%", maxWidth: 720 }}>
        <header style={{ display: "flex", alignItems: "baseline", gap: 14, borderBottom: "1px solid #322d22", paddingBottom: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, margin: 0, letterSpacing: "0.12em", fontWeight: 700 }}>
            探犬<span style={{ color: "#8d7bb5" }}>∞</span>
          </h1>
          <span style={{ fontSize: 11, color: "#8f8672", letterSpacing: "0.18em" }}>音楽駆動・自動探査ローグ｜偏差機関搭載</span>
          {w && !w.dead && (
            <span style={{ marginLeft: "auto", fontSize: 13, fontFamily: "monospace", color: "#b3a486" }}>
              B{w.depth}F　{w.dog.name}♥{Math.max(0, w.dog.hp)}/{w.dog.maxHp}
              {w.buddy && <>　{w.buddy.name}♥{Math.max(0, w.buddy.hp)}/{w.buddy.maxHp}</>}
              　腹{Math.round(100 - w.dog.hunger)}　金{w.dog.gold}
            </span>
          )}
        </header>

        {!started && (
          <div style={{ textAlign: "center", padding: "48px 20px", border: "1px solid #322d22", borderRadius: 8, background: "#1a1712" }}>
            <div style={{ fontSize: 52, marginBottom: 8 }}>
              {partySel === "random" ? "？" : (PARTY_OPTIONS.find(o => o.id === partySel)?.members || ["dog"]).map(k => CHARACTERS[k].k).join("")}
            </div>
            <p style={{ color: "#8f8672", fontSize: 13, lineHeight: 1.9, maxWidth: 420, margin: "0 auto 20px" }}>
              {TITLE_BLURBS[variant.current.blurb].map((line, i) => (
                <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>
              ))}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 12 }}>
              {PARTY_OPTIONS.map(o => (
                <button key={o.id}
                  onClick={() => { setPartySel(o.id); partySelRef.current = o.id; }}
                  style={{
                    ...btnStyle(false),
                    padding: "6px 16px",
                    borderColor: partySel === o.id ? "#8d7bb5" : "#4a4336",
                    color: partySel === o.id ? "#e8e0cd" : "#8f8672",
                    background: partySel === o.id ? "rgba(141,123,181,0.12)" : "transparent",
                  }}>{o.label}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 24 }}>
              {Object.entries(MUSIC_STYLES).map(([id, sd]) => (
                <button key={id}
                  onClick={() => selectStyle(id)}
                  style={{
                    ...btnStyle(false),
                    padding: "5px 14px", fontSize: 12,
                    borderColor: musicSel === id ? "#c8963e" : "#4a4336",
                    color: musicSel === id ? "#e8e0cd" : "#8f8672",
                    background: musicSel === id ? "rgba(200,150,62,0.1)" : "transparent",
                  }}>♪ {sd.label}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={toggleRecArm} style={{
                ...btnStyle(false), fontSize: 12, padding: "6px 14px",
                borderColor: recArm ? "#d9553f" : "#4a4336",
                color: recArm ? "#d9553f" : "#655d4c",
                background: recArm ? "rgba(217,85,63,0.08)" : "transparent",
              }}>{recArm ? "●始動と同時に録画する" : "○始動と同時に録画"}</button>
              <button onClick={start} style={btnStyle(true)}>▶ 機関始動</button>
            </div>
          </div>
        )}

        {started && w && (
          <>
            <div style={{ position: "relative", width: "fit-content", margin: "0 auto" }}>
              {viewMode === "fps" ? (
                <canvas ref={fpsCanvas}
                  width={Math.round(fpsW * fpsDpr)} height={Math.round(fpsH * fpsDpr)}
                  style={{
                    display: "block", width: fpsW, height: fpsH,
                    background: "#100e0a", border: "1px solid #322d22", borderRadius: 6,
                    boxShadow: w.combat ? "0 0 24px rgba(217,85,63,0.15)" : "none", transition: "box-shadow 600ms",
                  }} />
              ) : (
                <div style={{
                  display: "grid", gridTemplateColumns: `repeat(${W}, ${cell}px)`,
                  background: "#100e0a", border: "1px solid #322d22", borderRadius: 6,
                  padding: 6,
                  boxShadow: w.combat ? "0 0 24px rgba(217,85,63,0.15)" : "none", transition: "box-shadow 600ms",
                }}>{cells}</div>
              )}

              {/* 昇天：天使の輪とともに上へ消えていく（俯瞰のみ。一人称では板として描く） */}
              {viewMode === "top" && ascends.current.map(asc => (
                <div key={asc.id} style={{
                  position: "absolute", left: 6 + asc.x * cell, top: 6 + asc.y * cell - asc.t * 5,
                  width: cell, textAlign: "center", pointerEvents: "none", zIndex: 2,
                  opacity: Math.max(0, 1 - asc.t / 13), transition: "top 150ms linear, opacity 150ms linear",
                }}>
                  <div style={{
                    width: 12, height: 5, border: "2px solid #c8963e", borderRadius: "50%",
                    margin: "0 auto 1px", boxShadow: "0 0 6px #c8963e",
                  }} />
                  <div style={{ fontSize: cell * 0.72, lineHeight: 1 }}>{asc.em}</div>
                </div>
              ))}

              {/* 物語ナレーション（非干渉オーバーレイ） */}
              {narr.current.text && narrAge < 6500 && (
                <div style={{ position: "absolute", top: 8, left: 0, right: 0, textAlign: "center", pointerEvents: "none", zIndex: 2 }}>
                  <span style={{
                    display: "inline-block", fontSize: 12, letterSpacing: "0.08em", color: "#e8e0cd",
                    background: "rgba(16,14,10,0.6)", padding: "3px 14px", borderRadius: 12,
                    maxWidth: "94%", lineHeight: 1.7,
                    opacity: narrOpacity, transition: "opacity 500ms",
                  }}>{narr.current.text}</span>
                </div>
              )}

              {/* 戦闘拡大窓：絵文字同士の対戦 */}
              {/* 一人称の戦闘：拡大枠を出さない代わりに、打ち合いに合わせて閃かせる */}
              {viewMode === "fps" && inFight && (
                <div style={{
                  position: "absolute", inset: 0, zIndex: 3, borderRadius: 6, pointerEvents: "none",
                  boxShadow: `inset 0 0 ${28 + hitPulse * 16}px rgba(217,85,63,${(0.22 + flashAlpha).toFixed(3)})`,
                  background: flashAlpha > 0.01 ? `rgba(217,85,63,${(flashAlpha * 0.42).toFixed(3)})` : "transparent",
                  transition: "background 70ms linear, box-shadow 90ms linear",
                }}>
                  <div style={{
                    position: "absolute", left: 0, right: 0, top: 6, textAlign: "center",
                    fontSize: 10, letterSpacing: "0.4em", color: "#d9553f",
                    opacity: 0.55 + Math.min(0.45, hitPulse * 0.16),
                  }}>戦　闘</div>
                </div>
              )}


              {showBattle && (
                <div style={{
                  position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)",
                  zIndex: 3, background: "rgba(16,14,10,0.9)", border: "1px solid #6b3a2e",
                  borderRadius: 10, padding: "12px 20px 12px", width: Math.min(310, W * cell - 30),
                  boxShadow: "0 8px 40px rgba(0,0,0,0.65)", pointerEvents: "none",
                }}>
                  <div style={{ textAlign: "center", fontSize: 10, letterSpacing: "0.4em", color: "#d9553f", marginBottom: 4 }}>戦　闘</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
                    <div style={{ textAlign: "center", flex: 1 }}>
                      <div style={{
                        fontSize: 56, lineHeight: 1.15,
                        transform: `translateX(${(b.dogAnim ? 16 : 0) + (b.dogHurt ? (b.dogHurt % 2 ? -6 : 6) : 0)}px) scaleX(-1)`,
                        filter: b.dogHurt ? "drop-shadow(0 0 10px #d9553f)" : "none",
                        transition: "transform 90ms",
                      }}>{ba.e}</div>
                      <div style={{ fontSize: 12, color: "#b3a486", marginTop: 2 }}>{ba.name}</div>
                      <HpBar val={ba.hp} max={ba.maxHp} color="#5ea67a" />
                    </div>
                    <div style={{ fontSize: 18, color: "#655d4c", padding: "0 10px", fontWeight: 700 }}>対</div>
                    <div style={{ textAlign: "center", flex: 1 }}>
                      <div style={{
                        fontSize: 56, lineHeight: 1.15,
                        transform: `translateX(${(b.foeAnim ? -16 : 0) + (b.foeHurt ? (b.foeHurt % 2 ? 6 : -6) : 0)}px)`,
                        filter: b.foeHurt ? "drop-shadow(0 0 10px #d9553f)" : "none",
                        opacity: b.foe.hp <= 0 ? 0.3 : 1,
                        transition: "transform 90ms, opacity 300ms",
                      }}>{b.foeKO ? "💥" : b.foe.e}</div>
                      <div style={{ fontSize: 12, color: "#b3a486", marginTop: 2 }}>{b.foe.k}</div>
                      <HpBar val={b.foe.hp} max={b.foe.maxHp} color="#d9553f" />
                    </div>
                    {b.floats.map(f => (
                      <div key={f.id} style={{
                        position: "absolute", top: -4 - f.t * 4,
                        [f.side === "dog" ? "left" : "right"]: "16%",
                        color: "#d9553f", fontSize: 17, fontWeight: 700,
                        opacity: Math.max(0, 1 - f.t / 7), textShadow: "0 1px 3px #000",
                      }}>−{kanjiNum(f.val)}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* 大画面昇天：戦闘の中央で天使の輪とともに昇る */}
              {bigAscend.current && (
                <div style={{
                  position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)",
                  zIndex: 6, pointerEvents: "none", textAlign: "center",
                  opacity: Math.max(0, 1 - bigAscend.current.t / 16),
                }}>
                  {/* 昇る本人を大きく映す。上るほど膨らみ、光に溶けていく */}
                  <div style={{
                    transform: `translateY(${-bigAscend.current.t * 7}px) scale(${(1 + bigAscend.current.t * 0.085).toFixed(3)})`,
                    transition: "transform 150ms linear",
                  }}>
                    <div style={{
                      width: 44, height: 16, border: "3px solid #c8963e", borderRadius: "50%",
                      margin: "0 auto 4px", boxShadow: "0 0 22px #c8963e",
                    }} />
                    <div style={{
                      fontSize: 108, lineHeight: 1.1,
                      filter: `drop-shadow(0 0 ${18 + bigAscend.current.t * 2.4}px #c8963e)`,
                    }}>
                      {bigAscend.current.em}
                    </div>
                    <div style={{ fontSize: 12, color: "#c8963e", letterSpacing: "0.35em", marginTop: 8 }}>
                      {bigAscend.current.name}　昇天
                    </div>
                  </div>
                </div>
              )}

              {/* 死のベール＋鎮魂歌 */}
              {w.dead && (
                <div style={{
                  position: "absolute", inset: 0, zIndex: 4, borderRadius: 6,
                  background: "rgba(10,8,6,0.6)", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", pointerEvents: "none",
                }}>
                  <div style={{ fontSize: 64, color: "#8f8672", textShadow: "0 0 30px #000" }}>死</div>
                  <div style={{ fontSize: 11, color: "#655d4c", letterSpacing: "0.4em", marginTop: 8 }}>——鎮魂歌——</div>
                </div>
              )}

              {/* 転生エフェクト */}
              {rebirth.current > 0 && (
                <div style={{
                  position: "absolute", inset: 0, zIndex: 5, borderRadius: 6, pointerEvents: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: `radial-gradient(circle, rgba(200,150,62,${(rebirth.current / 44).toFixed(3)}) 0%, rgba(20,18,14,0) 72%)`,
                }}>
                  <div style={{
                    fontSize: 76, color: "#efe6cf", textShadow: "0 0 40px #c8963e",
                    transform: `scale(${(1 + (20 - rebirth.current) * 0.06).toFixed(2)})`,
                    opacity: (Math.min(1, rebirth.current / 12)).toFixed(2),
                    transition: "transform 140ms, opacity 140ms",
                  }}>生</div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", margin: "14px 0" }}>
              {running
                ? <button onClick={pause} style={btnStyle(false)}>❚❚ 停止</button>
                : <button onClick={start} style={btnStyle(true)}>▶ 再開</button>}
              <button onClick={reset} style={btnStyle(false)}>新しい迷宮</button>
              <button onClick={backToTitle} style={{ ...btnStyle(false), color: "#8d7bb5", borderColor: "#4a4336" }}>◀ 初期画面</button>
              {[["top", "▦ 俯瞰"], ["fps", "◈ 一人称"]].map(([id, label]) => (
                <button key={id} onClick={() => setView(id)} title="Vキーでも切り替わります"
                  style={{
                    ...btnStyle(false), padding: "8px 12px", fontSize: 12,
                    borderColor: viewMode === id ? "#8d7bb5" : "#4a4336",
                    color: viewMode === id ? "#e8e0cd" : "#655d4c",
                    background: viewMode === id ? "rgba(141,123,181,0.14)" : "transparent",
                  }}>{label}</button>
              ))}
              <button onClick={toggleVoice} style={{ ...btnStyle(false), color: voiceOn ? "#c8963e" : "#655d4c" }}>
                {voiceOn ? "語り 入" : "語り 切"}
              </button>
              {voiceOn && (
                <button onClick={cycleRate} style={{ ...btnStyle(false), color: "#c8963e", fontFamily: "monospace" }}>
                  {speechRate.toFixed(1)}×
                </button>
              )}
              {Object.entries(MUSIC_STYLES).map(([id, sd]) => (
                <button key={id} onClick={() => selectStyle(id)}
                  style={{
                    ...btnStyle(false), padding: "8px 12px", fontSize: 12,
                    borderColor: musicSel === id ? "#c8963e" : "#4a4336",
                    color: musicSel === id ? "#e8e0cd" : "#655d4c",
                  }}>♪{sd.label}</button>
              ))}
              {recState === "idle"
                ? <button onClick={startRec} style={{ ...btnStyle(false), color: "#d9553f" }}>●録画</button>
                : <button onClick={stopRec} style={{ ...btnStyle(false), borderColor: "#d9553f", color: "#d9553f", fontFamily: "monospace" }}>
                    ■保存 {Math.floor((Date.now() - recRef.current.t0) / 1000)}s
                  </button>}
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <section style={{ flex: "1 1 240px", background: "#1a1712", border: "1px solid #322d22", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                  <h2 style={{ fontSize: 13, margin: 0, letterSpacing: "0.2em", color: "#b3a486" }}>偏差機関</h2>
                  <span style={{ fontSize: 11, fontFamily: "monospace", color: c.opFlash ? "#8d7bb5" : "#655d4c" }}>
                    {w.combat ? "戦闘律動" : "探索律動"}｜{NOTE_NAMES[((m.root % 12) + 12) % 12]}・{SCALES[m.scaleKey].name}
                  </span>
                </div>
                <Bar label="慣れ F（反復への飽和）" val={c.F} color="#5ea67a" />
                <Bar label="予測誤差 E（逸脱の量）" val={c.E} color="#d9553f" />
                <Bar label="覚醒度 A（Wundt目標帯）" val={c.A} color="#8d7bb5" band={[0.35, 0.8]} />
                <div style={{ fontSize: 11, color: "#8f8672", marginTop: 8 }}>
                  最終オペレータ：<span style={{ color: "#8d7bb5", fontFamily: "monospace" }}>{c.lastOp}</span>
                  <span style={{ float: "right", fontFamily: "monospace" }}>{bars.current}小節</span>
                </div>
              </section>

              <section style={{ flex: "1 1 240px", background: "#1a1712", border: "1px solid #322d22", borderRadius: 8, padding: "12px 14px" }}>
                <h2 style={{ fontSize: 13, margin: "0 0 10px", letterSpacing: "0.2em", color: "#b3a486" }}>行動記録</h2>
                <div style={{ fontSize: 12, lineHeight: 1.9 }}>
                  {logRef.current.map((l, i) => (
                    <div key={l.id} style={{ color: logColors[l.kind], opacity: 1 - i * 0.09 }}>{l.text}</div>
                  ))}
                </div>
              </section>
            </div>

            <p style={{ fontSize: 11, color: "#655d4c", lineHeight: 1.9, marginTop: 16 }}>
              {CODA_TEXTS[variant.current.coda].join("")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const HpBar = ({ val, max, color }) => (
  <div style={{ height: 4, background: "#26221a", borderRadius: 2, marginTop: 5, overflow: "hidden" }}>
    <div style={{ height: "100%", width: `${Math.max(0, (val / max) * 100)}%`, background: color, transition: "width 160ms" }} />
  </div>
);

const btnStyle = (primary) => ({
  background: primary ? "#8d7bb5" : "transparent",
  color: primary ? "#14120e" : "#b3a486",
  border: primary ? "none" : "1px solid #4a4336",
  borderRadius: 6, padding: "8px 22px", fontSize: 14, letterSpacing: "0.1em",
  fontFamily: "inherit", cursor: "pointer", fontWeight: 600,
});
