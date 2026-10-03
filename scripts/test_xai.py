"""Test your xAI (Grok) API key. Usage: python3 scripts/test_xai.py"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

api_key = os.getenv("XAI_API_KEY", "")
if not api_key:
    print("Missing XAI_API_KEY. Put it in .env (see .env.example).")
    sys.exit(1)

print(f"Found XAI_API_KEY starting with {api_key[:8]}... (len={len(api_key)})")

# 1) Raw REST check — lists models, proves auth works
try:
    import requests

    r = requests.get(
        "https://api.x.ai/v1/models",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=20,
    )
    print(f"GET /v1/models -> {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        models = [m.get("id") for m in data.get("data", [])]
        print(f"Auth OK. Models available ({len(models)}):")
        for m in models[:10]:
            print(f"  - {m}")
    else:
        print("Auth FAILED. Body:")
        print(r.text[:2000])
        sys.exit(1)
except Exception as e:
    print(f"REST check failed: {e}")
    sys.exit(1)

# 2) Simple Grok chat via xai-sdk (optional, needs `pip install -r scripts/requirements-x.txt`)
try:
    from xai_sdk import Client
    from xai_sdk.chat import user

    client = Client(api_key=api_key, timeout=30)
    chat = client.chat.create(model="grok-4-1-fast-reasoning")
    chat.append(user("Reply with exactly: grok is live"))
    resp = chat.sample()
    print(f"\nGrok reply: {resp.content.strip()[:500]}")
    print("\nAll good — xAI auth works. You can now use Grok Imagine/Voice APIs.")
except ImportError:
    print("\nxai-sdk not installed. Run: pip3 install -r scripts/requirements-x.txt")
except Exception as e:
    print(f"\nChat call failed (auth may still be OK): {e}")
