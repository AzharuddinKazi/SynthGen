from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict

class Message(BaseModel):
    role: str = Field(description="'user' or 'agent'")
    content: str = Field(description="The text content of the message")

class ColumnOverride(BaseModel):
    column_name: str = Field(description="The name of the column to override logic for")
    override_instruction: str = Field(description="User instruction for the column distribution/formatting")

class ChatRequest(BaseModel):
    messages: List[Message]
    overrides: Optional[List[ColumnOverride]] = None

class ClarifyingQuestion(BaseModel):
    question: str
    options: List[str]

class ColumnConfig(BaseModel):
    name: str = Field(..., description="Name of the column")
    data_type: str = Field(..., description="Data type, e.g., 'UUID', 'Integer', 'Float64', 'Category', 'DateTime'")
    distribution: str = Field(..., description="Distribution type, e.g., 'Unique Index', 'Gaussian', 'Power Law', 'Chronological'")
    constraints: str = Field(..., description="Text description of constraints")
    null_percentage: float = Field(0.0, description="Percentage of null values")

class SchemaConfig(BaseModel):
    schema_name: str = Field(..., description="Name of the generated schema, ending with .JSON")
    columns: List[ColumnConfig] = Field(default_factory=list)

class AgentResponse(BaseModel):
    agent_reply: str = Field(description="The conversational text reply sent back to the user.")
    schema_data: Optional[SchemaConfig] = Field(None, description="The detected or updated database schema configuration.")
    question_popup: Optional[ClarifyingQuestion] = Field(None, description="Provide this if a clarifying question is needed.")

class GenerateRequest(BaseModel):
    schema_config: SchemaConfig
    num_rows: int = Field(100, ge=1, le=1000000, description="Number of synthetic rows to generate")
