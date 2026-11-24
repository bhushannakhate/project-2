FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    PORT=8080

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .
COPY pinboard_agents ./pinboard_agents

EXPOSE 8080

USER 10001

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
