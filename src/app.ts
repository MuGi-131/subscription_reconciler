import express from "express";
import webhookRoutes from "./routes/webhooks";
import entitlementRoutes from "./routes/entitlement";
import carrierRoutes from "./routes/carrier";
import mockCarrierRoutes from "./mock/carrier";

const app = express();
app.use(express.json());

app.use("/webhooks", webhookRoutes);
app.use("/users", entitlementRoutes);
app.use("/carrier", carrierRoutes);
app.use("/mock/carrier", mockCarrierRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

export default app;
