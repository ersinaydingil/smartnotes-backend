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

const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false
});
app.use("/api/", limiter);

const APP_SECRET = process.env.APP_SECRET || "";
function verifySecret(req, res, next) {
    if (!APP_SECRET) return next();
    if (req.headers["x-app-secret"] !== APP_SECRET) {
        return res.status(403).json({ error: "Yetkisiz." });
    }
    next();
}

app.post("/api/ai/generate", verifySecret, (req, res) => {
    const { prompt, maxTokens = 512 } = req.body;
    if (!prompt || typeof prompt !== "string" || prompt.length > 4000) {
        return res.status(400).json({ error: "Geçersiz istek." });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "API key eksik." });

    const body = JSON.stringify({
        model: "meta-llama/llama-3.2-3b-instruct:free",
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens
    });

    const options = {
        hostname: "openrouter.ai",
        path: "/api/v1/chat/completions",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": "https://smartnotes.app",
            "X-Title": "Akilli Not Defteri",
            "Content-Length": Buffer.byteLength(body)
        }
    };

    const proxyReq = https.request(options, proxyRes => {
        let data = "";
        proxyRes.on("data", chunk => data += chunk);
        proxyRes.on("end", () => {
            try {
                const json = JSON.parse(data);
                const choice = json?.choices?.[0];
                const rawContent = choice?.message?.content;
                const reasoning  = choice?.message?.reasoning || "";
                const text = (rawContent != null && rawContent !== "") ? rawContent : reasoning;
                if (!text) {
                    console.error("OpenRouter boş yanıt:", JSON.stringify(json).substring(0, 300));
                    return res.status(502).json({ error: "Boş yanıt." });
                }
                res.json({ text: text.trim() });
            } catch (e) {
                console.error("Parse hatası:", e.message);
                res.status(502).json({ error: "Yanıt işlenemedi." });
            }
        });
    });

    proxyReq.on("error", e => {
        console.error("AI istek hatası:", e.message);
        res.status(502).json({ error: "AI servisine ulaşılamadı." });
    });
    proxyReq.setTimeout(25000, () => {
        proxyReq.destroy();
        res.status(504).json({ error: "Zaman aşımı." });
    });
    proxyReq.write(body);
    proxyReq.end();
});

app.get("/health", (_, res) => {
    res.json({ status: "ok", time: new Date().toISOString(), ai: !!process.env.OPENROUTER_API_KEY });
});

app.use((_, res) => res.status(404).json({ error: "Bulunamadı." }));

app.listen(PORT, () => {
    console.log(`SmartNotes backend çalışıyor → http://localhost:${PORT}`);
    console.log(`AI: ${process.env.OPENROUTER_API_KEY ? "✅ Aktif" : "❌ API key eksik"}`);
});
