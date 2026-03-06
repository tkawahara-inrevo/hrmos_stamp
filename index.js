import pkg from "@slack/bolt";
import crypto from "node:crypto";

const { App, ExpressReceiver } = pkg;

const port = process.env.PORT || 3000;

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse: false,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  processBeforeResponse: false,
});

// Render health check
receiver.app.get("/", (_req, res) => {
  res.status(200).send("ok");
});

function safeString(v) {
  return v == null ? "" : String(v);
}

function normalizeWorkflowType(workflowId, inputs) {
  const explicit =
    safeString(inputs?.workflow_type || inputs?.type || inputs?.stamp_type).toLowerCase();

  if (explicit.includes("out")) return "clock_out";
  if (explicit.includes("in")) return "clock_in";

  const wfClockInId = safeString(process.env.WF_CLOCK_IN_ID);
  const wfClockOutId = safeString(process.env.WF_CLOCK_OUT_ID);

  if (workflowId && wfClockOutId && workflowId === wfClockOutId) return "clock_out";
  if (workflowId && wfClockInId && workflowId === wfClockInId) return "clock_in";

  return "clock_in";
}

function extractActorUserId(body, inputs) {
  return (
    safeString(body?.event?.user_id) ||
    safeString(body?.event?.actor_user_id) ||
    safeString(body?.interactivity?.interactor?.id) ||
    safeString(body?.user_id) ||
    safeString(inputs?.reporter_user_id) ||
    safeString(inputs?.user_id) ||
    safeString(inputs?.user)
  );
}

function extractChannelId(body, inputs) {
  return (
    safeString(body?.event?.channel_id) ||
    safeString(body?.channel?.id) ||
    safeString(body?.container?.channel_id) ||
    safeString(inputs?.channel_id) ||
    safeString(inputs?.channel)
  );
}

function normalizeStampFlag(inputs) {
  const raw =
    safeString(inputs?.hrmos_stamp) ||
    safeString(inputs?.stamp) ||
    safeString(inputs?.do_stamp);

  return raw.trim();
}

async function postToGas(payload) {
  const gasUrl = safeString(process.env.GAS_WEBAPP_URL);
  if (!gasUrl) {
    throw new Error("Missing env: GAS_WEBAPP_URL");
  }

  const res = await fetch(gasUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  return {
    status: res.status,
    okHttp: res.ok,
    bodyText: text,
  };
}

// Slack Custom Step callback_id と一致させる
app.function("hrmos_stamp_step", async ({ body, inputs, complete, fail, logger }) => {
  try {
    const workflowId =
      safeString(body?.event?.workflow?.id) ||
      safeString(body?.workflow?.id) ||
      safeString(body?.event?.workflow_id);

    const workflowExecutionId =
      safeString(body?.event?.workflow_execution_id) ||
      safeString(body?.workflow_execution_id);

    const actorUserId = extractActorUserId(body, inputs);
    const channelId = extractChannelId(body, inputs);
    const workflowType = normalizeWorkflowType(workflowId, inputs);
    const hrmosStamp = normalizeStampFlag(inputs);

    logger.info("[FUNCTION_RECEIVED]", {
      workflowId,
      workflowExecutionId,
      actorUserId,
      channelId,
      workflowType,
      hrmosStamp,
      inputKeys: Object.keys(inputs || {}),
    });

    // まずSlackには即成功を返す
    await complete({ outputs: {} });

    // 以降は非同期でGASへ
    setImmediate(async () => {
      const requestId = crypto.randomUUID();

      try {
        const payload = {
          workflow_type: workflowType,
          channel_id: channelId,
          reporter_user_id: actorUserId,
          hrmos_stamp: hrmosStamp,
          secret: safeString(process.env.GAS_SHARED_SECRET),
          meta: {
            request_id: requestId,
            workflow_id: workflowId,
            workflow_execution_id: workflowExecutionId,
          },
        };

        logger.info("[GAS_POST_REQUEST]", {
          requestId,
          payloadPreview: {
            workflow_type: payload.workflow_type,
            channel_id: payload.channel_id,
            reporter_user_id: payload.reporter_user_id,
            hrmos_stamp: payload.hrmos_stamp,
            has_secret: !!payload.secret,
          },
        });

        const gasRes = await postToGas(payload);

        logger.info("[GAS_POST_RESPONSE]", {
          requestId,
          status: gasRes.status,
          okHttp: gasRes.okHttp,
          bodyPreview: safeString(gasRes.bodyText).slice(0, 300),
        });
      } catch (bgErr) {
        logger.error("[GAS_POST_ERROR]", {
          requestId,
          error: safeString(bgErr?.stack || bgErr),
        });
      }
    });
  } catch (err) {
    logger.error("[FUNCTION_ERROR]", safeString(err?.stack || err));

    await fail({
      error: `hrmos_stamp_step failed: ${safeString(err?.message || err)}`,
    });
  }
});

(async () => {
  await app.start(port);
  console.log(`⚡ Bolt app running on port ${port}`);
})();