# 🧭 Catalog Buddy

A CSV transformation tool to migrate Shopify exports into Zilo CMS templates.

## 🚀 Local Run
```bash
cd backend
python -m venv .venv
# Windows:
.\\.venv\\Scripts\\activate
# macOS / Linux:
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn app:app --reload
