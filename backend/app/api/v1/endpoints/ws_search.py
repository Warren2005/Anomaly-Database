"""
WebSocket endpoint for streaming search results.

Streams results progressively as they are found, allowing the frontend
to render results one-by-one for perceived performance improvement.
"""

import base64
import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.logging_config import logger
from app.services.embedding import embedding_service
from app.services.file_store import file_store_service

router = APIRouter()


@router.websocket("/ws/search")
async def websocket_search(websocket: WebSocket):
    """
    WebSocket search endpoint.

    Client sends a JSON message with base64 image data:
    {
        "image_base64": "<base64 encoded image>",
        "limit": 10,
        "diagnosis": null,
        "tissue_type": null,
        "benign_malignant": null
    }

    Server streams results back one at a time:
    {"type": "status", "message": "Generating embedding..."}
    {"type": "status", "message": "Searching..."}
    {"type": "result", "index": 0, "data": {...}}
    {"type": "result", "index": 1, "data": {...}}
    {"type": "complete", "total": 10, "total_time_ms": 1234.5}
    """
    await websocket.accept()

    try:
        while True:
            # Receive search request
            data = await websocket.receive_text()
            request = json.loads(data)

            image_base64 = request.get("image_base64", "")
            limit = request.get("limit", 10)
            diagnosis = request.get("diagnosis")
            tissue_type = request.get("tissue_type")
            benign_malignant = request.get("benign_malignant")

            total_start = time.time()

            # Step 1: Generate embedding
            await websocket.send_json({"type": "status", "message": "Generating embedding..."})
            image_bytes = base64.b64decode(image_base64)
            embed_start = time.time()
            embedding = await embedding_service.get_embedding(image_bytes)
            embed_time = (time.time() - embed_start) * 1000

            # Step 2: Search the file store
            await websocket.send_json({
                "type": "status",
                "message": "Searching database...",
                "embedding_time_ms": round(embed_time, 1),
            })

            matches = await file_store_service.search(
                vector=embedding,
                limit=limit,
                diagnosis=diagnosis,
                tissue_type=tissue_type,
                benign_malignant=benign_malignant,
                embedding_model=embedding_service.model_tag,
            )

            # Step 3: Stream results one by one
            for idx, (image, score) in enumerate(matches):
                await websocket.send_json({
                    "type": "result",
                    "index": idx,
                    "data": {
                        "image": {
                            "id": str(image.id),
                            "dataset_source": image.dataset_source,
                            "image_path": image.image_path,
                            "diagnosis": image.diagnosis,
                            "tissue_type": image.tissue_type,
                            "benign_malignant": image.benign_malignant,
                            "age": image.age,
                            "sex": image.sex,
                        },
                        "similarity_score": score,
                        "image_url": f"/api/v1/images/{image.id}/file",
                    },
                })

            # Step 4: Send completion
            total_time = (time.time() - total_start) * 1000
            await websocket.send_json({
                "type": "complete",
                "total": len(matches),
                "total_time_ms": round(total_time, 1),
                "embedding_time_ms": round(embed_time, 1),
            })

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
