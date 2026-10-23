import express, { type Express, type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sameOrigin } from "./lib/auth";

const app: Express = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  next();
});
app.use("/api", sameOrigin);
app.use(express.json());
app.use(cookieParser());

app.use("/api", router);
const safeError: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) { _next(error); return; }
  if (error?.type === "entity.parse.failed" || error?.type === "entity.too.large") {
    res.status(400).json({ error: "The request is invalid. Please check your input." });
    return;
  }
  // Do not log database error details, request bodies, cookies, or credentials.
  req.log.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Request temporarily unavailable");
  res.status(503).json({ error: "The service is temporarily unavailable. Please try again." });
};
app.use(safeError);

export default app;
