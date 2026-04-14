from bson import json_util, ObjectId
from datetime import datetime
from flask import Response
import orjson


def mongo_response(data, status=200):
    """
    Safely serialize MongoDB data (ObjectId, datetime, etc.) for Flask responses.
    """
    return Response(
        json_util.dumps(data),
        status=status,
        mimetype="application/json"
    )


def _convert_mongo_types(obj):
    """Recursively convert ObjectId/datetime to JSON-safe types."""
    if isinstance(obj, dict):
        return {k: _convert_mongo_types(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_mongo_types(v) for v in obj]
    if isinstance(obj, ObjectId):
        return str(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj


def fast_mongo_response(data, status=200):
    """
    High-performance serializer using orjson.  Use for large result sets
    where bson.json_util.dumps() is too slow.  Requires that ObjectId and
    datetime values are either already converted to strings (e.g. via
    $toString in the aggregation pipeline) or will be converted here.
    """
    return Response(
        orjson.dumps(_convert_mongo_types(data)),
        status=status,
        mimetype="application/json"
    )
