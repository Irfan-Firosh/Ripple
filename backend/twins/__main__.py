import sys

from .cli import main
from .logsetup import setup_worker_logging

if len(sys.argv) > 1 and sys.argv[1].endswith("worker"):
    setup_worker_logging()

sys.exit(main())
