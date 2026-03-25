import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import botRouter from "./bot.js";
import gmailRouter from "./gmail.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(gmailRouter);

export default router;
