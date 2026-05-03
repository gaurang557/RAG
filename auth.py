import os
import bcrypt
from base64 import b64decode
from typing import Optional

from sqlalchemy.orm import Session

from models import User

def verify_password(plain_password: str, hashed_password: str) -> bool:
    # bcrypt has a 72 byte limit, truncate if necessary for consistency
    truncated_password = plain_password[:72].encode('utf-8')
    hashed_bytes = hashed_password.encode('utf-8')
    return bcrypt.checkpw(truncated_password, hashed_bytes)

def get_password_hash(password: str) -> str:
    # bcrypt has a 72 byte limit, truncate if necessary
    truncated_password = password[:72].encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(truncated_password, salt)
    return hashed.decode('utf-8')

def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
    user = db.query(User).filter(User.username == username).first()
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user

def decode_basic_auth(auth_header: str) -> tuple[str, str]:
    auth_header = auth_header.strip()
    if not auth_header.startswith("Basic "):
        raise ValueError("Invalid Basic Auth header")
    
    encoded = auth_header[6:].strip()
    try:
        decoded = b64decode(encoded).decode("utf-8")
    except Exception:
        raise ValueError("Invalid Basic Auth encoding")
    
    if ":" not in decoded:
        raise ValueError("Invalid Basic Auth format")
    
    username, password = decoded.split(":", 1)
    return username, password

def create_default_user(db: Session, username: str = "admin", password: str = "admin"):
    existing_user = db.query(User).filter(User.username == username).first()
    if not existing_user:
        user = User(username=username, hashed_password=get_password_hash(password))
        db.add(user)
        db.commit()
        return user
    return existing_user
