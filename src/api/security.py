"""Private service authentication, not a replacement for application sessions.

The Express account/manager authorization must be checked by a future adapter.
Never put this service credential in the browser or accept it in a query string.
"""

import os
from secrets import compare_digest

from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
bearer = HTTPBearer(auto_error=False)


def configured_service_token():
    token = os.environ.get("PYTHON_BACKEND_TOKEN", "").strip()
    if len(token) < 32:
        return None
    return token


def require_service_auth(
    credentials: HTTPAuthorizationCredentials | None = Security(bearer),
):
    expected = configured_service_token()
    if expected is None:
        raise HTTPException(503, "Private backend authentication is not configured.")
    if (
        credentials is None
        or credentials.scheme.lower() != "bearer"
        or not compare_digest(
            credentials.credentials.encode("utf-8"), expected.encode("utf-8"),
        )
    ):
        raise HTTPException(
            401, "Invalid service authentication.",
            headers={"WWW-Authenticate": "Bearer"},
        )
