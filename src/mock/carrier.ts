import { Router, Request, Response } from "express";
import { CarrierStatus } from "../types";

const router = Router();

// Mock carrier endpoint — randomised per spec:
// 85% active, 10% inactive, 5% api_error
router.get("/plan", (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) {
    res.status(400).json({ error: "userId required" });
    return;
  }
  const roll = Math.random();
  let status: CarrierStatus;
  if (roll < 0.85) {
    status = "active";
  } else if (roll < 0.95) {
    status = "inactive";
  } else {
    status = "api_error";
  }
  if (status === "api_error") {
    res.status(503).json({ status: "api_error" });
    return;
  }
  res.json({ status });
});

export default router;
