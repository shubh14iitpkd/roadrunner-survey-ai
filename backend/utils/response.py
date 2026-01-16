from bson import json_util
from flask import Response

def mongo_response(data, status=200):
    """
    Safely serialize MongoDB data (ObjectId, datetime, etc.) for Flask responses.
    """
    return Response(
        json_util.dumps(data),
        status=status,
        mimetype="application/json"
    )
