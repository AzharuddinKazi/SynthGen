import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import crypto from "crypto";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // -- API Routes --
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "SynthGen API is healthy and running." });
  });

  app.post("/api/generate", (req, res) => {
    const { schema_config, num_rows } = req.body;
    
    // In a real production deployment, this would trigger the Python FastAPI backend
    // For this UI mockup, we generate a small sample of fake data based on the schema
    const rowsToGenerate = 5; // Preview rows count
    const sample = [];
    
    if (schema_config?.columns) {
      for (let i = 0; i < rowsToGenerate; i++) {
        const row: any = {};
        for (const col of schema_config.columns) {
          const dt = (col.data_type || "").toLowerCase();
          if (dt.includes("uuid")) row[col.name] = crypto.randomUUID();
          else if (dt.includes("int")) row[col.name] = Math.floor(Math.random() * 10000);
          else if (dt.includes("float")) row[col.name] = parseFloat((Math.random() * 1000).toFixed(2));
          else if (dt.includes("date")) row[col.name] = new Date(Date.now() - Math.random() * 1e10).toISOString().split('T')[0];
          else if (dt.includes("cat")) row[col.name] = "Cat_" + ['A','B','C','D'][Math.floor(Math.random() * 4)];
          else row[col.name] = "Sample_Value";
        }
        sample.push(row);
      }
    }

    res.json({
      status: "success",
      message: `Node.js Mock Engine triggered. Generated ${num_rows || 100} rows for schema ${schema_config?.schema_name || 'unknown'}. Connect Python backend for true statistical generation.`,
      sample
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
