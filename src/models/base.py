from pydantic import BaseModel, ConfigDict


class RequestModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
