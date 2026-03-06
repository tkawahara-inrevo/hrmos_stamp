import pkg from "@slack/bolt";

const { App, ExpressReceiver } = pkg;

const port = process.env.PORT || 3000;

// Render/Slack用（署名検証 + 早期レスポンス）
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse: false,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  processBeforeResponse: false,
});

// ---- health check ----
receiver.app.get("/", (_req, res) => res.status(200).send("ok"));

// ---- util: safe fetch with timeout ----
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ---- util: Slack user id -> email ----
async function getSlackEmail(client, userId) {
  const info = await client.users.info({ user: userId });
  const email = info?.user?.profile?.email || "";
  return String(email || "").toLowerCase();
}

// ---- util: decide IN/OUT ----
// 方式A: workflow_idで判定（おすすめ）
//  - RenderのENVに WF_CLOCK_IN_ID / WF_CLOCK_OUT_ID を入れる
// 方式B: inputs.type があればそれを優先
function decideStampType({ workflowId, inputs }) {
  const t = String(inputs?.type || inputs?.stamp_type || "").toLowerCase();
  if (t === "out" || t === "clock_out") return "OUT";
  if (t === "in" || t === "clock_in") return "IN";

  const wfIn = process.env.WF_CLOCK_IN_ID || "";
  const wfOut = process.env.WF_CLOCK_OUT_ID || "";
  if (workflowId && wfOut && workflowId === wfOut) return "OUT";
  if (workflowId && wfIn && workflowId === wfIn) return "IN";

  // どっちでもない時はINに倒す（ログで気づけるようにする）
  return "IN";
}

// ---- util: should stamp? ----
// inputs.stamp が "する" のときだけ true
function shouldStamp(inputs) {
  const flag = String(inputs?.stamp || inputs?.hrmos_stamp || "").trim();
  if (!flag) return true; // 入力が無い運用なら「する」前提にしておく（必要ならfalseに変えてね）
  return flag === "する" || flag.toLowerCase() === "true";
}

// =====================================================
// ✅ Custom Step listener（これが本体）
// Callback ID は Slack App側で作ったものと一致させる
// =====================================================
app.function("hrmos_stamp_step", async ({ client, inputs, complete, fail, body, logger }) => {
  // ここで重いことをすると3秒で死ぬので、まずログだけ＆即complete
  try {
    const workflowId =
      body?.event?.workflow?.id ||
      body?.workflow?.id ||
      body?.event?.workflow_id ||
      "";

    const actorUserId =
      body?.event?.user_id ||
      body?.event?.actor_user_id ||
      body?.user_id ||
      "";

    logger.info("[FUNCTION_IN]", {
      workflowId,
      actorUserId,
      inputsKeys: Object.keys(inputs || {}),
    });

    // ✅ Slackへの応答を先に返す（失敗メッセージを避ける）
    await complete({ outputs: {} });

    // ✅ 以降はバックグラウンドでやる（待たない）
    setImmediate(async () => {
      const reqId = crypto.randomUUID();
      try {
        if (!actorUserId) {
          logger.error("[BG] missing actorUserId", { reqId });
          return;
        }

        // 打刻する？（"する" 以外なら何もしない）
        if (!shouldStamp(inputs)) {
          logger.info("[BG] stamp skipped by flag", { reqId });
          return;
        }

        const email = await getSlackEmail(client, actorUserId);
        if (!email) {
          logger.error("[BG] email not found", { reqId, actorUserId });
          return;
        }

        const stampType = decideStampType({ workflowId, inputs });

        const gasUrl = process.env.GAS_WEBAPP_URL || "";
        if (!gasUrl) {
          logger.error("[BG] missing GAS_WEBAPP_URL", { reqId });
          return;
        }

        const secret = process.env.GAS_SHARED_SECRET || "";

        const payload = {
          workflow_type: stampType === "OUT" ? "clock_out" : "clock_in",
          user: actorUserId,
          email,
          stamp_type: stampType, // "IN"/"OUT"
          secret,
          meta: {
            workflow_id: workflowId,
            request_id: reqId,
          },
        };

        const res = await fetchWithTimeout(
          gasUrl,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          8000
        );

        const text = await res.text();
        logger.info("[BG] GAS_RESULT", {
          reqId,
          status: res.status,
          body_preview: String(text).slice(0, 300),
        });
      } catch (e) {
        logger.error("[BG] ERROR", { reqId, error: String(e) });
      }
    });
  } catch (e) {
    logger.error("[FUNCTION_ERROR]", e);
    // ここでfailするとWF上で失敗になる（必要なら）
    await fail({ error: `Failed to start function: ${String(e)}` });
  }
});

// 起動
(async () => {
  await app.start(port);
  console.log(`⚡ Bolt running on port ${port}`);
})();