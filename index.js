const express   = require("express");
const https     = require("https");
const rateLimit = require("express-rate-limit");
const helmet    = require("helmet");
require("dotenv").config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

app.use(helmet());
app.use(express.json({ limit: "32kb" }));

// Rate limit: IP başına dakikada 20 istek
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { error: "Çok fazla istek. Lütfen bekleyin." }
});
app.use("/api/", limiter);

// APP_SECRET kontrolü
const APP_SECRET = process.env.APP_SECRET || "";
function verifySecret(req, res, next) {
    if (!APP_SECRET) return next();
    if (req.headers["x-app-secret"] !== APP_SECRET) {
        return res.status(403).json({ error: "Yetkisiz." });
    }
    next();
}

// ── AI Endpoint ───────────────────────────────────────────────
app.post("/api/ai/generate", verifySecret, (req, res) => {
    const { prompt, maxTokens = 512 } = req.body;
    if (!prompt || typeof prompt !== "string" || prompt.length > 4000) {
        return res.status(400).json({ error: "Geçersiz istek." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "API key eksik." });

    const body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens }
    });

    const options = {
        hostname: "generativelanguage.googleapis.com",
        path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body)
        }
    };

    const proxyReq = https.request(options, proxyRes => {
        let data = "";
        proxyRes.on("data", chunk => data += chunk);
        proxyRes.on("end", () => {
            try {
                const json = JSON.parse(data);
                const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
                if (!text) return res.status(502).json({ error: "Boş yanıt." });
                res.json({ text: text.trim() });
            } catch {
                res.status(502).json({ error: "Yanıt işlenemedi." });
            }
        });
    });

    proxyReq.on("error", () => res.status(502).json({ error: "AI servisine ulaşılamadı." }));
    proxyReq.setTimeout(20000, () => {
        proxyReq.destroy();
        res.status(504).json({ error: "Zaman aşımı." });
    });
    proxyReq.write(body);
    proxyReq.end();
});

// ── Sağlık Kontrolü ───────────────────────────────────────────
app.get("/health", (_, res) => {
    res.json({
        status : "ok",
        time   : new Date().toISOString(),
        ai     : !!process.env.GEMINI_API_KEY
    });
});

app.use((_, res) => res.status(404).json({ error: "Bulunamadı." }));

app.listen(PORT, () => {
    console.log(`SmartNotes backend çalışıyor → http://localhost:${PORT}`);
    console.log(`AI: ${process.env.GEMINI_API_KEY ? "✅ Aktif" : "❌ API key eksik"}`);
});
