import { App, WorkflowStep, ExpressReceiver } from "@slack/bolt";

const port = process.env.PORT || 3000;

// ✅ ExpressReceiver を使う（HTTP受信 & health check をちゃんと付ける）
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  // Slackからのリクエストを先にACK返しやすくする
  processBeforeResponse: false,
});

// ✅ ここが “本体”
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  processBeforeResponse: false,
});

// ✅ health check（Renderの疎通確認に便利）
receiver.app.get("/", (req, res) => {
  res.status(200).send("ok");
});

// ---- Workflow Step ----
// Slack App側で作った Callback ID と一致させる
const step = new WorkflowStep("hrmos_stamp_step", {
  edit: async ({ ack, configure }) => {
    await ack();
    await configure({
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "HRMOS打刻ステップ（テスト）🐣" },
        },
      ],
    });
  },

  save: async ({ ack }) => {
    await ack({ outputs: [] });
  },

  execute: async ({ step, complete, fail }) => {
    try {
      // ✅ まずは軽くログだけ（3秒制限対策）
      console.log("[WF EXECUTE]", {
        step_id: step?.id,
        workflow_id: step?.workflow_id,
        actor_user_id: step?.actor_user_id,
      });

      // ✅ いったん必ず成功（次のステップで users.info や GAS を入れる）
      await complete({});
    } catch (err) {
      console.error("[WF ERROR]", err);
      await fail({ error: { message: String(err?.message || err) } });
    }
  },
});

app.step(step);

// 起動
(async () => {
  await app.start(port);
  console.log(`⚡️ Bolt app running on port ${port}`);
})();