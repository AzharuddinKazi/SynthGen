import { useState, useRef, useEffect } from 'react';
import { Send, CheckCircle2, ChevronRight, Download, Play, HelpCircle, Loader2, X } from 'lucide-react';
import { GoogleGenAI, Type, Schema } from '@google/genai';

interface Message {
  role: 'user' | 'agent';
  content: string;
}

interface ColumnConfig {
  name: string;
  data_type: string;
  distribution: string;
  constraints: string;
  null_percentage: number;
}

interface SchemaConfig {
  schema_name: string;
  columns: ColumnConfig[];
}

interface PopupQuestion {
  question: string;
  options: string[];
}

export default function App() {
  const [isApiHealthy, setIsApiHealthy] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'agent', content: "I'll help you generate domain-aware synthetic data. What's the target domain or specific schema requirement?" }
  ]);
  const [schemaConfig, setSchemaConfig] = useState<SchemaConfig | null>(null);
  const [popup, setPopup] = useState<PopupQuestion | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [globalOverride, setGlobalOverride] = useState('');
  const [customPopupAnswer, setCustomPopupAnswer] = useState('');
  const [generateResult, setGenerateResult] = useState<{message: string, sample: any[]} | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(data => setIsApiHealthy(data.status === 'ok'))
      .catch(() => setIsApiHealthy(false));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;
    
    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInputText('');
    setIsLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const systemInstruction = 
        "You are SynthGen Agent, a helpful domain-aware data modeling assistant. Your goal is to guide the user in generating synthetic data. " +
        "Understand their requirements, propose columns suitable for the domain, and output structured JSON. " +
        "Identify data types and likely distributions (e.g. Gaussian for amounts, Power Law for categories). " +
        "If you need clarification on outliers, distributions, or edge cases, provide a 'question_popup' with options. " +
        "Reply warmly and concisely in 'agent_reply'.";

      let promptStr = "Conversation:\n";
      for (const msg of newMessages) {
        promptStr += `${msg.role.toUpperCase()}: ${msg.content}\n`;
      }

      if (globalOverride) {
        promptStr += `\nUser Overrides for specific columns:\n- GLOBAL: ${globalOverride}\n`;
      }

      const schemaConfigSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          agent_reply: { type: Type.STRING, description: "The conversational text reply sent back to the user." },
          schema_data: {
            type: Type.OBJECT,
            description: "The detected or updated database schema configuration.",
            properties: {
              schema_name: { type: Type.STRING, description: "Name of the generated schema, e.g., HEALTHCARE_CLAIMS_v1 JSON" },
              columns: {
                type: Type.ARRAY,
                description: "List of columns in the schema.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    data_type: { type: Type.STRING, description: "e.g., UUID, Integer, Float64, Category, DateTime" },
                    distribution: { type: Type.STRING, description: "e.g., Unique Index, Gaussian, Power Law, Chronological" },
                    constraints: { type: Type.STRING, description: "e.g., min: 0, length=36" },
                    null_percentage: { type: Type.NUMBER, description: "Percentage from 0-100" }
                  },
                  required: ["name", "data_type", "distribution", "constraints", "null_percentage"]
                }
              }
            },
            required: ["schema_name", "columns"],
          },
          question_popup: {
            type: Type.OBJECT,
            description: "A clarifying question with options if the requirement is ambiguous.",
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["question", "options"],
          }
        },
        required: ["agent_reply"]
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: promptStr,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: schemaConfigSchema,
          temperature: 0.1,
        }
      });

      const jsonText = response.text;
      if (!jsonText) throw new Error("Empty response from AI");
      
      const data = JSON.parse(jsonText);
      
      if (data.agent_reply) {
        setMessages(prev => [...prev, { role: 'agent', content: data.agent_reply }]);
      }
      if (data.schema_data) {
        setSchemaConfig(data.schema_data);
      }
      if (data.question_popup) {
        setPopup(data.question_popup);
      }
    } catch (error: any) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'agent', content: "Error: Failed to reach the generation engine. Could be an API Key issue: " + error?.message }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!schemaConfig) return;
    setIsLoading(true);
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema_config: schemaConfig,
          num_rows: 100 // Just a default for testing
        })
      });
      const data = await response.json();
      setGenerateResult({ message: data.message, sample: data.sample || [] });
    } catch (e) {
      console.error("Failed to trigger generation.", e);
    } finally {
      setIsLoading(false);
    }
  };

  const answerPopup = (answer: string) => {
    setPopup(null);
    handleSendMessage(`Regarding your question: I prefer -> ${answer}`);
  };

  const exportPydantic = () => {
    if (!schemaConfig) return;
    let code = `from pydantic import BaseModel, Field\nfrom typing import Optional\n\nclass ${schemaConfig.schema_name}(BaseModel):\n`;
    schemaConfig.columns.forEach(col => {
      let pyType = "str";
      let dType = col.data_type.toLowerCase();
      if (dType.includes("int")) pyType = "int";
      if (dType.includes("float")) pyType = "float";
      if (dType.includes("uuid")) pyType = "str";
      if (dType.includes("datetime")) pyType = "str";
      
      const fieldType = col.null_percentage > 0 ? `Optional[${pyType}]` : pyType;
      code += `    ${col.name}: ${fieldType} = Field(description="${col.constraints}")\n`;
    });
    
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${schemaConfig.schema_name.toLowerCase()}.py`;
    a.click();
  };

  return (
    <div className="flex h-screen w-full bg-[#0f172a] text-slate-200 font-sans overflow-hidden">
      {/* Left Sidebar: Chat Interface */}
      <aside className="w-80 flex flex-col border-r border-slate-700/50 bg-[#1e293b]/50">
        <div className="p-4 border-b border-slate-700/50 flex items-center gap-3 bg-[#1e293b]">
          <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center text-white font-bold">
            S
          </div>
          <div>
            <h1 className="text-sm font-semibold">SynthGen Agent</h1>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isApiHealthy ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                API: {isApiHealthy ? 'Healthy' : 'Error'}
              </span>
            </div>
          </div>
        </div>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto flex flex-col p-4 gap-4 scrollbar-thin scrollbar-thumb-slate-700">
          {messages.map((msg, i) => (
            <div 
              key={i} 
              className={`p-3 rounded-2xl text-sm leading-relaxed max-w-[90%] ${
                msg.role === 'agent' 
                  ? 'bg-slate-700/30 rounded-bl-none self-start border border-slate-600/50' 
                  : 'bg-indigo-600/20 text-indigo-200 rounded-br-none self-end border border-indigo-500/30'
              }`}
            >
              {msg.role === 'agent' ? (
                <div dangerouslySetInnerHTML={{ __html: msg.content.replace(/\\n/g, '<br/>') }} />
              ) : (
                msg.content
              )}
            </div>
          ))}
          {isLoading && (
            <div className="bg-slate-700/30 p-3 rounded-2xl rounded-bl-none self-start flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-indigo-400" />
              <span className="text-xs text-slate-400">Thinking...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input */}
        <div className="p-4 bg-slate-800/50 border-t border-slate-700">
          <form 
            className="relative" 
            onSubmit={(e) => { e.preventDefault(); handleSendMessage(inputText); }}
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Message agent..."
              disabled={isLoading}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl py-2.5 px-4 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 placeholder:text-slate-500 shadow-inner disabled:opacity-50"
            />
            <button 
              type="submit" 
              disabled={isLoading || !inputText.trim()}
              className="absolute right-2 top-2 p-1.5 text-slate-400 hover:text-indigo-400 transition-colors disabled:opacity-50 disabled:hover:text-slate-400"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content: Configuration & Table */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b border-slate-700/50 flex items-center justify-between px-6 bg-[#0f172a]">
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-[0.2em]">
              Configuration /
            </span>
            <h2 className="text-sm font-semibold max-w-sm truncate">
              {schemaConfig ? `${schemaConfig.schema_name}.JSON` : "NO_SCHEMA_LOADED"}
            </h2>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={exportPydantic}
              disabled={!schemaConfig}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:hover:bg-slate-800 rounded-lg text-xs font-medium transition-colors border border-slate-600"
            >
              <Download size={14} />
              Export Pydantic
            </button>
            <button 
              onClick={handleGenerate}
              disabled={!schemaConfig}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:hover:bg-indigo-500 rounded-lg text-xs font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all"
            >
              <Play size={14} />
              Generate Dataset
            </button>
          </div>
        </header>

        {/* Configuration Body */}
        {schemaConfig ? (
          <div className="flex-1 p-6 overflow-hidden flex flex-col">
            <div className="bg-slate-800/40 rounded-2xl border border-slate-700/50 overflow-hidden flex flex-col h-full shadow-2xl">
              <div className="p-4 bg-slate-800/60 border-b border-slate-700 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  Column Schema Definitions
                </h3>
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/40 font-medium">
                  {schemaConfig.columns.length} Columns Detected
                </span>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="sticky top-0 bg-slate-800/95 backdrop-blur-md z-10 shadow-sm">
                    <tr className="text-xs font-medium text-slate-500 border-b border-slate-700/50">
                      <th className="px-6 py-4 font-semibold uppercase">Column Name</th>
                      <th className="px-6 py-4 font-semibold uppercase">Data Type</th>
                      <th className="px-6 py-4 font-semibold uppercase">Distribution</th>
                      <th className="px-6 py-4 font-semibold uppercase">Constraints</th>
                      <th className="px-6 py-4 font-semibold uppercase">Null %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30">
                    {schemaConfig.columns.map((col, idx) => (
                      <tr key={idx} className="hover:bg-slate-700/20 transition-colors">
                        <td className="px-6 py-4 font-mono text-indigo-400 font-semibold">{col.name}</td>
                        <td className="px-6 py-4">
                          <span className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs">
                            {col.data_type}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 rounded-full bg-slate-700 text-[10px] uppercase font-bold tracking-wider">
                            {col.distribution}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-400 text-xs truncate max-w-[200px]" title={col.constraints}>
                          {col.constraints}
                        </td>
                        <td className="px-6 py-4 font-mono">{col.null_percentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Column Specific Comments */}
              <div className="p-4 bg-slate-900/50 border-t border-slate-700 shrink-0">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 block">
                  Global Logic Overrides
                </label>
                <textarea
                  value={globalOverride}
                  onChange={(e) => setGlobalOverride(e.target.value)}
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-lg p-3 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 h-24 resize-none transition-colors"
                  placeholder="E.g. Ensure diagnosis codes match the age demographic distribution... Then press Send in chat."
                ></textarea>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500 p-8 text-center">
            <div className="max-w-md">
              <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-4 border border-slate-700">
                <Send size={24} className="text-slate-600" />
              </div>
              <p>Type a requirement in the chat to generate a schema definition.</p>
              <p className="text-xs text-slate-600 mt-2">Example: "I need a healthcare claims dataset with 10k rows. Include patient IDs, claim amounts, and diagnosis codes."</p>
            </div>
          </div>
        )}

        {/* Question Popup Overlay */}
        {popup && (
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <div className="bg-slate-800 w-full max-w-[500px] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col transform transition-all">
              <div className="p-6">
                <div className="flex items-center gap-4 mb-5">
                  <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                    <HelpCircle size={24} />
                  </div>
                  <div>
                    <h4 className="text-base font-semibold">Clarifying Requirement</h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Help the agent refine the generation engine.
                    </p>
                  </div>
                </div>

                <p className="text-sm text-slate-200 mb-6 leading-relaxed">
                  {popup.question}
                </p>

                <div className="space-y-3 mb-6">
                  {popup.options.map((opt, i) => (
                    <button 
                      key={i}
                      onClick={() => answerPopup(opt)}
                      className="w-full p-3.5 rounded-xl bg-slate-700/50 border border-slate-600 text-left text-sm hover:border-indigo-500 hover:bg-slate-700/80 transition-all flex justify-between items-center group"
                    >
                      <span>{opt}</span>
                      <ChevronRight size={16} className="opacity-0 group-hover:opacity-100 text-indigo-400 transition-opacity" />
                    </button>
                  ))}
                  <div className="relative mt-2">
                    <input
                      type="text"
                      value={customPopupAnswer}
                      onChange={e => setCustomPopupAnswer(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && customPopupAnswer.trim()) {
                          answerPopup(customPopupAnswer);
                        }
                      }}
                      placeholder="Write custom instruction & press Enter..."
                      className="w-full p-3.5 rounded-xl bg-slate-900 border border-slate-700 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-4">
                  <button 
                    onClick={() => setPopup(null)}
                    className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                  >
                    Skip
                  </button>
                </div>
              </div>
              <div className="h-1 bg-slate-700/50">
                <div className="h-full bg-indigo-500 w-1/3 rounded-r-full"></div>
              </div>
            </div>
          </div>
        )}

        {/* Generate Data Preview Modal */}
        {generateResult && (
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-6 z-50 overflow-y-auto">
            <div className="bg-slate-800 w-full max-w-4xl border border-slate-700 rounded-2xl shadow-2xl flex flex-col transform transition-all my-auto max-h-[85vh]">
              {/* header */}
              <div className="p-5 border-b border-slate-700 flex justify-between items-center bg-slate-800/80 rounded-t-2xl">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <CheckCircle2 size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Generation Complete</h3>
                  </div>
                </div>
                <button onClick={() => setGenerateResult(null)} className="p-2 text-slate-400 hover:text-white transition-colors bg-slate-900 rounded-lg border border-slate-700">
                  <X size={16} />
                </button>
              </div>
              {/* body */}
              <div className="p-6 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700">
                <p className="text-slate-300 text-sm mb-6 leading-relaxed p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                  <strong className="text-emerald-400 mr-2">Success:</strong> 
                  {generateResult.message}
                </p>
                
                {generateResult.sample && generateResult.sample.length > 0 && (
                  <>
                    <h4 className="text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-widest flex items-center gap-2">
                       Data Preview Panel <span className="bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">{generateResult.sample.length} Rows Snippet</span>
                    </h4>
                    <div className="bg-slate-900 rounded-xl overflow-x-auto border border-slate-700 shadow-inner">
                      <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-slate-800/80 border-b border-slate-700">
                          <tr>
                            {Object.keys(generateResult.sample[0]).map((key) => (
                              <th key={key} className="px-4 py-3 text-xs font-semibold text-slate-300 border-r border-slate-700/50 last:border-r-0">
                                {key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/50">
                          {generateResult.sample.map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                              {Object.values(row).map((val: any, jdx) => (
                                <td key={jdx} className="px-4 py-3 font-mono text-[13px] text-slate-400 border-r border-slate-700/50 last:border-r-0 truncate max-w-[200px]">
                                  {String(val)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
