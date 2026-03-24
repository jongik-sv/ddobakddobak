rails: cd backend && bin/rails server -p 3000
sidecar: cd sidecar && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
frontend: cd frontend && npm run dev -- --port 5173
