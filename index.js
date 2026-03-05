import { App, WorkflowStep } from "@slack/bolt";

// Render で必須：PORT を使う
const port = process.env.PORT || 3000;

// Slack App の設定値（Renderの環境変数に入れる）
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,              // xoxb-...
  signingSecret: process.env.SLACK_SIGNING_SECRET // App Credentials
});

// ✅ Workflow Builder で使える「カスタムステップ」
// ここは Slack App の "Workflow Steps" で作った Step の Callback ID と一致させる
const step = new WorkflowStep("hrmos_stamp_step", {
  // ワークフロー編集時の入力画面（あとで作る。今は最低限）
  edit: async ({ ack, step, configure }) => {
    await ack();

    // いったん入力なしでも使えるように「保存だけ」できる画面にする
    // （後で stampフラグ等を追加する）
    await configure({
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "HRMOS打刻ステップの設定（いまはテスト用）🐣" }
        }
      ]
    });
  },

  // ワークフロー保存時
  save: async ({ ack, step, view }) => {
    await ack({
      outputs: [] // いまは出力なし
    });
  },

  // ワークフロー実行時（ここが本番の処理）
  execute: async ({ step, complete, fail, client }) => {
    try {
      // このステップを実行したSlackユーザー
      const slackUserId = step?.inputs?.user_id?.value || step?.inputs?.user?.value || step?.actor_user_id;

      // 実際は inputs をちゃんと定義して user_id を渡すのが正道（次でやる）
      // いまは “実行された” ことが分かればOKなのでログ目的で users.info 呼ぶ
      let email = "";
      if (slackUserId) {
        const info = await client.users.info({ user: slackUserId });
        email = info?.user?.profile?.email || "";
      }

      console.log("[WF EXECUTE]", {
        step_id: step?.id,
        actor_user_id: step?.actor_user_id,
        slackUserId,
        email_present: !!email
      });

      // ひとまず成功にする（次のステップでGAS叩いてHRMOS打刻にする）
      await complete({});
    } catch (e) {
      console.error(e);
      await fail({ error: { message: String(e) } });
    }
  }
});

app.step(step);

// 起動
(async () => {
  await app.start(port);
  console.log(`⚡️ Bolt app is running on port ${port}`);
})();