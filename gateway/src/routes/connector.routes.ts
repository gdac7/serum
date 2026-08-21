import { Router } from "express";
import {
  CONNECTOR_ASSETS,
  ConnectorAsset,
  connectorAssetPath,
} from "../infra/connector-assets";

export const connectorAssetsRouter = Router();

// Unauthenticated on purpose. The script carries no secret -- the connector
// token is passed to it as an argument -- and a browser download cannot send an
// Authorization header, so gating it would only mean the link could not work.
connectorAssetsRouter.get("/connector/:file", (req, res) => {
  const name = req.params.file as ConnectorAsset;
  if (!CONNECTOR_ASSETS.includes(name)) {
    return res.status(404).json({ error: "unknown connector file" });
  }

  const file = connectorAssetPath(name);
  if (!file) {
    return res.status(404).json({ error: "connector files are not bundled with this deployment" });
  }

  res.type(name.endsWith(".py") ? "text/x-python" : "text/markdown");
  res.download(file, name);
});
