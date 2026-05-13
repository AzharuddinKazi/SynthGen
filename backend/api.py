import os
from fastapi import FastAPI, HTTPException
from typing import Optional
from .models import ChatRequest, AgentResponse, GenerateRequest, SchemaConfig
from google import genai
from google.genai import types

app = FastAPI(title="SynthGen Python API")

# Initialize Gemini Client (Requires GEMINI_API_KEY environment variable)
try:
    client = genai.Client()
except Exception:
    client = None

@app.get("/api/health")
def health_check():
    """
    Health check endpoint to test if API is up and active.
    """
    return {"status": "ok", "message": "SynthGen Python Backend is healthy running on FastAPI."}

@app.post("/api/chat", response_model=AgentResponse)
def process_chat(request: ChatRequest):
    """
    Takes user chat history and outputs the corresponding JSON schema for data generation.
    """
    if not client:
        raise HTTPException(status_code=500, detail="Gemini client not configured. Set GEMINI_API_KEY.")
    
    sys_instruct = (
        "You are SynthGen Agent, a helpful domain-aware data modeling assistant. Your goal is to guide the user in generating synthetic data. "
        "Understand their requirements, propose columns suitable for the domain, and output structured JSON. "
        "Identify data types and likely distributions (e.g. Gaussian for amounts, Power Law for categories). "
        "If you need clarification on outliers, distributions, or edge cases, provide a 'question_popup' with options. "
        "Reply warmly and concisely in 'agent_reply'."
    )

    user_prompt = "Conversation History:\n"
    for msg in request.messages:
        user_prompt += f"{msg.role.upper()}: {msg.content}\n"
        
    if request.overrides:
        user_prompt += "\nUser Overrides for specific columns:\n"
        for ov in request.overrides:
            user_prompt += f"- {ov.column_name}: {ov.override_instruction}\n"

    try:
        response = client.models.generate_content(
            model='gemini-2.5-pro',
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=sys_instruct,
                response_mime_type="application/json",
                response_schema=AgentResponse,
                temperature=0.1,
            ),
        )
        data = response.text
        return AgentResponse.model_validate_json(data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate")
def generate_data(request: GenerateRequest):
    """
    The main data generator engine endpoint.
    This accepts the parsed SchemaConfig and desired number of rows to synthesize the data.
    """
    # Here, you would plug in your statistically accurate data generator python engine
    # utilizing pandas/numpy/scipy based on the `request.schema_config` parameters.
    return {
        "status": "success",
        "message": f"Successfully initialized python data generation for {request.num_rows} rows adhering to {request.schema_config.schema_name} distribution constraints."
    }
