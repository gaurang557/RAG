#!/usr/bin/env python3
from dotenv import load_dotenv
from rag_api.auth import create_default_user
from rag_api.models import get_db_session, init_schema

load_dotenv()


def init_database():
    print("Initializing database...")
    # db = get_db_session()
    try:
        init_schema()
        # Create default admin user
        # admin_user = create_default_user(db, username="admin", password="admin")
        # print(f"Created/verified admin user: {admin_user.username}")
        print("Database initialization completed successfully!")
    except Exception as e:
        print(f"Error initializing database: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    init_database()
