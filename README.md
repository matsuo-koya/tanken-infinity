# 探犬∞ TANKEN INFINITY

音楽駆動・自動探査ローグライク（偏差機関搭載）。
漢字・かな・絵文字だけで描かれる迷宮を、音楽に導かれた命（犬・猫・人・二人旅）が自動で潜っていきます。

- 偏差機関：慣れF／予測誤差E／覚醒度AのWundt制御が、音楽の逸脱（MEDIANT等）と探索衝動を同時に駆動
- 楽風：和（平調子ミニマル）／弦楽（バッハ様式・常動曲）／オルガン（倍音加算パイプ）／EDM
- 死：弦楽・オルガンはクルツィフィクスス型の自動生成レクイエム、和・EDMは「怒りの日」
- 転生：復活祭オラトリオ（BWV249）風の生成ファンファーレ
- Web Speech APIによる語り（読み上げ速度可変）、MP4/WebM録画機能つき

## 開発

```bash
npm install
npm run dev
```

## デプロイ（GitHub Pages）

1. このリポジトリをGitHubへpush（mainブランチ）
2. リポジトリの Settings → Pages → Source を **GitHub Actions** に設定
3. push のたびに `.github/workflows/deploy.yml` が自動でビルド・公開

公開URL: `https://<ユーザー名>.github.io/<リポジトリ名>/`

## 注意（iOS）

初回タップでオーディオを解錠します。語り（TTS）はOS側で再生されるため録画には含まれません。
