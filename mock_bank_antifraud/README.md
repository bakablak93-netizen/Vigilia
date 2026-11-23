# Mock Bank ML Antifraud (`mock_bank_antifraud`)

Независимый микросервис-имитатор банковского ML-антифрода (`FastAPI` + `scikit-learn`) на порту `8020` для сквозного Black-Box тестирования в **VIGILIA**.

## Запуск

Из корня репозитория (используя `.venv` проекта):

```powershell
backend\.venv\Scripts\uvicorn.exe mock_bank_antifraud.main:app --host 127.0.0.1 --port 8020
```

Или из папки `mock_bank_antifraud/`:

```powershell
..\backend\.venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8020
```

## Эндпоинты

- `GET /health` — статус сервиса, `model_type`, `features_count`, текущие пороги.
- `GET /config` — просмотр конфигурации модели и порогов (`block_threshold`, `review_threshold`).
- `POST /config` — обновление порогов без перезапуска (например, `{"block_threshold": 65, "review_threshold": 40}`).
- `POST /reset` — сброс порогов к базовым (`block_threshold=70.0`, `review_threshold=45.0`).
- `POST /analyze` — основной контракт VIGILIA (`ExternalHttpConnector`) для пакетной оценки транзакций.
- `POST /evaluate` — алиас для пакетной или одиночной оценки транзакции.
