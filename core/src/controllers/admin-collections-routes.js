const { getMutationCatalog } = require("../services/collections");

function getAuthorizedAccountId(req, res, { getAccountIdFromRequest, canAccessAccount }) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    res.status(400).json({
      ok: false,
      error: "Missing x-account-id",
    });
    return null;
  }

  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({
      ok: false,
      error: "无权访问此账号",
    });
    return null;
  }

  return accountId;
}

function registerAdminCollectionsRoutes({
  app,
  provider,
  adminLogger,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  const routeContext = {
    provider,
    adminLogger,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  };

  // 藏品宝典快照（蓝晶藏品，只读）
  app.get("/api/collections", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      const snapshot = await provider.getCollectionsSnapshot(accountId);
      res.json({ ok: true, data: snapshot });
    } catch (err) {
      adminLogger.error("获取藏品宝典失败", {
        accountId,
        error: err.message,
      });
      sendProviderError(res, err);
    }
  });

  // 变异宝典（本地配置，无需账号）
  app.get("/api/illustrated/mutations", async (req, res) => {
    try {
      res.json({ ok: true, data: getMutationCatalog() });
    } catch (err) {
      adminLogger.error("获取变异宝典失败", { error: err.message });
      sendProviderError(res, err);
    }
  });
}

module.exports = { registerAdminCollectionsRoutes };
