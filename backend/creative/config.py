"""Pinned demo settings and a secret loader which never prints credential values."""
from twins.config import DEFAULT_ENV_PATH, MissingSecret, load_secret

TEXT_MODEL = "grok-4.3"
IMAGE_MODEL = "grok-imagine-image-2.0"
IMAGE_QUALITY = "low"
IMAGE_RESOLUTION = "1k"
MAX_IMAGE_WORKERS = 4
MAX_CAMPAIGN_VARIANTS = 60
MIN_SEGMENT_SIZE = 5
MIN_THEME_SUPPORT = 0.08


def load_xai_key(env_path=DEFAULT_ENV_PATH, **kwargs):
    try:
        return load_secret("XAI_API_KEY", env_path, **kwargs)
    except MissingSecret:  # the team keeps the xAI key in X_API_KEY
        return load_secret("X_API_KEY", env_path, **kwargs)
