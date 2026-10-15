# Firebase Rules 反映・切り戻し手順

## 反映前の必須条件

1. `npm run security:static` と `npm run security:rules` が全件合格している。
2. `deploy-local-rules.mjs --target=diagnosis` で診断Firebaseに反映する。
3. `security:staging-verify` と `security:staging-role-apis` が合格する。
4. `security:compare-production` で診断RulesとローカルRulesの一致を確認する。

## 本番反映

```sh
node scripts/security/deploy-local-rules.mjs --target=production --confirm-project=class-base-app
```

出力される `rollback_rulesets` は監査記録に保存する。反映後は比較スクリプトを再実行し、Firestore・Storageの本番、診断、ローカルがすべて一致することを確認する。

## 2026-10-03 反映の切り戻し先

- Firestore: `projects/class-base-app/rulesets/810b17e6-6257-43a2-9c37-aa2ad3bd45ce`
- Storage: `projects/class-base-app/rulesets/04a82556-aab3-4ad4-97f3-37b800e254dc`

上記反映による権限エラーが複数ロールで発生し、新Rulesの修正をすぐに反映できない場合だけ、次を実行する。

```sh
node scripts/security/rollback-rules-release.mjs \
  --confirm-project=class-base-app \
  --firestore=projects/class-base-app/rulesets/810b17e6-6257-43a2-9c37-aa2ad3bd45ce \
  --storage=projects/class-base-app/rulesets/04a82556-aab3-4ad4-97f3-37b800e254dc
```

切り戻し後は、理由、実行者、時刻、影響ロール、再発防止策を障害記録に残す。
