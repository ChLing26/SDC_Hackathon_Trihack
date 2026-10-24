import os
from pathlib import Path
from dotenv import load_dotenv
from google import genai

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env", override=False)

api_key = os.getenv("GEMINI_API_KEY", "").strip()

if not api_key:
    raise RuntimeError("GEMINI_API_KEY is missing.")

client = genai.Client(api_key=api_key)

print("Models supporting generateContent:")

for model in client.models.list():
    actions = model.supported_actions or []

    if "generateContent" in actions:
        print(model.name)
