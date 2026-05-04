# Backend test suite

Pytest-based test suite for the Flask backend. Uses **mongomock** so no MongoDB
is required, and stubs the job queue + SMTP mailer so background workers and
network calls never run.

## Setup

```bash
cd backend
source venv/bin/activate
pip install -r tests/requirements-dev.txt
```

## Run

From `backend/`:

```bash
pytest                          # full suite
pytest tests/test_auth.py       # one file
pytest tests/test_auth.py::test_login_returns_tokens   # one test
pytest -k "login"               # by keyword
pytest -x                       # stop at first failure
pytest -vv                      # verbose
```

## Coverage

```bash
pip install pytest-cov                       # already in requirements-dev
pytest --cov=. --cov-report=term-missing
pytest --cov=. --cov-report=html             # open htmlcov/index.html
```

## What is covered

| File                  | Scope                                                            |
|-----------------------|------------------------------------------------------------------|
| `test_health.py`      | `/api/health`, `/api/protected`, CORS preflight                  |
| `test_auth.py`        | signup / login / refresh / `/me`, case-insensitive email, RBAC   |
| `test_roads.py`       | roads CRUD + filters + RBAC matrix                               |
| `test_surveys.py`     | survey create + versioning + history + RBAC                      |
| `test_categories.py`  | categories list/create + RBAC                                    |
| `test_users.py`       | admin user list, password update, ownership checks               |
| `test_rbac.py`        | role decorator, OPTIONS bypass, missing-token behavior           |
| `test_utils.py`       | `utils.security`, `utils.roles`, `utils.ids`, `utils.response`   |

## Architecture of the harness

`tests/conftest.py` does the heavy lifting:

1. **`MongoClient` is patched to `mongomock.MongoClient`** at session scope, so
   every code path that calls `db.get_client()` gets an in-memory database.
2. **Each test gets a fresh DB** — the `app` fixture drops the database after
   the test, and `db_module.client` is reset so the next test rebuilds it.
3. **Job queue is mocked** — `services.job_queue.job_queue` is replaced with a
   `MagicMock`, so `init_app()` does not start worker threads or poll Mongo.
4. **Mailer is mocked** — `services.email_templates.get_mailer` returns a mock
   so signup / approval flows never touch SMTP.
5. **JWT tokens are minted directly** via `_make_token(app, user_id, role)` —
   tests do not need to round-trip through `/login` to authenticate.

### Fixtures cheat-sheet

| Fixture            | What it gives you                                          |
|--------------------|------------------------------------------------------------|
| `app`              | Flask app, fresh in-memory DB                              |
| `client`           | `app.test_client()`                                        |
| `db`               | Mongomock database handle (inside app context)             |
| `make_user(role=)` | Insert a user, return its `_id` string                     |
| `auth_headers(role)` | Create user + mint JWT, return `{Authorization: Bearer …}` |
| `admin_headers`    | Shortcut for `auth_headers("admin")`                       |
| `surveyor_headers` | Shortcut for `auth_headers("road_surveyor")`               |
| `viewer_headers`   | Shortcut for `auth_headers("viewer")`                      |

## Caveats / things to know

- **mongomock does not implement every Mongo feature.** Geo `$near`, full-text
  `$text`, and aggregation `$set` pipelines may behave as no-ops or errors.
  Tests therefore avoid the `?search=` text-index path on `/api/roads`. If a
  test using a complex aggregation fails on mongomock but works against real
  Mongo, mark it `@pytest.mark.integration` and skip it from the default run.
- **Sequential ID counters** are per-test — `next_sequence("route_id")` always
  starts at 1 because the DB is reset.
- **bcrypt is real** — password hashing in tests is slow-ish (~50ms each). If
  you need to spin up many users in one test, prefer inserting docs directly
  via the `db` fixture rather than going through `/api/auth/signup`.
- **No real SMTP** — assertions on emails should target the mocked mailer:
  `from services.email_templates import get_mailer; get_mailer().send_email.assert_called_once()`.
- **Heavy ML modules** (`ai.lang_graph_chatbot`, YOLO inference, SageMaker)
  are not exercised. Add an integration test with `@pytest.mark.integration`
  and an env-gated skip if you need to cover them.
- **JWT secret** is fixed to `test-jwt-secret` — if you mint a token outside
  the helper, use the same secret or it will not verify.

## Adding a new test file

```python
def test_something(client, admin_headers):
    res = client.get("/api/your-endpoint", headers=admin_headers)
    assert res.status_code == 200
```

That's the whole pattern. The fixtures handle DB, app, and auth.

## CI integration

Suggested GitHub Actions step:

```yaml
- name: Backend tests
  run: |
    cd backend
    pip install -r requirements.txt
    pip install -r tests/requirements-dev.txt
    pytest --cov=. --cov-report=xml
```
