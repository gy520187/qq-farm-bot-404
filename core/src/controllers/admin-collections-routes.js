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

  // 激活/升星藏品
  app.post("/api/collections/upgrade", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    const collectionId = Number(req.body?.collectionId);
    if (!collectionId) {
      return res.status(400).json({ ok: false, error: "缺少藏品ID" });
    }

    try {
      const data = await provider.upgradeCollection(accountId, collectionId);
      adminLogger.info("藏品激活/升星成功", {
        accountId,
        collectionId,
      });
      res.json({ ok: true, data });
    } catch (err) {
      adminLogger.error("藏品激活/升星失败", {
        accountId,
        collectionId,
        error: err.message,
      });
      sendProviderError(res, err);
    }
  });

  // 切换场景展示
  app.post("/api/collections/display", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    const collectionId = Number(req.body?.collectionId);
    if (!collectionId) {
      return res.status(400).json({ ok: false, error: "缺少藏品ID" });
    }

    try {
      const data = await provider.switchSceneDisplay(accountId, collectionId, Number(req.body?.pedestalId) || 0);
      adminLogger.info("切换藏品展示成功", {
        accountId,
        collectionId,
      });
      res.json({ ok: true, data });
    } catch (err) {
      adminLogger.error("切换藏品展示失败", {
        accountId,
        collectionId,
        error: err.message,
      });
      sendProviderError(res, err);
    }
  });

  // 领取评分奖励
  app.post("/api/collections/claim-reward", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      const data = await provider.claimCollectionReward(accountId);
      adminLogger.info("领取藏品评分奖励成功", {
        accountId,
      });
      res.json({ ok: true, data });
    } catch (err) {
      adminLogger.error("领取藏品评分奖励失败", {
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
