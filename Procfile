rails: cd backend && bin/rails server -p 13323
sidecar: cd sidecar && uv run uvicorn app.main:app --host 0.0.0.0 --port 13324
frontend: cd frontend && npm run dev -- --port 13325
