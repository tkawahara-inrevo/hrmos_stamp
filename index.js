import pkg from "@slack/bolt";

const { App, WorkflowStep, ExpressReceiver } = pkg;

const port = process.env.PORT || 3000;

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse: false
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  processBeforeResponse: false
});

receiver.app.get("/", (req, res) => {
  res.status(200).send("ok");
});

const step = new WorkflowStep("hrmos_stamp_step", {

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

  save: async ({ ack }) => {
    await ack({
      outputs: []
    });
  },

  execute: async ({ step, complete, fail }) => {

    try {

      console.log("WF EXECUTE");

      console.log({
        step_id: step?.id,
        actor_user_id: step?.actor_user_id
      });

      await complete({});

    } catch (err) {

      console.error(err);

      await fail({
        error: { message: String(err) }
      });

    }

  }

});

app.step(step);

(async () => {

  await app.start(port);

  console.log("⚡ Bolt running on", port);

})();