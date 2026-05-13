import pytest
from fastapi.testclient import TestClient
from .api import app
from .models import AgentResponse

client = TestClient(app)

def test_health():
    """Test the health check endpoint"""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "message": "SynthGen Python Backend is healthy running on FastAPI."}

def test_chat_invalid_payload():
    """Test the chat endpoint with bad schema"""
    response = client.post("/api/chat", json={})
    assert response.status_code == 422 # Unprocessable Identity (Pydantic validation error)

def test_generate_data_mock():
    """Test the generation endpoint successfully"""
    payload = {
        "num_rows": 5,
        "schema_config": {
            "schema_name": "TEST_SCHEMA",
            "columns": []
        }
    }
    response = client.post("/api/generate", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "success"

def test_generate_data_edge_case_num_rows():
    """Test the generate endpoint edge case: trying to generate negative rows"""
    payload = {
        "num_rows": -1, # Should fail Pydantic 'ge=1' constraint
        "schema_config": {
            "schema_name": "TEST_SCHEMA",
            "columns": []
        }
    }
    response = client.post("/api/generate", json=payload)
    assert response.status_code == 422

def test_generate_data_edge_case_missing_schema():
    """Test the generate endpoint missing the schema_config completely"""
    payload = {"num_rows": 100}
    response = client.post("/api/generate", json=payload)
    assert response.status_code == 422
