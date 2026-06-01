import express from "express";
import entitlementRoutes from "./routes/entitlement";

const app = express();
app.use(express.json());

app.use("/users", entitlementRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

export default app;
