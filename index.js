import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { roll, formatResult } from "./dice.js";

const PHONE_NUMBER = process.env.WA_PHONE_NUMBER || "5547999626400";
const logger = pino({ level: process.env.LOG_LEVEL || "silent" });

function getText(msg) {
  const m = msg.message;
  if (!m) return "";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ""
  );
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: ["Ubuntu", "Chrome", "22.04.4"],
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        const pretty = code?.match(/.{1,4}/g)?.join("-") || code;
        console.log("\n==============================");
        console.log(` CÓDIGO DE PAREAMENTO: ${pretty}`);
        console.log(` Número: ${PHONE_NUMBER}`);
        console.log(" WhatsApp > Aparelhos conectados > Conectar com número");
        console.log("==============================\n");
      } catch (err) {
        console.error("Falha ao pedir o código de pareamento:", err?.message || err);
      }
    }, 3000);
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "open") {
      console.log("✅ Conectado ao WhatsApp. Bot de dados pronto.");
    }
    if (connection === "close") {
      const status = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (status === DisconnectReason.loggedOut) {
        console.log("❌ Sessão encerrada. Apague a pasta auth/ e pareie novamente.");
        return;
      }
      console.log("🔄 Conexão caiu, reconectando...");
      setTimeout(() => start().catch(console.error), 2000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const jid = msg.key.remoteJid;
      if (!jid || jid === "status@broadcast") continue;

      const text = getText(msg).trim();
      if (!text.startsWith("/")) continue;

      const result = roll(text);
      if (!result) continue;

      try {
        await sock.sendMessage(jid, { text: formatResult(text, result) }, { quoted: msg });
      } catch (err) {
        console.error("Erro ao responder:", err?.message || err);
      }
    }
  });
}

start().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
