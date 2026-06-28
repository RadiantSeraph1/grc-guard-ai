import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

# Default to SQLite for local development; override with DATABASE_URL (e.g. a
# Postgres URL) for production, where real concurrency is required.
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./grc_enterprise.db")
IS_SQLITE = DATABASE_URL.startswith("sqlite")

# C4 — concurrency hardening.
#
# SQLite's default rollback journal serializes access and raises "database is
# locked" the moment a writer collides with anyone else. The background scheduler
# writing drift/snapshots while request handlers also write was exactly that
# collision. Two changes fix the common cases without leaving SQLite:
#   * WAL journal mode  -> readers no longer block the writer (and vice versa).
#   * busy_timeout      -> a blocked writer waits (up to 30s) instead of erroring.
# For genuine multi-writer concurrency ("enterprise" scale) set DATABASE_URL to a
# Postgres instance; the pool settings below then apply.
if IS_SQLITE:
    connect_args = {"check_same_thread": False, "timeout": 30}
    engine_kwargs = {}
else:
    connect_args = {}
    engine_kwargs = {
        "pool_pre_ping": True,   # drop dead connections instead of erroring
        "pool_size": 10,
        "max_overflow": 20,
        "pool_recycle": 1800,
    }

engine = create_engine(DATABASE_URL, connect_args=connect_args, **engine_kwargs)


if IS_SQLITE:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, _connection_record):
        """Apply concurrency-friendly pragmas to every new SQLite connection."""
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute("PRAGMA busy_timeout=30000;")
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dependency to get db session in FastAPI routes
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
