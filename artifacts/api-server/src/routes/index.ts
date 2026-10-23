import { Router, type IRouter } from "express";
import healthRouter from "./health";
import procurementRouter from "./procurement";
import authRouter from "./auth";
import { requireAccount } from "../lib/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use("/procurement", requireAccount);
router.use(procurementRouter);

export default router;
