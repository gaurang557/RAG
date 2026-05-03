#!/usr/bin/env python3
import os
from dotenv import load_dotenv
from auth import create_default_user
from models import get_db_session

load_dotenv()

def init_database():
    database_url = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/rag_db")
    print(f"Initializing database at: {database_url}")
    
    db = get_db_session(database_url)
    try:
        # Create default admin user
        admin_user = create_default_user(db, username="admin", password="admin")
        print(f"Created/verified admin user: {admin_user.username}")
        
        print("Database initialization completed successfully!")
    except Exception as e:
        print(f"Error initializing database: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    init_database()
