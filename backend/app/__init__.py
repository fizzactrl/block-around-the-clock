import logging

from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from .config import Config
from .db import init_db
from .errors import ApiError


def create_app(seed: bool | None = None, force_memory: bool = False) -> Flask:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    app = Flask(__name__)
    app.json.sort_keys = False
    CORS(app, resources={r"/api/*": {"origins": Config.CORS_ORIGINS}})
    init_db(force_memory=force_memory)

    from .api import bp
    app.register_blueprint(bp)

    @app.errorhandler(ApiError)
    def _api_error(err: ApiError):
        return jsonify({"ok": False, "error": {"code": err.code, "message": err.message, "details": err.details}}), err.status

    @app.errorhandler(HTTPException)
    def _http_error(err: HTTPException):
        return jsonify({"ok": False, "error": {"code": err.name.lower().replace(" ", "_"), "message": err.description}}), err.code

    @app.errorhandler(Exception)
    def _unhandled(err: Exception):  # pragma: no cover
        app.logger.exception("unhandled error")
        return jsonify({"ok": False, "error": {"code": "internal_error", "message": "Unexpected server error"}}), 500

    if Config.SEED_ON_START if seed is None else seed:
        from .seed import seed as run_seed
        run_seed()
    return app
