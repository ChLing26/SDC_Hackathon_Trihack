import type { RequestHandler } from "express";
import {
  GetProcurementAdviceBody, GetProcurementAdviceParams, GetProcurementRequestResponse,
  type ProcurementRequestDetail,
} from "@workspace/api-zod";
import { AdviceError, getPythonAdvice } from "../lib/python-advice";

// The loader is read-only and injectable so tests never need a project DB.
export function createAdviceHandler(
  load: (id: number) => Promise<unknown | undefined>,
  advise: typeof getPythonAdvice = getPythonAdvice,
): RequestHandler {
  return async (req, res): Promise<void> => {
    const params = GetProcurementAdviceParams.safeParse(req.params);
    const input = GetProcurementAdviceBody.strict().safeParse(req.body);
    if (!params.success || !Number.isSafeInteger(params.data.requestId) || !input.success) {
      res.status(400).json({ error: "Provide a valid request ID and optional advice priority only." }); return;
    }
    try {
      const raw = await load(params.data.requestId);
      if (raw === undefined) { res.status(404).json({ error: "Request not found." }); return; }
      let record: ProcurementRequestDetail;
      try {
        record = GetProcurementRequestResponse.parse(raw);
        if (record.id !== params.data.requestId) throw new Error("Mismatched request");
      } catch {
        res.status(422).json({ error: "Stored request data cannot be used for advice." }); return;
      }
      res.set("Cache-Control", "no-store");
      res.json(await advise(record, input.data));
    } catch (error) {
      if (error instanceof AdviceError) { res.status(error.status).json({ error: error.message }); return; }
      res.status(503).json({ error: "Supplier advice is temporarily unavailable." });
    }
  };
}
