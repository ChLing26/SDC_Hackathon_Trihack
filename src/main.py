"""Private Python backend launcher: python -m src.main --help."""

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", choices=("advice", "emergency"), default="advice")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")

    from src.backend_security import configured_service_token
    if configured_service_token() is None:
        parser.error("Configure PYTHON_BACKEND_TOKEN (at least 32 characters) before starting.")

    import uvicorn
    module = "api:app" if args.service == "advice" else "src.emergency_orders:app"
    # Deliberately private: no public artifact route or browser CORS permission.
    uvicorn.run(module, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
