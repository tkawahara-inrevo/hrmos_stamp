import { App, WorkflowStep } from "@slack/bolt";

const port = process.env.PORT || 3000;

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,

  // Render + Slack用
  processBeforeResponse: false
});

/*
Workflow Step
Callback ID と一致させる
*/
const step = new WorkflowStep("hrmos_stamp_step", {

  /*
  WF編集時
  */
  edit: async ({ ack, configure }) => {
    await ack();

    await configure({
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "HRMOS打刻ステップ（テスト）"
          }
        }
      ]
    });
  },

  /*
  保存時
  */
  save: async ({ ack }) => {
    await ack({
      outputs: []
    });
  },

  /*
  WF実行時
  */
  execute: async ({ step, complete, fail }) => {
    try {

      console.log("WF STEP EXECUTE");

      console.log({
        step_id: step?.id,
        actor_user_id: step?.actor_user_id,
        workflow_id: step?.workflow_id
      });

      /*
      いまはとにかく成功させる
      */
      await complete({});

    } catch (err) {

      console.error("WF STEP ERROR", err);

      await fail({
        error: {
          message: err.message
        }
      });

    }
  }
});

app.step(step);


/*
ヘルスチェック
*/
app.get("/", async (req, res) => {
  res.send("Slack Bolt HRMOS app running");
});


/*
サーバ起動
*/
(async () => {

  await app.start(port);

  console.log("⚡ Bolt app running on port", port);

})();